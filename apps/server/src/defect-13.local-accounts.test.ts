// Defect 13 (FEATURES §5): the old app hid the registration form when "Local Accounts" was off but
// still accepted the request, and it accepted any text as an email address. The server enforces the
// setting and validates the address. Never weaken this test.
import { describe, expect, it } from 'vitest';
import { PASSWORD, settingsWith, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const off = { settings: settingsWith({ localAccounts: false }) };
const registration = { username: 'alice', email: 'alice@example.org', password: PASSWORD };

describe('defect 13: local accounts', () => {
  it('are on by default (the module’s own schema supplies the default)', async () => {
    const { post, signedIn, identity } = await app.start();
    // 202, the same answer for every well-formed request (register without revealing); the account exists.
    expect((await post('/auth/register', { body: registration })).status).toBe(202);
    expect(await identity.users.findByUsername('alice')).toMatchObject({ status: 'pending' });
    expect((await signedIn('bobby')).cookie).toBeTruthy();
  });

  it('cannot be registered when the setting is off, by calling the API directly', async () => {
    const { post, kernel } = await app.start(off);
    const reply = await post('/auth/register', { body: registration });
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ status: 403 });
    expect((await kernel.pool.query('select 1 from identity_user')).rows).toEqual([]);
  });

  it('cannot sign in when the setting is off, even with the right password', async () => {
    const { post, kernel, identity } = await app.start(off);
    await identity.users.createUser({
      username: 'alice',
      email: 'alice@example.org',
      auth: { provider: 'local', password: PASSWORD },
      status: 'active',
    });
    const reply = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    expect(reply.status).toBe(403);
    expect(reply.cookie).toBeUndefined();
    expect((await kernel.pool.query('select 1 from identity_session')).rows).toEqual([]);
  });

  it.each([
    ['text without an @', 'not-an-email'],
    ['no domain', 'alice@'],
    ['no name', '@example.org'],
    ['spaces', 'alice @example.org'],
    ['two @', 'a@b@example.org'],
    ['a number', 12345],
    ['too long', `${'a'.repeat(250)}@example.org`],
  ])('rejects an invalid email address (%s) with 422, never 500', async (_name, email) => {
    const { post, kernel } = await app.start();
    const reply = await post('/auth/register', { body: { ...registration, email } });
    expect(reply.status).toBe(422);
    expect(reply.body).toMatchObject({ status: 422 });
    expect(JSON.stringify(reply.body)).not.toContain(PASSWORD);
    expect((await kernel.pool.query('select 1 from identity_user')).rows).toEqual([]);
  });

  it('rejects a registration without an email address with 422', async () => {
    const { post } = await app.start();
    const withoutEmail = { username: registration.username, password: registration.password };
    expect((await post('/auth/register', { body: withoutEmail })).status).toBe(422);
  });

  it('answers an invalid email with 422 whether or not local accounts are on', async () => {
    const { post } = await app.start(off);
    expect(
      (await post('/auth/register', { body: { ...registration, email: 'not-an-email' } })).status,
    ).toBe(422);
  });
});

describe('defect 13: turning local accounts off through the settings API', () => {
  const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
  const turnOff = (
    s: { call: Awaited<ReturnType<typeof app.start>>['call'] },
    who: { cookie: string; csrf: string },
    version = 0,
  ) =>
    s.call('PUT', '/settings/core.identity', {
      ...as(who),
      body: { version, values: { localAccounts: false } },
    });

  it('takes effect at once in the process that saved it: register and login answer 403', async () => {
    const s = await app.start();
    const boss = await s.signedIn('boss', { roles: ['admin'] });
    const member = await s.signedIn('member');
    expect((await turnOff(s, boss)).status).toBe(200);
    const register = await s.post('/auth/register', { body: registration });
    expect(register.status).toBe(403);
    const login = await s.post('/auth/login', { body: { username: 'member', password: PASSWORD } });
    expect(login.status).toBe(403);
    expect(login.cookie).toBeUndefined();
    expect(
      (await s.kernel.pool.query("select 1 from identity_user where username = 'alice'")).rows,
    ).toEqual([]);
    void member;
  });

  it('cannot be done by a user who is not an administrator, and nothing changes', async () => {
    const s = await app.start();
    const member = await s.signedIn('member');
    expect((await turnOff(s, member)).status).toBe(403);
    expect((await s.kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
    expect((await s.post('/auth/register', { body: registration })).status).toBe(202);
    // An anonymous caller is refused too.
    expect(
      (
        await s.call('PUT', '/settings/core.identity', {
          body: { version: 0, values: { localAccounts: false } },
        })
      ).status,
    ).toBe(401);
  });

  it('turns back on the same way', async () => {
    const s = await app.start();
    const boss = await s.signedIn('boss', { roles: ['admin'] });
    await turnOff(s, boss);
    const back = await s.call('PUT', '/settings/core.identity', {
      ...as(boss),
      body: { version: 1, values: { localAccounts: true } },
    });
    expect(back.status).toBe(200);
    expect((await s.post('/auth/register', { body: registration })).status).toBe(202);
  });

  it('reaches a second server process within the cache TTL (two kernels over one database)', async () => {
    let nowB = 1_000;
    const a = await app.start({ settingsModule: { cacheTtlMs: 5_000 } });
    const b = await app.start({
      databaseUrl: a.databaseUrl,
      settingsModule: { cacheTtlMs: 5_000, now: () => nowB },
    });
    const boss = await a.signedIn('boss', { roles: ['admin'] });
    // B has read the setting (local accounts are on) and holds it in its cache.
    expect(
      (await b.post('/auth/register', { body: { ...registration, username: 'first' } })).status,
    ).toBe(202);

    expect((await turnOff(a, boss)).status).toBe(200);
    expect((await a.post('/auth/register', { body: registration })).status).toBe(403); // A at once

    // Inside the bound B may still answer from its cache ...
    expect(
      (
        await b.post('/auth/register', {
          body: { ...registration, username: 'second', email: 'second@example.org' },
        })
      ).status,
    ).toBe(202);
    // ... and once the TTL has passed, B refuses as well: register and login.
    nowB += 5_000;
    expect(
      (
        await b.post('/auth/register', {
          body: { ...registration, username: 'third', email: 'third@example.org' },
        })
      ).status,
    ).toBe(403);
    const login = await b.post('/auth/login', { body: { username: 'boss', password: PASSWORD } });
    expect(login.status).toBe(403);
  });

  it('answers a taken address exactly like a new one while on, and 403 for both while off (no oracle through the setting)', async () => {
    const on = await app.start();
    await on.signedIn('holder', { email: 'alice@example.org' });
    const fresh = await on.post('/auth/register', {
      body: { ...registration, username: 'fresh', email: 'fresh@example.org' },
    });
    const taken = await on.post('/auth/register', { body: registration });
    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toEqual(fresh.body);
    expect(taken.body).toEqual({ accepted: true });
    expect(taken.res.headers.get('content-type')).toBe(fresh.res.headers.get('content-type'));
    expect(taken.setCookie).toBeUndefined();
    // The owner of the taken address is told; nothing was created for it.
    expect((await on.mail.of('identity.register-attempt')).map((m) => m.to)).toEqual([
      'alice@example.org',
    ]);
    expect(await on.identity.users.findByUsername('alice')).toBeUndefined();

    const closed = await app.start(off);
    await closed.signedIn('holder', { email: 'alice@example.org' });
    const closedTaken = await closed.post('/auth/register', { body: registration });
    const closedFresh = await closed.post('/auth/register', {
      body: { ...registration, username: 'fresh', email: 'fresh@example.org' },
    });
    expect([closedTaken.status, closedFresh.status]).toEqual([403, 403]);
    const withoutId = (body: unknown) => ({ ...(body as object), requestId: undefined });
    expect(withoutId(closedTaken.body)).toEqual(withoutId(closedFresh.body));
    expect(await closed.mail.of('identity.register-attempt')).toEqual([]);
  });
});
