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
    const { post, signedIn } = await app.start();
    expect((await post('/auth/register', { body: registration })).status).toBe(201);
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
