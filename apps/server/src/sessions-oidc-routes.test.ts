// Re-authentication at an OIDC provider through the routes (ADR 0025): an account that has no
// password cannot confirm anything with one, so it signs in at its provider again. The request asks
// for a login now, and the callback refuses an `auth_time` that is older than the request.
import { makeAuthMethod, makeRoleAssignment, makeUser } from '@scorpion/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { PROVIDER, isProblem, useOidcApp } from './testing/oidc-flow.ts';

const { idp, startApp } = useOidcApp();
const SUBJECT = 'olga-at-stub';
const person = { subject: SUBJECT, email: 'olga@example.org', emailVerified: true };

afterEach(() => {
  idp.faults = {};
});

/** Olga has no password; she signs in at the stub provider and holds the role user. */
async function signedInAtProvider() {
  const s = await startApp({ sessionCacheTtlMs: 0 });
  const user = await makeUser(s.kernel.pool, { username: 'olga', email: 'olga@example.org' });
  await makeRoleAssignment(s.kernel.pool, user, 'user');
  await makeAuthMethod(s.kernel.pool, user, { provider: PROVIDER, subject: SUBJECT });
  const { reply } = await s.web.login(person);
  expect(reply.status).toBe(302);
  const cookie = reply.cookie!;
  const me = await s.get('/auth/me', { cookie });
  const csrf = (me.body as { csrfToken: string }).csrfToken;
  const stale = () =>
    s.kernel.pool.query(
      "update identity_session set authenticated_at = now() - interval '2 hours'",
    );
  return { ...s, user, session: { cookie, csrf }, stale };
}

describe('POST /account/reauthenticate/oidc/{provider}', () => {
  it('an OIDC-only account changes its email address after signing in again at the provider [ASVS-7.6.1]', async () => {
    const s = await signedInAtProvider();
    await s.stale();
    const change = () =>
      s.call('PATCH', '/account/profile', { ...s.session, body: { email: 'new@example.org' } });
    const refused = await change();
    expect(refused.status).toBe(401);
    expect((refused.body as { type: string }).type).toBe('reauthentication-required');
    // The password cannot do it: there is none.
    const password = await s.post('/account/reauthenticate', {
      ...s.session,
      body: { password: 'anything at all' },
    });
    expect(password.status).toBe(409);

    const started = await s.web.start('reauthenticate', s.session);
    const query = new URL(started.authorizationUrl).searchParams;
    expect([query.get('prompt'), query.get('max_age')]).toEqual(['login', '0']);
    const back = await s.web.provider(started, person);
    const done = await s.web.callback(back, started, { session: s.session.cookie });

    expect(done.status).toBe(302);
    expect(done.setCookie).toBeUndefined(); // the browser keeps its cookie: no new session
    expect(
      (await s.kernel.pool.query('select count(*)::int as n from identity_session')).rows,
    ).toEqual([{ n: 1 }]);
    expect((await change()).status).toBe(200);
  });

  it('refuses a provider that answers from its own session: the stale auth_time is a 401 and nothing changes [ASVS-6.8.4]', async () => {
    const s = await signedInAtProvider();
    await s.stale();
    idp.faults = { ignorePrompt: true };

    const started = await s.web.start('reauthenticate', s.session);
    const back = await s.web.provider(started, {
      ...person,
      authTime: Math.floor(Date.now() / 1000) - 3600,
    });
    const done = await s.web.callback(back, started, { session: s.session.cookie });

    expect(done.status).toBe(401);
    expect(isProblem(done)).toBe(true);
    expect(JSON.stringify(done.body)).not.toMatch(/auth_time|auth-time/); // the reason is for the log
    expect(s.logText()).toContain('auth-time-stale');
    const change = await s.call('PATCH', '/account/profile', {
      ...s.session,
      body: { email: 'new@example.org' },
    });
    expect(change.status).toBe(401);
    expect((change.body as { type: string }).type).toBe('reauthentication-required');
  });

  it('is refused for an account with no sign-in at that provider (404), a token (403) and anonymous (401)', async () => {
    const s = await startApp();
    const alice = await s.signedIn('alice'); // a password account
    const made = await s.post('/tokens', {
      cookie: alice.cookie,
      csrf: alice.csrf,
      body: { name: 'ci', scopes: ['core.identity.session.manage'] },
    });
    const { token } = made.body as { token: string };
    const path = `/account/reauthenticate/oidc/${PROVIDER}`;
    expect((await s.post(path, alice)).status).toBe(404);
    expect((await s.post(path, { headers: { authorization: `Bearer ${token}` } })).status).toBe(
      403,
    );
    expect((await s.post(path)).status).toBe(401);
    expect(
      (await s.kernel.pool.query('select count(*)::int as n from identity_login_state')).rows,
    ).toEqual([{ n: 0 }]);
  });
});
