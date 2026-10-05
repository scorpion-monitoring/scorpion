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

  it('refuses a tampered nonce with 401 and creates no session and no user', async () => {
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

  it('refuses an id_token meant for another audience with 401', async () => {
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
});
