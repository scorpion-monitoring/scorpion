// M2 acceptance as one story, through the real pipeline and Postgres (no browser: there is no UI
// before M5): register, be approved, confirm the address, sign in, make an access token and use it,
// change the password, reset it by mail, link an OIDC provider and sign in with it, edit the
// profile, sign out, and show that every copied credential is dead. At the end the log holds no
// secret from the whole story.
import { describe, expect, it } from 'vitest';
import { PASSWORD } from './testing/identity-app.ts';
import { person, useOidcApp } from './testing/oidc-flow.ts';

const { startApp } = useOidcApp();
const SECOND_PASSWORD = 'a second long passphrase';
const THIRD_PASSWORD = 'a third long passphrase';

const tokenIn = (mail: { text: string } | undefined) =>
  decodeURIComponent(/#token=([^\s]+)/.exec(mail?.text ?? '')![1]!);

describe('the account journey', () => {
  it('goes from registration to a dead cookie', async () => {
    const { post, get, call, signedIn, web, logText, identity, mail } = await startApp({
      tokenCacheTtlMs: 0,
    });
    const admin = await signedIn('admin', { roles: ['admin'] });

    // Register: accepted (the same answer for every address), pending, mails are queued (the welcome
    // mail, the confirmation link and one for the administrator), and the account cannot sign in yet.
    const registered = await post('/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
    });
    expect(registered.status).toBe(202);
    expect(registered.body).toEqual({ accepted: true });
    const { id } = (await identity.users.findByUsername('alice'))!;
    expect((await mail.templates()).sort()).toEqual([
      'identity.email-verification',
      'identity.registration-request',
      'identity.welcome',
    ]);
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: PASSWORD } })).status,
    ).toBe(403);

    // Approval by somebody else, then the address is confirmed from the mail.
    expect((await call('POST', `/users/${id}/approve`, admin)).status).toBe(200);
    expect(
      (
        await post('/auth/verify-email', {
          body: { token: tokenIn((await mail.of('identity.email-verification'))[0]) },
        })
      ).status,
    ).toBe(204);

    // Sign in.
    const login = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    expect(login.status).toBe(200);
    const session = {
      cookie: login.cookie!,
      csrf: (login.body as { csrfToken: string }).csrfToken,
    };
    expect((await get('/account/profile', session)).body).toMatchObject({
      username: 'alice',
      emailVerified: true,
    });

    // An access token, and a call with it instead of the cookie.
    const created = (
      await post('/tokens', { ...session, body: { name: 'ci', scopes: ['core.identity.me.read'] } })
    ).body as {
      token: string;
    };
    const bearer = { authorization: `Bearer ${created.token}` };
    expect((await get('/auth/me', { headers: bearer })).body).toMatchObject({
      user: { username: 'alice' },
      csrfToken: null,
    });
    // ... which cannot manage the account.
    expect((await get('/account/profile', { headers: bearer })).status).toBe(403);

    // Change the password: the old cookie and the old password are dead, the token is not.
    const changed = await call('POST', '/account/password', {
      ...session,
      body: { currentPassword: PASSWORD, newPassword: SECOND_PASSWORD },
    });
    expect(changed.status).toBe(204);
    expect((await get('/auth/me', { cookie: session.cookie })).status).toBe(401);
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: PASSWORD } })).status,
    ).toBe(401);
    expect((await get('/auth/me', { headers: bearer })).status).toBe(200);

    // Forget the password: reset it with the mailed link; every session ends again.
    const second = await post('/auth/login', {
      body: { username: 'alice', password: SECOND_PASSWORD },
    });
    expect(second.status).toBe(200);
    expect(
      (await post('/auth/password-reset', { body: { email: 'alice@example.org' } })).status,
    ).toBe(202);
    expect(await mail.of('identity.password-reset')).toHaveLength(1);
    const resetToken = tokenIn((await mail.of('identity.password-reset'))[0]);
    expect(
      (
        await post('/auth/password-reset/confirm', {
          body: { token: resetToken, password: THIRD_PASSWORD },
        })
      ).status,
    ).toBe(204);
    expect((await get('/auth/me', { cookie: second.cookie })).status).toBe(401);
    expect(
      (
        await post('/auth/password-reset/confirm', {
          body: { token: resetToken, password: THIRD_PASSWORD },
        })
      ).status,
    ).toBe(400); // the link works once
    const third = await post('/auth/login', {
      body: { username: 'alice', password: THIRD_PASSWORD },
    });
    expect(third.status).toBe(200);
    const live = { cookie: third.cookie!, csrf: (third.body as { csrfToken: string }).csrfToken };

    // Link an OIDC provider from the profile, then sign in with it.
    const who = person();
    const started = await web.start('link', live);
    const back = await web.provider(started, who);
    expect((await web.callback(back, started)).status).toBe(302);
    const viaOidc = await web.login(who);
    expect(viaOidc.reply.status).toBe(302);
    expect(viaOidc.reply.cookie).toBeTruthy();
    expect((await get('/auth/me', { cookie: viaOidc.reply.cookie })).body).toMatchObject({
      user: { username: 'alice' },
    });

    // Edit the profile.
    const edited = await call('PATCH', '/account/profile', {
      ...live,
      body: { displayName: 'Alice', bio: 'Plain text' },
    });
    expect(edited.body).toMatchObject({ displayName: 'Alice', bio: 'Plain text' });

    // Sign out: the cookie is cleared and a copy of it is dead.
    const out = await post('/auth/logout', live);
    expect(out.status).toBe(204);
    expect(out.cookie).toBe('');
    expect((await get('/auth/me', { cookie: live.cookie })).status).toBe(401);
    expect((await get('/auth/me', { cookie: viaOidc.reply.cookie })).status).toBe(200); // another session
    expect((await get('/auth/me', { headers: bearer })).status).toBe(200); // the token is its own credential

    // The whole story left no secret in the log.
    const log = logText();
    expect(log).toContain('"msg"');
    for (const secret of [
      created.token,
      created.token.slice(13),
      resetToken,
      session.cookie,
      second.cookie!,
      live.cookie,
      PASSWORD,
      SECOND_PASSWORD,
      THIRD_PASSWORD,
      'alice@example.org',
      '#token=',
    ]) {
      expect(log).not.toContain(secret);
    }
    expect((await identity.users.findByUsername('alice'))?.emailVerified).toBe(true);
  });
});
