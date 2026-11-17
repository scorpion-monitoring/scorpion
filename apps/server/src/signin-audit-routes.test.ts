// The sign-ins on the audit trail through the whole pipeline, with the real audit module (M12a sprint 5, ASVS 6.3.1; ADR 0026): a
// successful sign-in is an entry of the person who signed in, the failed ones of a name in a window are one anonymous entry with a count,
// an administrator reads them, and a plain user does not. The throttle still answers as it did: no lockout.
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
type Envelope = { metadata: { totalCount: number }; result: Record<string, unknown>[] };
type Started = Awaited<ReturnType<typeof app.start>>;
const session = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });

const dispatch = async (s: Started) => {
  while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
    // run until the outbox is quiet
  }
};
/** The failed windows of this run are closed a day later; the job does the same every five minutes. */
const closeWindows = async (s: Started) => {
  const identity = s.kernel.services.get('core.identity') as {
    loginFailures: { flush(now: Date): Promise<{ windows: number; failures: number }> };
  };
  return identity.loginFailures.flush(new Date(Date.now() + 48 * 3600 * 1000));
};
const entries = async (s: Started, action: string) =>
  (
    await s.kernel.pool.query(
      'select * from audit_event where action = $1 order by occurred_at, id',
      [action],
    )
  ).rows as Record<string, unknown>[];

describe('[ASVS-6.3.1] sign-ins on the audit trail', () => {
  it('shows a successful sign-in with the person as the actor, and no session id', async () => {
    const s = await app.start();
    const ann = await s.signedIn('ann-signin');
    await dispatch(s);
    const rows = await entries(s, 'identity.session.created@1');
    const mine = rows.filter((row) => row.user_id === ann.user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      actor_kind: 'user',
      outcome: 'ok',
      source: 'event',
      subject_type: 'user',
      subject_id: ann.user.id,
    });
    expect(JSON.stringify(mine[0])).not.toContain(ann.cookie.split('=')[1]!);
    const sessionRows = await s.kernel.pool.query<{ id: string }>(
      'select id from identity_session',
    );
    for (const { id } of sessionRows.rows) expect(JSON.stringify(mine[0])).not.toContain(id);
  });

  it('keeps the client address in the ip column of the sign-in entry and never in its payload', async () => {
    const s = await app.start();
    const ann = await s.signedIn('ann-address');
    await dispatch(s);
    const [row] = (await entries(s, 'identity.session.created@1')).filter(
      (entry) => entry.user_id === ann.user.id,
    );
    expect(row!.ip).toBe('203.0.113.7');
    expect(JSON.stringify(row!.payload)).not.toContain('203.0.113');
    expect(row!.payload).toEqual({ userId: ann.user.id, method: 'password' });
  });

  it('puts a sign-out on the trail with the person, the address and the outcome, and no cookie or session id, and the session is over [ASVS-6.3.1] [ASVS-7.4.1]', async () => {
    const s = await app.start();
    const ann = await s.signedIn('ann-signout');
    const sessionIds = (
      await s.kernel.pool.query<{ id: string }>('select id from identity_session')
    ).rows.map((row) => row.id);
    expect((await s.post('/auth/logout', session(ann))).status).toBe(204);
    const rows = (
      (
        await s.kernel.pool.query(
          "select * from audit_event where path like '%/auth/logout' order by occurred_at, id",
        )
      ).rows as Record<string, unknown>[]
    ).filter((row) => row.user_id === ann.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'api',
      method: 'POST',
      status: 204,
      outcome: 'ok',
      actor_kind: 'user',
      ip: '203.0.113.7',
    });
    const dump = JSON.stringify(rows[0]);
    for (const id of sessionIds) expect(dump).not.toContain(id);
    expect(dump).not.toContain(ann.cookie.split('=')[1]!);
    // The same call again has no session: it is refused and the refusal is on the trail too, as for every audited route.
    expect((await s.post('/auth/logout', session(ann))).status).toBe(401);
    const refused = (
      await s.kernel.pool.query(
        "select outcome, actor_kind, status from audit_event where path like '%/auth/logout' and status = 401",
      )
    ).rows;
    expect(refused.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the failures of one name as one anonymous entry with a count, however many attempts, and still locks nobody out', async () => {
    const s = await app.start();
    const ann = await s.signedIn('ann-failing');
    for (let i = 0; i < 30; i++) {
      const reply = await s.post('/auth/login', {
        body: { username: 'ann-failing', password: 'wrong' },
      });
      // 401 until the throttle slows the name, then 429: the answers of ADR 0026, unchanged
      expect([401, 429]).toContain(reply.status);
    }
    expect((await closeWindows(s)).failures).toBeGreaterThanOrEqual(1);
    await dispatch(s);
    const rows = await entries(s, 'identity.login.failed@1');
    expect(rows.length).toBeLessThanOrEqual(2); // one per window the attempts fell into: a window rolls over at most once here
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_kind: 'anonymous',
        user_id: null,
        subject_type: 'user',
        subject_id: ann.user.id,
        outcome: 'ok',
      });
      expect(JSON.stringify(row)).not.toMatch(/wrong|ann-failing/);
    }
    const counted = rows.reduce(
      (total, row) => total + Number((row.payload as { count: number }).count),
      0,
    );
    expect(counted).toBeGreaterThanOrEqual(5);
    expect(counted).toBeLessThanOrEqual(30);
    // No lockout: the right password still signs in once the block of the throttle has passed.
    await s.kernel.pool.query('delete from identity_login_throttle');
    expect(
      (await s.post('/auth/login', { body: { username: 'ann-failing', password: PASSWORD } }))
        .status,
    ).toBe(200);
  });

  it('lets an administrator read them and keeps them from a plain user (403) [ASVS-8.2.1]', async () => {
    const s = await app.start();
    const boss = await s.signedIn('boss-signin', { roles: ['admin'] });
    const plain = await s.signedIn('plain-signin');
    await s.post('/auth/login', { body: { username: 'plain-signin', password: 'wrong' } });
    await closeWindows(s);
    await dispatch(s);

    const seen = await s.get(
      '/audit?action=identity.session.created%40' + '1&pageSize=100',
      session(boss),
    );
    expect(seen.status).toBe(200);
    const list = seen.body as Envelope;
    expect(list.result.map((row) => row.userId)).toEqual(
      expect.arrayContaining([boss.user.id, plain.user.id]),
    );
    const failed = await s.get('/audit?action=identity.login.failed%401', session(boss));
    const entry = (failed.body as Envelope).result[0]!;
    expect(entry).toMatchObject({ actorKind: 'anonymous', subjectId: plain.user.id });
    expect((entry.payload as { count: number }).count).toBe(1);

    for (const path of [
      '/audit?action=identity.session.created%401',
      '/audit?action=identity.login.failed%401',
    ]) {
      expect((await s.get(path, session(plain))).status).toBe(403);
      expect((await s.get(path)).status).toBe(401);
    }
  });
});
