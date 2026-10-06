// Defect 5 (FEATURES §5): the old app's OIDC login had no PKCE, no nonce and no id_token
// validation, crashed on an unknown state, and copied the client secret into its auth_codes table.
// Every way an OIDC login can be wrong must fail with 400 or 401 and leave no session and no user.
// Never weaken this test.
import { makeAuthMethod, makeUser, type TokenFaults } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { PROVIDER, browser, oidcSettings, useOidcApp } from './testing/oidc-flow.ts';

const { app, idp, startApp: startOidcApp } = useOidcApp();

/**
 * The app, and optionally an active user who would be signed in straight away if the login were
 * accepted: a missing refusal then shows as a session, not as "pending".
 */
async function startApp(withKnownUser = false) {
  const started = await startOidcApp();
  const count = async (table: string) =>
    Number(
      (
        (await started.kernel.pool.query(`select count(*) from ${table}`)).rows[0] as {
          count: string;
        }
      ).count,
    );
  if (withKnownUser) {
    const user = await makeUser(started.kernel.pool, { status: 'active' });
    await makeAuthMethod(started.kernel.pool, user, { provider: PROVIDER, subject: login.subject });
  }
  return { ...started, count, known: withKnownUser };
}

/** Nothing was created: no session, no new user, no new identity, no event, and no cookie was handed out. */
async function expectNothingCreated(
  ctx: Awaited<ReturnType<typeof startApp>>,
  reply: { setCookie: string | undefined; res: Response },
) {
  const existing = ctx.known ? 1 : 0;
  expect(reply.setCookie).toBeUndefined();
  expect(reply.res.headers.getSetCookie().filter((c) => c.startsWith('__Host-session='))).toEqual(
    [],
  );
  expect(await ctx.count('identity_session')).toBe(0);
  expect(await ctx.count('identity_user')).toBe(existing);
  expect(await ctx.count('identity_auth_method')).toBe(existing);
  expect(await ctx.count('kernel_outbox')).toBe(0);
}

const login = { subject: 'attacker-sub', email: 'victim@example.org', emailVerified: true };

describe('defect 5: a bad id_token never logs anyone in', () => {
  const faults: [string, TokenFaults][] = [
    ['a tampered nonce', { nonce: 'not-the-nonce-we-sent' }],
    ['no nonce at all', { nonce: null }],
    ['the wrong audience', { audience: 'another-client' }],
    ['an audience list that does not hold us', { audience: ['a', 'b'] }],
    ['several audiences without an azp', { audience: ['scorpion-test', 'other'] }],
    ['an azp that is not us', { azp: 'another-client' }],
    ['the wrong issuer', { issuer: 'https://evil.example.org' }],
    ['a signature made with another key', { signWith: 'other-key' }],
    ['alg none', { signWith: 'none' }],
    [
      'HS256 keyed with the public key (algorithm confusion)',
      { signWith: 'hs256-with-public-key' },
    ],
    ['an expired token', { expiresIn: -600 }],
    ['a token that is not valid yet', { notBefore: 3600 }],
    ['a token issued in the future', { issuedAtOffset: 3600, expiresIn: 7200 }],
    ['no exp', { omit: ['exp'] }],
    ['no iat', { omit: ['iat'] }],
    ['no sub', { omit: ['sub'] }],
    ['no id_token', { omitIdToken: true }],
  ];

  describe.each([
    ['an unknown person', false],
    ['a known active user', true],
  ])('for %s', (_who, known) => {
    it.each(faults)('refuses %s with 401 [ASVS-6.8.2]', async (_name, fault) => {
      const ctx = await startApp(known);
      idp.faults = fault;
      try {
        const { reply } = await ctx.web.login(login);
        expect(reply.status).toBe(401);
        expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
        expect(JSON.stringify(reply.body)).not.toMatch(/eyJ|nonce|signature|audience|issuer/i);
        await expectNothingCreated(ctx, reply);
      } finally {
        idp.faults = {};
      }
    });
  });
});

describe('defect 5: a bad state never logs anyone in', () => {
  it('refuses a replayed state with 400 [ASVS-10.2.1]', async () => {
    const ctx = await startApp(true);
    const started = await ctx.web.start();
    const back = await ctx.web.provider(started, login);
    const first = await ctx.web.callback(back, started);
    expect(first.status).toBe(302); // the first use signs the known user in and uses the state up
    expect(await ctx.count('identity_session')).toBe(1);
    const replay = await ctx.web.callback(back, started);
    expect(replay.status).toBe(400);
    expect(replay.res.headers.get('content-type')).toContain('application/problem+json');
    expect(replay.setCookie).toBeUndefined();
    expect(await ctx.count('identity_user')).toBe(1);
    expect(await ctx.count('identity_session')).toBe(1); // no second session
  });

  it('refuses an expired state with 400', async () => {
    const ctx = await startApp();
    const started = await ctx.web.start();
    const back = await ctx.web.provider(started, login);
    await ctx.kernel.pool.query(
      "update identity_login_state set expires_at = now() - interval '1 second'",
    );
    const reply = await ctx.web.callback(back, started);
    expect(reply.status).toBe(400);
    await expectNothingCreated(ctx, reply);
  });

  it.each([
    ['unknown', `${'z'.repeat(43)}`],
    ['made of odd characters', encodeURIComponent("' or 1=1 --")],
  ])('refuses a state that is %s with 400, never a 500', async (_name, state) => {
    const ctx = await startApp();
    const started = await ctx.web.start();
    const back = await ctx.web.provider(started, login);
    const reply = await ctx.web.callback(
      { ...back, path: `/auth/oidc/${PROVIDER}/callback?state=${state}&code=${back.code}` },
      started,
    );
    expect(reply.status).toBe(400);
    await expectNothingCreated(ctx, reply);
  });

  it('refuses a state from another browser with 400 (login CSRF) [ASVS-7.6.2] [ASVS-10.1.2] [ASVS-10.2.1]', async () => {
    const ctx = await startApp();
    const attacker = await ctx.web.start();
    const back = await ctx.web.provider(attacker, login);
    const reply = await ctx.web.callback(back, undefined);
    expect(reply.status).toBe(400);
    await expectNothingCreated(ctx, reply);
  });

  it('refuses a state tied to another provider with 400 [ASVS-10.2.2]', async () => {
    const two = oidcSettings(idp, {
      oidcProviders: [idp.provider(PROVIDER), idp.provider('second')],
    });
    const started2 = await app.start({ settings: two, clientSecret: () => idp.clientSecret });
    const web = browser(started2, idp);
    const started = await web.start();
    const back = await web.provider(started, login);
    const reply = await started2.get(back.path.replace(`/${PROVIDER}/`, '/second/'), {
      headers: { cookie: `__Host-oidc-login=${started.loginCookie}` },
    });
    expect(reply.status).toBe(400);
    expect(reply.setCookie).toBeUndefined();
  });
});

describe('defect 5: the flow itself is sound', () => {
  it('sends PKCE S256, a state and a nonce, and the provider sees the verifier only at the token endpoint [ASVS-10.2.1]', async () => {
    const ctx = await startApp();
    const started = await ctx.web.start();
    await ctx.web.provider(started, login);
    const q = idp.lastAuthorization!;
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.authorizationUrl).not.toContain(started.loginCookie); // the verifier is not in the URL
  });

  it('stores nothing secret: no table holds the client secret, the verifier, the code or the state', async () => {
    const ctx = await startApp();
    const started = await ctx.web.start();
    const back = await ctx.web.provider(started, login);
    const tables = [
      'identity_user',
      'identity_auth_method',
      'identity_session',
      'identity_login_state',
      'kernel_outbox',
    ];
    const nonce = idp.lastAuthorization!.get('nonce')!;
    // Once while the login state exists, and once after the callback used it up.
    for (const step of ['before', 'after']) {
      if (step === 'after') await ctx.web.callback(back, started);
      for (const table of tables) {
        const rows = JSON.stringify((await ctx.kernel.pool.query(`select * from ${table}`)).rows);
        for (const secret of [
          idp.clientSecret,
          started.loginCookie,
          back.code,
          back.state,
          nonce,
        ]) {
          expect(rows).not.toContain(secret);
        }
      }
    }
  });

  it('does not need the session cookie, and a bad one does not stop the callback', async () => {
    const ctx = await startApp(true);
    const { reply } = await ctx.web.login(login, { session: 'C'.repeat(43) });
    expect(reply.status).toBe(302); // a bad session cookie did not stop the callback
  });
});
