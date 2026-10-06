// The session routes through the whole pipeline on real Postgres (ADR 0025, M4b sprint 1): the
// caller's own list, ending a session, re-authenticating with the password, the 401
// `reauthentication-required` that sensitive changes answer without a recent authentication, and the
// administrators' termination with its audit entries.
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const UNKNOWN = '019a0000-0000-7000-8000-000000000000';
type Started = Awaited<ReturnType<typeof app.start>>;
type Who = { cookie: string; csrf: string };
const as = (who: Who) => ({ cookie: who.cookie, csrf: who.csrf });

const start = () => app.start({ sessionCacheTtlMs: 0 });

/** The caller proved who they are a long time ago (all their sessions). */
const makeStale = (s: Started) =>
  s.kernel.pool.query(
    "update identity_session set authenticated_at = now() - interval '2 hours', created_at = now() - interval '2 hours'",
  );
const problem = (reply: Reply) => reply.body as { type: string; title: string; status: number };
const isProblem = (reply: Reply) =>
  (reply.res.headers.get('content-type') ?? '').startsWith('application/problem+json');
const sessionIds = async (s: Started, userId: string) =>
  (
    await s.kernel.pool.query<{ id: string }>(
      'select id from identity_session where user_id = $1 and revoked_at is null order by created_at, id',
      [userId],
    )
  ).rows.map((r) => r.id);
const dispatch = async (s: Started) => {
  while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
    // run until the outbox is quiet
  }
};
const trail = async (s: Started, where: string, params: unknown[] = []) =>
  (
    await s.kernel.pool.query(
      `select * from audit_event where ${where} order by occurred_at, id`,
      params,
    )
  ).rows as Record<string, unknown>[];
/** A second session of the same account (another browser), as the login route makes it. */
async function secondSession(s: Started, username: string) {
  const reply = await s.post('/auth/login', { body: { username, password: PASSWORD } });
  expect(reply.status).toBe(200);
  return { cookie: reply.cookie!, csrf: (reply.body as { csrfToken: string }).csrfToken };
}

describe('GET /account/sessions', () => {
  it('lists the caller’s own sessions with times and the current marker, and nothing that could be used', async () => {
    const s = await start();
    const laptop = await s.signedIn('alice');
    const phone = await secondSession(s, 'alice');
    await s.signedIn('bobby');

    const reply = await s.get('/account/sessions', as(phone));

    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = reply.body as {
      metadata: { currentPage: number; totalCount: number };
      result: { id: string; createdAt: string; lastSeenAt: string; current: boolean }[];
    };
    expect(body.metadata).toMatchObject({ currentPage: 0, totalCount: 2 });
    expect(body.result).toHaveLength(2);
    for (const item of body.result) {
      expect(Object.keys(item).sort()).toEqual(['createdAt', 'current', 'id', 'lastSeenAt']);
      expect(new Date(item.createdAt).getTime()).not.toBeNaN();
    }
    expect(body.result.map((r) => r.current)).toEqual([true, false]); // newest first: the phone
    const ids = await sessionIds(s, laptop.user.id);
    expect(body.result.map((r) => r.id).sort()).toEqual([...ids].sort());
    // Neither the cookie value, nor its hash, nor a device or an address is in the answer.
    const text = JSON.stringify(reply.body);
    expect(text).not.toContain(laptop.cookie);
    expect(text).not.toContain(phone.cookie);
    expect(text).not.toMatch(/secret|hash|agent|address|ip"/i);
  });

  it('is 401 for an anonymous caller and 403 for a user without a role', async () => {
    const s = await start();
    const roleless = await s.signedIn('norole', { roles: [] });
    expect((await s.get('/account/sessions')).status).toBe(401);
    expect((await s.get('/account/sessions', as(roleless))).status).toBe(403);
  });

  it('keeps to the paging of the envelope, and answers 422 for bad paging', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    await secondSession(s, 'alice');
    const second = await s.get('/account/sessions?page=1&pageSize=1', as(alice));
    expect((second.body as { result: unknown[] }).result).toHaveLength(1);
    expect((await s.get('/account/sessions?page=-1', as(alice))).status).toBe(422);
    expect((await s.get('/account/sessions?pageSize=100000', as(alice))).status).toBe(422);
  });
});

describe('DELETE /account/sessions/{id}', () => {
  it('ends another session of the caller at once, and not the one that asked', async () => {
    const s = await start();
    const laptop = await s.signedIn('alice');
    const phone = await secondSession(s, 'alice');
    const [phoneId] = (
      (await s.get('/account/sessions', as(laptop))).body as {
        result: { id: string; current: boolean }[];
      }
    ).result.filter((r) => !r.current);

    const reply = await s.call('DELETE', `/account/sessions/${phoneId!.id}`, as(laptop));

    expect(reply.status).toBe(204);
    expect(reply.cookie).toBeUndefined(); // it was not this browser's session
    expect((await s.get('/auth/me', { cookie: phone.cookie })).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: laptop.cookie })).status).toBe(200);
  });

  it('clears the cookie when the session ended is the caller’s own', async () => {
    const s = await start();
    const laptop = await s.signedIn('alice');
    const [mine] = (
      (await s.get('/account/sessions', as(laptop))).body as { result: { id: string }[] }
    ).result;
    const reply = await s.call('DELETE', `/account/sessions/${mine!.id}`, as(laptop));
    expect(reply.status).toBe(204);
    expect(reply.cookie).toBe('');
    expect((await s.get('/auth/me', { cookie: laptop.cookie })).status).toBe(401);
  });

  it('answers a session of somebody else exactly like an unknown id (404), and ends nothing', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bobby');
    const [theirs] = await sessionIds(s, bob.user.id);

    const foreign = await s.call('DELETE', `/account/sessions/${theirs}`, as(alice));
    const unknown = await s.call('DELETE', `/account/sessions/${UNKNOWN}`, as(alice));

    expect([foreign.status, unknown.status]).toEqual([404, 404]);
    expect(isProblem(foreign) && isProblem(unknown)).toBe(true);
    const { requestId: _a, ...a } = foreign.body as Record<string, unknown>;
    const { requestId: _b, ...b } = unknown.body as Record<string, unknown>;
    expect(a).toEqual(b);
    expect((await s.get('/auth/me', { cookie: bob.cookie })).status).toBe(200);
  });

  it('answers 422 for an id that is not a UUID, 401 to anonymous and 403 to a user without a role', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const roleless = await s.signedIn('norole', { roles: [] });
    expect((await s.call('DELETE', '/account/sessions/not-a-uuid', as(alice))).status).toBe(422);
    expect((await s.call('DELETE', `/account/sessions/${UNKNOWN}`)).status).toBe(401);
    expect((await s.call('DELETE', `/account/sessions/${UNKNOWN}`, as(roleless))).status).toBe(403);
  });
});

describe('recent authentication on the routes', () => {
  it('ending a session needs it: 401 reauthentication-required, then it works after the password [ASVS-7.5.2]', async () => {
    const s = await start();
    const laptop = await s.signedIn('alice');
    const phone = await secondSession(s, 'alice');
    const [phoneId] = (
      (await s.get('/account/sessions', as(laptop))).body as {
        result: { id: string; current: boolean }[];
      }
    ).result.filter((r) => !r.current);
    await makeStale(s);

    const refused = await s.call('DELETE', `/account/sessions/${phoneId!.id}`, as(laptop));
    expect(refused.status).toBe(401);
    expect(isProblem(refused)).toBe(true);
    expect(problem(refused)).toMatchObject({ type: 'reauthentication-required', status: 401 });
    expect((await s.get('/auth/me', { cookie: phone.cookie })).status).toBe(200); // not ended

    const again = await s.post('/account/reauthenticate', {
      ...as(laptop),
      body: { password: PASSWORD },
    });
    expect(again.status).toBe(204);
    expect((await s.call('DELETE', `/account/sessions/${phoneId!.id}`, as(laptop))).status).toBe(
      204,
    );
    expect((await s.get('/auth/me', { cookie: phone.cookie })).status).toBe(401);
  });

  it('changing the email address needs it, and works after re-authenticating [ASVS-7.5.1]', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    await makeStale(s);

    const refused = await s.call('PATCH', '/account/profile', {
      ...as(alice),
      body: { email: 'new@example.org' },
    });
    expect(refused.status).toBe(401);
    expect(problem(refused).type).toBe('reauthentication-required');
    expect((await s.get('/account/profile', as(alice))).body).toMatchObject({ pendingEmail: null });

    await s.post('/account/reauthenticate', { ...as(alice), body: { password: PASSWORD } });
    const done = await s.call('PATCH', '/account/profile', {
      ...as(alice),
      body: { email: 'new@example.org' },
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ pendingEmail: 'new@example.org' });
  });

  it('changing a name or a bio does not need it', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    await makeStale(s);
    const reply = await s.call('PATCH', '/account/profile', {
      ...as(alice),
      body: { displayName: 'Alice', bio: 'hello' },
    });
    expect(reply.status).toBe(200);
  });

  it('starting to link a provider needs it', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    await makeStale(s);
    const reply = await s.post('/auth/oidc/nowhere/link', as(alice));
    expect(reply.status).toBe(401);
    expect(problem(reply).type).toBe('reauthentication-required');
  });

  it('"log out everywhere" needs it, and ends every session after re-authenticating', async () => {
    const s = await start();
    const laptop = await s.signedIn('alice');
    const phone = await secondSession(s, 'alice');
    await makeStale(s);

    const refused = await s.post('/auth/logout-all', as(laptop));
    expect(refused.status).toBe(401);
    expect(problem(refused).type).toBe('reauthentication-required');
    expect((await s.get('/auth/me', { cookie: phone.cookie })).status).toBe(200);

    await s.post('/account/reauthenticate', { ...as(laptop), body: { password: PASSWORD } });
    const done = await s.post('/auth/logout-all', as(laptop));
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ revoked: 2 });
  });

  it('logging out the current session does not need it', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    await makeStale(s);
    expect((await s.post('/auth/logout', as(alice))).status).toBe(204);
  });

  it('does not ask a personal access token, which cannot reach the session-only routes anyway', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const made = await s.post('/tokens', {
      ...as(alice),
      body: { name: 'ci', scopes: ['core.identity.session.manage'] },
    });
    const { token } = made.body as { token: string };
    await makeStale(s);
    const reply = await s.post('/auth/logout-all', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reply.status).toBe(200);
  });
});

describe('POST /account/reauthenticate', () => {
  it('answers 204 for the right password and 422 for a wrong one, without repeating it', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    await makeStale(s);
    const wrong = await s.post('/account/reauthenticate', {
      ...as(alice),
      body: { password: 'definitely not it' },
    });
    expect(wrong.status).toBe(422);
    expect(isProblem(wrong)).toBe(true);
    expect(JSON.stringify(wrong.body)).not.toContain('definitely not it');
    const ok = await s.post('/account/reauthenticate', {
      ...as(alice),
      body: { password: PASSWORD },
    });
    expect(ok.status).toBe(204);
    expect(s.logText()).not.toContain('definitely not it');
    expect(s.logText()).not.toContain(PASSWORD);
  });

  it('answers 422 for bad input, 401 to anonymous, 403 to a user without a role', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const roleless = await s.signedIn('norole', { roles: [] });
    for (const body of [
      {},
      { password: '' },
      { password: PASSWORD, extra: true },
      { password: 'x'.repeat(5000) },
    ]) {
      expect((await s.post('/account/reauthenticate', { ...as(alice), body })).status).toBe(422);
    }
    const body = { password: PASSWORD };
    expect((await s.post('/account/reauthenticate', { body })).status).toBe(401);
    expect((await s.post('/account/reauthenticate', { ...as(roleless), body })).status).toBe(403);
  });

  it('is audited, with the outcome and without the password', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    await s.post('/account/reauthenticate', {
      ...as(alice),
      body: { password: 'wrong wrong wrong' },
    });
    await s.post('/account/reauthenticate', { ...as(alice), body: { password: PASSWORD } });
    await dispatch(s);
    const rows = await trail(s, "path = '/api/internal/account/reauthenticate' and source = 'api'");
    expect(rows.map((r) => [r.status, r.outcome])).toEqual([
      [422, 'error'],
      [204, 'ok'],
    ]);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    expect(
      (await trail(s, "action = 'identity.session.reauthenticated@1'")).map((r) => r.user_id),
    ).toEqual([alice.user.id]);
  });
});

describe('POST /users/{id}/sessions/revoke', () => {
  it('ends every session of that user at once, nobody else’s, and is audited with the count', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const victim = await s.signedIn('victim');
    const victimPhone = await secondSession(s, 'victim');
    const bystander = await s.signedIn('bystander');

    const reply = await s.post(`/users/${victim.user.id}/sessions/revoke`, as(admin));

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ revoked: 2 });
    expect((await s.get('/auth/me', { cookie: victim.cookie })).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: victimPhone.cookie })).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: bystander.cookie })).status).toBe(200);
    expect((await s.get('/auth/me', { cookie: admin.cookie })).status).toBe(200);

    await dispatch(s);
    const [request] = await trail(
      s,
      "path = '/api/internal/users/{id}/sessions/revoke' and source = 'api'",
    );
    expect(request).toMatchObject({ outcome: 'ok', status: 200, user_id: admin.user.id });
    const [event] = await trail(s, "action = 'identity.sessions.revoked@1'");
    expect(event).toMatchObject({
      user_id: admin.user.id,
      subject_type: 'user',
      subject_id: victim.user.id,
      payload: { count: 2 },
    });
  });

  it('is refused to a plain User (403, nothing ended), an anonymous caller (401) and a token of an administrator without the scope', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const victim = await s.signedIn('victim');
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const made = await s.post('/tokens', {
      ...as(admin),
      body: { name: 'narrow', scopes: ['core.identity.me.read'] },
    });
    const { token } = made.body as { token: string };

    const path = `/users/${victim.user.id}/sessions/revoke`;
    const denied = await s.post(path, as(plain));
    expect(denied.status).toBe(403);
    expect(isProblem(denied)).toBe(true);
    expect((await s.post(path)).status).toBe(401);
    expect((await s.post(path, { headers: { authorization: `Bearer ${token}` } })).status).toBe(
      403,
    );
    expect((await s.get('/auth/me', { cookie: victim.cookie })).status).toBe(200);
  });

  it('answers 404 for an unknown user and 422 for a malformed id, never a 500', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    expect((await s.post(`/users/${UNKNOWN}/sessions/revoke`, as(admin))).status).toBe(404);
    expect((await s.post('/users/not-a-uuid/sessions/revoke', as(admin))).status).toBe(422);
  });

  it('can be done with an administrator’s token that names the scope', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const victim = await s.signedIn('victim');
    const made = await s.post('/tokens', {
      ...as(admin),
      body: { name: 'ops', scopes: ['core.identity.session.manage-any'] },
    });
    const { token } = made.body as { token: string };
    const reply = await s.post(`/users/${victim.user.id}/sessions/revoke`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reply.status).toBe(200);
    expect((await s.get('/auth/me', { cookie: victim.cookie })).status).toBe(401);
  });
});

describe('POST /system/sessions/revoke-all', () => {
  it('ends every session of every user except the administrator’s own, and records the count', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const adminPhone = await secondSession(s, 'root');
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bobby');

    const reply = await s.post('/system/sessions/revoke-all', as(admin));

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ revoked: 3 });
    expect((await s.get('/auth/me', { cookie: admin.cookie })).status).toBe(200); // not locked out
    expect((await s.get('/auth/me', { cookie: adminPhone.cookie })).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: alice.cookie })).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: bob.cookie })).status).toBe(401);

    await dispatch(s);
    const [event] = await trail(s, "action = 'identity.sessions.revokedAll@1'");
    expect(event).toMatchObject({ user_id: admin.user.id, payload: { count: 3 } });
    const [request] = await trail(
      s,
      "path = '/api/internal/system/sessions/revoke-all' and source = 'api'",
    );
    expect(request).toMatchObject({ outcome: 'ok', status: 200 });
  });

  it('is refused to a plain User and to anonymous, and ends nothing; the refusal is audited', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const other = await s.signedIn('other');
    const denied = await s.post('/system/sessions/revoke-all', as(plain));
    expect(denied.status).toBe(403);
    expect((await s.post('/system/sessions/revoke-all')).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: other.cookie })).status).toBe(200);
    expect((await s.get('/auth/me', { cookie: plain.cookie })).status).toBe(200);
    const [row] = await trail(
      s,
      "path = '/api/internal/system/sessions/revoke-all' and outcome = 'denied'",
    );
    expect(row).toMatchObject({ status: 403, user_id: plain.user.id });
  });
});
