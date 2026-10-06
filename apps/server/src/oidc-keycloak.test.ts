// The OIDC flow against a real Keycloak (a pinned image, one container for this file): the full
// login, and the failures a real provider can produce or a hostile browser can attempt. It adds
// about a minute to CI (image start-up); the stub-provider tests cover the same checks quickly.
import {
  KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET,
  KEYCLOAK_USERS,
  KEYCLOAK_WRONG_AUDIENCE_CLIENT_ID,
  makeRoleAssignment,
  makeUser,
  startKeycloak,
  type KeycloakUser,
  type StartedKeycloak,
} from '@scorpion/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settingsWith, useIdentityApp } from './testing/identity-app.ts';
import { browser } from './testing/oidc-flow.ts';

const PROVIDER_ID = 'keycloak';
const REDIRECT_URI = `http://localhost:3000/api/internal/auth/oidc/${PROVIDER_ID}/callback`;

const app = useIdentityApp();
let keycloak: StartedKeycloak;
beforeAll(async () => {
  keycloak = await startKeycloak({ redirectUri: REDIRECT_URI });
}, 300_000);
afterAll(async () => {
  await keycloak?.stop();
});

const settings = (clientId = KEYCLOAK_CLIENT_ID) =>
  settingsWith({
    localAccounts: true,
    approvalPolicy: 'manual',
    oidcProviders: [
      {
        id: PROVIDER_ID,
        displayName: 'Keycloak',
        issuer: keycloak.issuer,
        clientId,
        scopes: ['openid', 'email', 'profile'],
      },
    ],
  });

async function startApp(options: Parameters<typeof app.start>[0] = {}) {
  // The client secret is in the encrypted secrets store, as `scorpion set-secret` puts it there
  // (ADR 0016); the module's default lookup reads it from there, with no environment variable.
  const started = await app.start({ settings: settings(), ...options });
  await started.settings.secrets.setAsSystem(
    `oidc.${PROVIDER_ID}.client-secret`,
    KEYCLOAK_CLIENT_SECRET,
  );
  expect(started.kernel.config.ORIGIN).toBe('http://localhost:3000'); // what the realm registered
  const count = async (table: string) =>
    Number(
      (
        (await started.kernel.pool.query(`select count(*) from ${table}`)).rows[0] as {
          count: string;
        }
      ).count,
    );
  return {
    ...started,
    count,
    web: browser<KeycloakUser>(started, keycloak, PROVIDER_ID),
  };
}

const alice = KEYCLOAK_USERS.alice;
const mallory = KEYCLOAK_USERS.mallory;

describe('against Keycloak', { timeout: 60_000 }, () => {
  it('runs the full flow: PKCE, nonce, code exchange, id_token validation, a session', async () => {
    const { kernel, web, get, count } = await startApp();

    // Keycloak is new to Scorpion: the first login creates a pending account (403, no session) that
    // keeps the address Keycloak verified.
    const first = await web.login(alice);
    expect(first.reply.status).toBe(403);
    expect(first.started.authorizationUrl).toContain('code_challenge_method=S256');
    expect(await count('identity_session')).toBe(0);
    const { rows } = await kernel.pool.query<{ id: string; email: string; verified: boolean }>(
      'select id, email, email_verified_at is not null as verified from identity_user',
    );
    expect(rows).toEqual([
      { id: expect.any(String) as unknown, email: alice.email, verified: true },
    ]);

    // Once an approver activates it (status and role, as approval does), the same login gives a session.
    await kernel.pool.query("update identity_user set status = 'active'");
    await makeRoleAssignment(kernel.pool, { id: rows[0]!.id }, 'user');
    const second = await web.login(alice);
    expect(second.reply.status).toBe(302);
    expect(second.reply.res.headers.get('location')).toBe('/');
    const me = await get('/auth/me', { cookie: second.reply.cookie });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user: { id: rows[0]!.id, email: alice.email, emailVerified: true },
    });
    expect(await count('identity_session')).toBe(1);
    expect(await count('identity_user')).toBe(1);
  });

  it('refuses a tampered nonce with 401 and creates no session and no user [ASVS-10.5.1]', async () => {
    const { web, count, logText } = await startApp();
    const started = await web.start();
    const url = new URL(started.authorizationUrl);
    url.searchParams.set('nonce', 'a-nonce-the-attacker-chose');
    const back = await web.provider({ ...started, authorizationUrl: url.toString() }, alice);
    const reply = await web.callback(back, started);
    expect(reply.status).toBe(401);
    expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    expect(logText()).toContain('"reason":"nonce"');
    expect(reply.setCookie).toBeUndefined();
    expect(await count('identity_session')).toBe(0);
    expect(await count('identity_user')).toBe(0);
  });

  it('refuses an id_token meant for another audience with 401 [ASVS-10.5.4]', async () => {
    const { web, count } = await startApp({
      settings: settings(KEYCLOAK_WRONG_AUDIENCE_CLIENT_ID),
    });
    const { reply } = await web.login(alice);
    expect(reply.status).toBe(401);
    expect(reply.setCookie).toBeUndefined();
    expect(await count('identity_session')).toBe(0);
    expect(await count('identity_user')).toBe(0);
  });

  it('refuses a replayed state with 400', async () => {
    const { web, count } = await startApp();
    const started = await web.start();
    const back = await web.provider(started, alice);
    expect((await web.callback(back, started)).status).toBe(403); // pending: the state is used up
    const users = await count('identity_user');
    const replay = await web.callback(back, started);
    expect(replay.status).toBe(400);
    expect(replay.setCookie).toBeUndefined();
    expect(await count('identity_session')).toBe(0);
    expect(await count('identity_user')).toBe(users);
  });

  it('refuses an expired state with 400', async () => {
    const { kernel, web, count } = await startApp();
    const started = await web.start();
    const back = await web.provider(started, alice);
    await kernel.pool.query(
      "update identity_login_state set expires_at = now() - interval '1 second'",
    );
    const reply = await web.callback(back, started);
    expect(reply.status).toBe(400);
    expect(await count('identity_session')).toBe(0);
    expect(await count('identity_user')).toBe(0);
  });

  it('does not link a verified-looking login to an account by an address Keycloak did not verify', async () => {
    const { kernel, web, count } = await startApp();
    await makeUser(kernel.pool, { email: mallory.email, emailVerified: true });
    const { reply } = await web.login(mallory);
    expect(reply.status).toBe(403); // a new pending account without an address, not the existing one
    expect(await count('identity_user')).toBe(2);
    const created = await kernel.pool.query(
      "select user_id from identity_auth_method where provider = 'keycloak'",
    );
    expect(created.rows).toHaveLength(1);
  });

  it('links a provider only after the account holder confirms by mail: nothing links and nobody signs in at the first sign-in [ASVS-6.8.1]', async () => {
    const { kernel, web, signedIn, post, get, mail, count } = await startApp();
    // Scorpion has an account that holds the address Keycloak verified for alice.
    const owner = await signedIn('owner', { email: alice.email });

    // 1. Keycloak asserts the address. Nothing is linked and nobody is signed in: a notice page, and
    // a mail to the account's own address that names Keycloak.
    const first = await web.login(alice);
    expect(first.reply.status).toBe(302);
    expect(first.reply.res.headers.get('location')).toBe('/login?notice=check-mail');
    expect(first.reply.setCookie).toBeUndefined();
    expect(await count('identity_auth_method')).toBe(1); // the owner's password only
    expect(await count('identity_session')).toBe(1); // the owner's own
    const [sent] = await mail.of('identity.oidc-link');
    expect(sent!.to).toBe(alice.email);
    expect(sent!.text).toContain('Keycloak');

    // 2. Asking again does not sign in either, and the new link replaces the old one.
    const second = await web.login(alice);
    expect(second.reply.status).toBe(302);
    expect(second.reply.cookie).toBeUndefined();
    const mails = await mail.of('identity.oidc-link');
    expect(mails).toHaveLength(2);
    const token = decodeURIComponent(/#token=([A-Za-z0-9_%-]+)/.exec(mails[1]!.text ?? '')![1]!);

    // 3. Nobody else can use the link: no session at all, or another account's.
    expect((await post('/account/oidc-link/confirm', { body: { token } })).status).toBe(401);
    const other = await signedIn('other', { email: 'other@example.org' });
    expect(
      (
        await post('/account/oidc-link/confirm', {
          body: { token },
          cookie: other.cookie,
          csrf: other.csrf,
        })
      ).status,
    ).toBe(400);
    expect(await count('identity_auth_method')).toBe(2); // the two password accounts

    // 4. The account holder, signed in, confirms. Only now is Keycloak linked.
    const confirmed = await post('/account/oidc-link/confirm', {
      body: { token },
      cookie: owner.cookie,
      csrf: owner.csrf,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ provider: PROVIDER_ID, name: 'Keycloak' });
    expect(
      (
        await kernel.pool.query(
          "select user_id from identity_auth_method where provider = 'keycloak'",
        )
      ).rows,
    ).toEqual([{ user_id: owner.user.id }]);
    // Once only.
    expect(
      (
        await post('/account/oidc-link/confirm', {
          body: { token },
          cookie: owner.cookie,
          csrf: owner.csrf,
        })
      ).status,
    ).toBe(400);

    // 5. Now alice's Keycloak sign-in is the owner's.
    const login = await web.login(alice);
    expect(login.reply.status).toBe(302);
    expect(login.reply.res.headers.get('location')).toBe('/');
    expect((await get('/auth/me', { cookie: login.reply.cookie })).body).toMatchObject({
      user: { id: owner.user.id },
    });
  });

  it('sends no link mail for an address Keycloak did not verify', async () => {
    const { kernel, web, mail } = await startApp();
    await makeUser(kernel.pool, { email: mallory.email, emailVerified: true });
    await web.login(mallory);
    expect(await mail.of('identity.oidc-link')).toEqual([]);
  });

  it('re-authenticates for real: prompt=login and max_age=0 make Keycloak ask for the password again, and auth_time is checked (ADR 0025)', async () => {
    const sso = keycloak.browser(); // one browser, so Keycloak's single sign-on session survives
    const { kernel, call, get, logText } = await startApp();
    const web2 = browser<KeycloakUser>({ call }, sso, PROVIDER_ID);

    // The first login makes the pending account; once approved, the second gives a session. Keycloak
    // shows its login form for the first and answers the second from the single sign-on session.
    await web2.login(alice);
    const [{ id }] = (await kernel.pool.query<{ id: string }>('select id from identity_user'))
      .rows as [{ id: string }];
    await kernel.pool.query("update identity_user set status = 'active'");
    await makeRoleAssignment(kernel.pool, { id }, 'user');
    const login = await web2.login(alice);
    expect(login.reply.status).toBe(302);
    expect(sso.formsShown).toBe(1);
    const cookie = login.reply.cookie!;
    const csrf = ((await get('/auth/me', { cookie })).body as { csrfToken: string }).csrfToken;
    const session = { cookie, csrf };
    const stale = () =>
      kernel.pool.query(
        "update identity_session set authenticated_at = now() - interval '2 hours'",
      );
    const changeEmail = () =>
      call('PATCH', '/account/profile', { ...session, body: { email: 'new@example.org' } });

    // 1. Without a recent authentication the change is refused ...
    await stale();
    expect((await changeEmail()).status).toBe(401);
    // ... and a real re-authentication, in which Keycloak shows its form again, allows it.
    const started = await web2.start('reauthenticate', session);
    const asked = new URL(started.authorizationUrl).searchParams;
    expect([asked.get('prompt'), asked.get('max_age')]).toEqual(['login', '0']);
    const back = await web2.provider(started, alice);
    expect(sso.formsShown).toBe(2);
    const done = await web2.callback(back, started, { session: session.cookie });
    expect(done.status).toBe(302);
    expect(done.setCookie).toBeUndefined();
    expect((await changeEmail()).status).toBe(200);

    // 2. A provider that ignores the request (here: the request loses its prompt and max_age, so
    // Keycloak answers from its single sign-on session) sends the old auth_time. The state says the
    // request was made later than that login, so the id_token is refused.
    await stale();
    const ignoring = await web2.start('reauthenticate', session);
    const url = new URL(ignoring.authorizationUrl);
    url.searchParams.delete('prompt');
    url.searchParams.delete('max_age');
    const answered = await web2.provider({ ...ignoring, authorizationUrl: url.toString() }, alice);
    expect(sso.formsShown).toBe(2); // no form: the single sign-on session answered
    await kernel.pool.query(
      "update identity_login_state set created_at = now() + interval '10 minutes'",
    );
    const refused = await web2.callback(answered, ignoring, { session: session.cookie });
    expect(refused.status).toBe(401);
    expect(logText()).toContain('"reason":"auth-time-stale"');
    expect((await changeEmail()).status).toBe(401);
  });
});
