// `GET /inbox/stream` through the whole pipeline on real Postgres (ADR-0028): who may open it, what it
// says, the caps, and above all that it ends when the credentials behind it stop being good (defect 4 seen
// from a stream: a logout must not leave a stream open). The heartbeat is tuned down to 80 ms.
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const SCOPE = 'core.notifications.inbox.read';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const options = (extra: Record<string, unknown> = {}) => ({
  sessionCacheTtlMs: 0,
  tokenCacheTtlMs: 0,
  notifications: { listen: true, inboxStream: { heartbeatMs: 80, coalesceMs: 10 } },
  ...extra,
});
const counts = (text: string) =>
  [...text.matchAll(/event: unread\ndata: \{"count":(\d+)\}/g)].map((m) => +m[1]!);

async function item(s: Awaited<ReturnType<typeof app.start>>, userId: string) {
  // The mail module of the app queues a template with an inbox item for the person.
  await s.kernel.db.tx((tx) =>
    s.notifications.enqueueTemplate(tx, {
      template: 'identity.approved',
      data: { username: 'x', signInUrl: 'https://example.org/login' },
      recipient: { address: `${userId}@example.org`, userId },
      inApp: true,
    }),
  );
}

describe('GET /inbox/stream', () => {
  it('opens for a signed-in person as an uncached event stream that starts with their count [ASVS-7.4.1]', async () => {
    const s = await app.start(options());
    const me = await s.signedIn('anna');
    const stream = await s.stream('/inbox/stream', me);
    expect(stream.status).toBe(200);
    expect(stream.res.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.res.headers.get('cache-control')).toBe('no-store');
    expect(stream.res.headers.get('x-accel-buffering')).toBe('no');
    await stream.until((text) => counts(text).length >= 1);
    expect(counts(stream.text())).toEqual([0]);
    await item(s, me.user.id);
    await stream.until((text) => counts(text).at(-1) === 1);
    stream.close();
  });

  it('is refused to anonymous (401), to a stale cookie (401), and to a caller without the permission (403)', async () => {
    const s = await app.start(options());
    expect((await s.stream('/inbox/stream')).status).toBe(401);
    expect((await s.stream('/inbox/stream', { cookie: 'A'.repeat(43) })).status).toBe(401);
    const bare = await s.signedIn('bare', { roles: [] });
    expect((await s.stream('/inbox/stream', bare)).status).toBe(403);
  });

  it('follows only the caller: there is no id to ask for, and a user id in the address changes nothing', async () => {
    const s = await app.start(options());
    const ann = await s.signedIn('ann');
    const bob = await s.signedIn('bob');
    await item(s, ann.user.id);
    const bobStream = await s.stream(
      `/inbox/stream?userId=${ann.user.id}&user=${ann.user.id}`,
      bob,
    );
    await bobStream.until((text) => counts(text).length >= 1);
    expect(counts(bobStream.text())).toEqual([0]); // bob's count, not ann's 1
    await item(s, ann.user.id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(counts(bobStream.text())).toEqual([0]);
    bobStream.close();
  });

  it('ends within a heartbeat after a logout, and nothing more is sent [defect 4] [ASVS-7.4.1]', async () => {
    const s = await app.start(options());
    const me = await s.signedIn('leaver');
    const stream = await s.stream('/inbox/stream', me);
    await stream.until((text) => text.includes(': heartbeat'));
    expect((await s.post('/auth/logout', me)).status).toBe(204);
    expect(await stream.ends()).toBe(true);
    const after = stream.text();
    await item(s, me.user.id);
    expect(stream.text()).toBe(after);
  });

  it('ends when an administrator ends the sessions of the person, and when the session expires', async () => {
    const s = await app.start(options());
    const admin = await s.signedIn('boss', { roles: ['admin'] });
    const target = await s.signedIn('target');
    const revoked = await s.stream('/inbox/stream', target);
    await revoked.until((text) => counts(text).length >= 1);
    expect(
      (await s.post(`/users/${target.user.id}/sessions/revoke`, { ...admin, body: {} })).status,
    ).toBe(200);
    expect(await revoked.ends()).toBe(true);

    const other = await s.signedIn('expirer');
    const expiring = await s.stream('/inbox/stream', other);
    await expiring.until((text) => counts(text).length >= 1);
    await s.kernel.pool.query(
      `update identity_session set expires_at = now() - interval '1 minute' where user_id = $1`,
      [other.user.id],
    );
    expect(await expiring.ends()).toBe(true);
  });

  it('does not count as activity: the re-check never slides the end of the session', async () => {
    const s = await app.start(options());
    const me = await s.signedIn('idle');
    const old = new Date(Date.now() - 3 * 3600_000);
    await s.kernel.pool.query(`update identity_session set last_seen_at = $2 where user_id = $1`, [
      me.user.id,
      old,
    ]);
    const stream = await s.stream('/inbox/stream', me);
    await stream.until((text) => text.split(': heartbeat').length > 3);
    stream.close();
    const { rows } = await s.kernel.pool.query<{ last_seen_at: Date }>(
      `select last_seen_at from identity_session where user_id = $1`,
      [me.user.id],
    );
    // Opening the stream is one request, which may slide it once; the heartbeats after it must not.
    const first = rows[0]!.last_seen_at.getTime();
    const again = await s.stream('/inbox/stream', me);
    await again.until((text) => text.split(': heartbeat').length > 3);
    again.close();
    const second = (
      await s.kernel.pool.query<{ last_seen_at: Date }>(
        `select last_seen_at from identity_session where user_id = $1`,
        [me.user.id],
      )
    ).rows[0]!.last_seen_at.getTime();
    expect(Math.abs(second - first)).toBeLessThan(2000);
  });

  it('works with an access token that has the scope, is refused without it, and ends when the token is revoked', async () => {
    const s = await app.start(options());
    const me = await s.signedIn('scripted');
    const made = await s.post('/tokens', { ...me, body: { name: 'live', scopes: [SCOPE] } });
    const { token, id } = made.body as { token: string; id: string };
    const stream = await s.stream('/inbox/stream', { headers: bearer(token) });
    expect(stream.status).toBe(200);
    await stream.until((text) => counts(text).length >= 1);

    const blind = await s.post('/tokens', {
      ...me,
      body: { name: 'blind', scopes: ['core.identity.me.read'] },
    });
    expect(
      (
        await s.stream('/inbox/stream', {
          headers: bearer((blind.body as { token: string }).token),
        })
      ).status,
    ).toBe(403);

    expect((await s.call('DELETE', `/tokens/${id}`, me)).status).toBe(204);
    expect(await stream.ends()).toBe(true);
  });

  it('answers 429 with Retry-After beyond the cap, as problem+json, and frees the place when a stream closes', async () => {
    const s = await app.start(
      options({ notificationSettings: { inboxStream: { perUser: 1, global: 10 } } }),
    );
    const me = await s.signedIn('greedy');
    const first = await s.stream('/inbox/stream', me);
    await first.until((text) => counts(text).length >= 1);
    const second = await s.call('GET', '/inbox/stream', me);
    expect(second.status).toBe(429);
    expect(second.res.headers.get('retry-after')).toBe('30');
    expect(second.res.headers.get('content-type')).toContain('application/problem+json');
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const third = await s.stream('/inbox/stream', me);
    expect(third.status).toBe(200);
    third.close();
  });
});
