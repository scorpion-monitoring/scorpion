// The two public routes the sign-in screens of M5 need: the providers a button may be drawn for, and
// whether the first-admin form has a use. Both answer anybody, so they say no more than a page shows.
import { describe, expect, it } from 'vitest';
import { PASSWORD, settingsWith, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();

const provider = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: `Provider ${id}`,
  issuer: `https://idp-${id}.example.org`,
  clientId: `client-${id}`,
  ...extra,
});
const ICON = 'a'.repeat(64);

describe('GET /auth/oidc/providers', () => {
  it('lists the id, the display name and the icon hash of each provider, and nothing else', async () => {
    const { get } = await app.start({
      settings: settingsWith({
        oidcProviders: [provider('one', { iconHash: ICON }), provider('two')],
      }),
    });
    const reply = await get('/auth/oidc/providers'); // no session: the route is public
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(reply.body).toEqual({
      metadata: { currentPage: 0, pageSize: 20, totalCount: 2, totalPages: 1 },
      result: [
        { id: 'one', displayName: 'Provider one', iconHash: ICON },
        { id: 'two', displayName: 'Provider two' },
      ],
    });
    const text = JSON.stringify(reply.body);
    for (const secret of ['idp-one', 'client-one', 'issuer', 'clientId', 'scopes'])
      expect(text).not.toContain(secret);
  });

  it('is an empty list when no provider is configured', async () => {
    const { get } = await app.start();
    const reply = await get('/auth/oidc/providers');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ result: [], metadata: { totalCount: 0 } });
  });

  it('refuses an icon hash that is not a SHA-256', async () => {
    const settings = settingsWith({ oidcProviders: [provider('one', { iconHash: 'logo.png' })] });
    await expect(Promise.resolve().then(() => settings.get())).rejects.toThrow();
  });

  it('pages like every list: an unknown query parameter and a bad page are 422', async () => {
    const { get } = await app.start({
      settings: settingsWith({ oidcProviders: [provider('one')] }),
    });
    expect((await get('/auth/oidc/providers?pageSize=0')).status).toBe(422);
    expect((await get('/auth/oidc/providers?q=x')).status).toBe(422);
    const second = await get('/auth/oidc/providers?page=1&pageSize=1');
    expect(second.body).toMatchObject({ result: [], metadata: { currentPage: 1, totalCount: 1 } });
  });
});

describe('GET /bootstrap/status', () => {
  it('says the first administrator is needed on an empty instance, to anybody', async () => {
    const { get } = await app.start();
    const reply = await get('/bootstrap/status');
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(reply.body).toEqual({ needsFirstAdmin: true });
  });

  it('is false once an administrator exists, and stays false', async () => {
    const { get, signedIn } = await app.start();
    await signedIn('boss', { roles: ['admin'] });
    expect((await get('/bootstrap/status')).body).toEqual({ needsFirstAdmin: false });
    expect((await get('/bootstrap/status')).body).toEqual({ needsFirstAdmin: false });
  });

  it('is still true while only ordinary users exist (they are not administrators)', async () => {
    const { get, signedIn } = await app.start();
    await signedIn('someone');
    expect((await get('/bootstrap/status')).body).toEqual({ needsFirstAdmin: true });
  });

  it('turns false when the first-run token is redeemed', async () => {
    const shown: string[] = [];
    const { get, post } = await app.start({ announce: (text) => shown.push(text) });
    const token = /sfr_[A-Za-z0-9_-]{43}/.exec(shown.join('\n'))![0];
    expect((await get('/bootstrap/status')).body).toEqual({ needsFirstAdmin: true });
    const made = await post('/bootstrap/first-admin', {
      body: { token, username: 'root', email: 'root@example.org', password: PASSWORD },
    });
    expect(made.status).toBe(201);
    expect((await get('/bootstrap/status')).body).toEqual({ needsFirstAdmin: false });
  });
});

describe('the problem type of a 403 at sign-in', () => {
  const credentials = { username: 'waiting', password: PASSWORD };

  it('is account-pending for an account that waits for approval, after the right password', async () => {
    const { post } = await app.start();
    await post('/auth/register', { body: { ...credentials, email: 'waiting@example.org' } });
    const reply = await post('/auth/login', { body: credentials });
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ status: 403, type: 'account-pending' });
    // The wrong password gives the same refusal as an unknown name, never this one.
    const wrong = await post('/auth/login', {
      body: { ...credentials, password: 'not the password' },
    });
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain('account-pending');
  });

  it('is local-accounts-disabled when the instance takes no passwords', async () => {
    const { post } = await app.start({ settings: settingsWith({ localAccounts: false }) });
    const login = await post('/auth/login', { body: credentials });
    expect(login.status).toBe(403);
    expect(login.body).toMatchObject({ type: 'local-accounts-disabled' });
    const register = await post('/auth/register', {
      body: { ...credentials, email: 'waiting@example.org' },
    });
    expect(register.body).toMatchObject({ status: 403, type: 'local-accounts-disabled' });
    const reset = await post('/auth/password-reset', { body: { email: 'waiting@example.org' } });
    expect(reset.body).toMatchObject({ status: 403, type: 'local-accounts-disabled' });
  });
});
