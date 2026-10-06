// The OIDC routes through the whole pipeline, on real Postgres, against a stub provider: starting
// a login, the callback, login CSRF, validation of what the provider sends, and what is kept secret.
import { makeAuthMethod, makeRoleAssignment, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { settingsWith } from './testing/identity-app.ts';
import {
  LOGIN_COOKIE,
  PROVIDER,
  isProblem,
  oidcSettings,
  person,
  setCookieValue,
  useOidcApp,
} from './testing/oidc-flow.ts';

const { app, idp, startApp } = useOidcApp();
const count = async (
  kernel: { pool: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> } },
  table: string,
) => Number((await kernel.pool.query(`select count(*) from ${table}`)).rows[0]!.count);

describe('POST /auth/oidc/{provider}/start', () => {
  it('returns the provider URL and sets a short-lived login cookie that is not the session cookie', async () => {
    const { post } = await startApp();
    const reply = await post(`/auth/oidc/${PROVIDER}/start`);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const url = new URL((reply.body as { authorizationUrl: string }).authorizationUrl);
    expect(url.origin).toBe(idp.issuer);
    for (const name of ['state', 'nonce', 'code_challenge'])
      expect(url.searchParams.get(name)).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const line = reply.res.headers.getSetCookie().find((v) => v.startsWith(`${LOGIN_COOKIE}=`))!;
    expect(line).toMatch(/^__Host-oidc-login=[A-Za-z0-9_-]{43};/);
    expect(line).toContain('Max-Age=600');
    expect(line).toContain('Path=/');
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');
    expect(line).not.toContain('Domain');
    expect(reply.setCookie).toBeUndefined(); // no session cookie
    expect(JSON.stringify(reply.body)).not.toContain(idp.clientSecret);
  });

  it('answers 404 problem+json for an unknown provider, 422 for a malformed id, and 502 when the provider is down', async () => {
    const { post } = await startApp();
    const unknown = await post('/auth/oidc/nope/start');
    expect(unknown.status).toBe(404);
    expect(isProblem(unknown)).toBe(true);
    expect((await post('/auth/oidc/Not_Valid/start')).status).toBe(422);
    expect((await post(`/auth/oidc/${'a'.repeat(33)}/start`)).status).toBe(422);

    idp.fail.discovery = true;
    try {
      const down = await (await startApp()).post(`/auth/oidc/${PROVIDER}/start`);
      expect(down.status).toBe(502);
      expect(isProblem(down)).toBe(true);
    } finally {
      idp.fail.discovery = false;
    }
  });

  it('is 404 everywhere when no provider is configured, whatever localAccounts says', async () => {
    const { post } = await app.start({
      settings: settingsWith({ localAccounts: false, approvalPolicy: 'manual', oidcProviders: [] }),
    });
    expect((await post(`/auth/oidc/${PROVIDER}/start`)).status).toBe(404);
  });

  it('works while local accounts are off (OIDC is a separate way in)', async () => {
    const { post } = await startApp({ settings: oidcSettings(idp, { localAccounts: false }) });
    expect((await post(`/auth/oidc/${PROVIDER}/start`)).status).toBe(200);
  });

  it('uses the strict rate-limit bucket', async () => {
    const { post } = await startApp({
      rateLimits: { strict: { capacity: 2, refillPerSecond: 0.001 } },
    });
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(`/auth/oidc/${PROVIDER}/start`)).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  it('treats a stale or bad session cookie as anonymous', async () => {
    const { post } = await startApp();
    const reply = await post(`/auth/oidc/${PROVIDER}/start`, { cookie: 'A'.repeat(43) });
    expect(reply.status).toBe(200);
  });
});

describe('GET /auth/oidc/{provider}/callback', () => {
  it('signs a known active user in: 302 to the application root, a session cookie, the login cookie cleared', async () => {
    const { kernel, web, get } = await startApp();
    const user = await makeUser(kernel.pool, { username: 'carol' });
    await makeRoleAssignment(kernel.pool, user, 'user');
    await makeAuthMethod(kernel.pool, user, { provider: PROVIDER, subject: 'carol-sub' });

    const { reply } = await web.login({ ...person(), subject: 'carol-sub' });
    expect(reply.status).toBe(302);
    expect(reply.res.headers.get('location')).toBe('/');
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(reply.res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(setCookieValue(reply, LOGIN_COOKIE)).toBe('');
    const line = reply.setCookie!;
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Secure');
    expect(line).toContain('SameSite=Lax');

    const me = await get('/auth/me', { cookie: reply.cookie });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { id: user.id, username: 'carol' } });
  });

  it('does not depend on the session cookie: a stale one is ignored, a good one is replaced', async () => {
    const { kernel, web, get, signedIn } = await startApp();
    const user = await makeUser(kernel.pool);
    await makeRoleAssignment(kernel.pool, user, 'user');
    await makeAuthMethod(kernel.pool, user, { provider: PROVIDER, subject: 's' });

    const stale = await web.login({ ...person(), subject: 's' }, { session: 'B'.repeat(43) });
    expect(stale.reply.status).toBe(302);

    const old = await signedIn('dave');
    const swapped = await web.login({ ...person(), subject: 's' }, { session: old.cookie });
    expect(swapped.reply.status).toBe(302);
    expect(swapped.reply.cookie).toBeTruthy();
    expect((await get('/auth/me', { cookie: old.cookie })).status).toBe(401); // the old session ended
    expect((await get('/auth/me', { cookie: swapped.reply.cookie })).status).toBe(200);
  });

  it('lets a signed-in browser start another login (switching accounts) and replaces the session', async () => {
    const { kernel, web, get, signedIn } = await startApp();
    const other = await makeUser(kernel.pool);
    await makeRoleAssignment(kernel.pool, other, 'user');
    await makeAuthMethod(kernel.pool, other, { provider: PROVIDER, subject: 'other-sub' });
    const dave = await signedIn('dave');
    const started = await web.start('start', { cookie: dave.cookie, csrf: dave.csrf });
    expect(started.reply.status).toBe(200);
    const back = await web.provider(started, { subject: 'other-sub' });
    const done = await web.callback(back, started, { session: dave.cookie });
    expect(done.status).toBe(302);
    expect((await get('/auth/me', { cookie: dave.cookie })).status).toBe(401);
    const me = await get('/auth/me', { cookie: done.cookie });
    expect(me.body).toMatchObject({ user: { id: other.id } });
  });

  describe('is protected against login CSRF', () => {
    it('refuses a callback from a browser that did not start the login (no cookie, or another one)', async () => {
      const { kernel, web } = await startApp();
      // The attacker starts a login and gets their own code and state ...
      const attacker = await web.start();
      const forged = await web.provider(attacker, person());
      // ... and tricks the victim's browser into opening the callback.
      const victimWithNothing = await web.callback(forged, undefined);
      expect(victimWithNothing.status).toBe(400);
      expect(isProblem(victimWithNothing)).toBe(true);
      expect(victimWithNothing.setCookie).toBeUndefined();

      const second = await web.start();
      const forged2 = await web.provider(second, person());
      const victim = await web.start(); // the victim's own, different, cookie
      const victimWithOther = await web.callback(forged2, victim);
      expect(victimWithOther.status).toBe(400);
      expect(await count(kernel, 'identity_user')).toBe(0);
      expect(await count(kernel, 'identity_session')).toBe(0);
      // The state is spent either way: the attacker cannot retry it from the right browser.
      expect((await web.callback(forged2, second)).status).toBe(400);
    });

    it('is a GET that only completes the login this browser started; POST is not accepted', async () => {
      const { post, web } = await startApp();
      const started = await web.start();
      const back = await web.provider(started, person());
      expect((await post(back.path)).status).toBeGreaterThanOrEqual(404);
    });
  });

  describe('validates what the provider sends', () => {
    it.each([
      ['no state', '?code=abc'],
      ['an empty state', '?state=&code=abc'],
      ['a state that is too long', `?state=${'a'.repeat(129)}&code=abc`],
      ['a code that is too long', `?state=abc&code=${'a'.repeat(2049)}`],
      ['two states', '?state=a&state=b&code=abc'],
      ['nothing', ''],
    ])('answers 422 for %s', async (_name, query) => {
      const { get } = await startApp();
      const reply = await get(`/auth/oidc/${PROVIDER}/callback${query}`);
      expect(reply.status).toBe(422);
      expect(isProblem(reply)).toBe(true);
    });

    it('answers 400 for an unknown state, a provider error, and a missing code, and 404 for an unknown provider', async () => {
      const { get, web } = await startApp();
      const unknown = await get(`/auth/oidc/${PROVIDER}/callback?state=${'x'.repeat(43)}&code=abc`);
      expect(unknown.status).toBe(400);
      expect(isProblem(unknown)).toBe(true);

      const started = await web.start();
      const back = await web.provider(started, person());
      const denied = await web.callback(
        {
          ...back,
          path: `/auth/oidc/${PROVIDER}/callback?state=${back.state}&error=access_denied&error_description=Secret+reason`,
        },
        started,
      );
      expect(denied.status).toBe(400);
      expect(JSON.stringify(denied.body)).not.toContain('Secret');
      expect(JSON.stringify(denied.body)).not.toContain('access_denied');

      const started2 = await web.start();
      const back2 = await web.provider(started2, person());
      const noCode = await web.callback(
        { ...back2, path: `/auth/oidc/${PROVIDER}/callback?state=${back2.state}` },
        started2,
      );
      expect(noCode.status).toBe(400);

      expect((await get(`/auth/oidc/nope/callback?state=a&code=b`)).status).toBe(404);
    });
  });

  it('uses the strict rate-limit bucket', async () => {
    const { get } = await startApp({
      rateLimits: { strict: { capacity: 2, refillPerSecond: 0.001 } },
    });
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await get(`/auth/oidc/${PROVIDER}/callback?state=abc&code=def`)).status);
    }
    expect(statuses).toEqual([400, 400, 429, 429]);
  });
});

describe('nothing secret is logged or answered', () => {
  it('keeps the code, state, nonce, verifier, id_token, session id and client secret out of the log and every body [ASVS-10.1.1]', async () => {
    const { kernel, web, logText } = await startApp();
    const user = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, user, { provider: PROVIDER, subject: 'known-sub' });
    const who = { ...person(), subject: 'known-sub' };
    const seen: string[] = [];
    const secretsOf = async () => {
      const started = await web.start();
      const back = await web.provider(started, who);
      seen.push(
        started.loginCookie,
        back.state,
        back.code,
        new URL(started.authorizationUrl).searchParams.get('nonce')!,
      );
      return { started, back };
    };

    const bodies: unknown[] = [];
    // success, replay, wrong browser, a wrong nonce
    const a = await secretsOf();
    const signedIn = await web.callback(a.back, a.started);
    expect(signedIn.status).toBe(302);
    seen.push(signedIn.cookie!);
    bodies.push(signedIn.body);
    bodies.push((await web.callback(a.back, a.started)).body);
    const b = await secretsOf();
    bodies.push((await web.callback(b.back, undefined)).body);
    idp.faults = { nonce: 'bad-nonce-value' };
    try {
      const c = await secretsOf();
      bodies.push((await web.callback(c.back, c.started)).body);
    } finally {
      idp.faults = {};
    }

    const everything = logText() + JSON.stringify(bodies);
    for (const secret of [...seen, idp.clientSecret, 'stub-access-token', 'bad-nonce-value']) {
      expect(secret.length).toBeGreaterThan(5);
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // no JWT
    // What the log does say is a reason code, so an operator can see why a login failed.
    expect(logText()).toContain('oidc login refused');
    expect(logText()).toContain('"reason":"nonce"');
    expect(logText()).toContain('"reason":"state-unknown"');
  });
});
