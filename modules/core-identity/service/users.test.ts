import { Conflict, Invalid } from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { verifyPassword } from './password.ts';

const identity = useIdentity();

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const local = (password = 'a long enough password') => ({ provider: 'local' as const, password });
const oidc = (subject: string, provider = 'lifescience-aai') => ({ provider, subject });

async function rowsOf(
  kernel: { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } },
  table: string,
) {
  return (await kernel.pool.query(`select * from ${table}`)).rows as Record<string, unknown>[];
}

/**
 * Denied-permission case: these methods take no actor and have no permission. They are the
 * building blocks that the register route, `create-admin` and OIDC provisioning call (sprints 2 to
 * 4); each of those checks who may call it. What this file proves instead is that a caller cannot
 * reach more than the methods offer: the input is strict, the result carries no hash and no
 * internal flag, and nothing can create an admin through `createUser`.
 */
describe('createUser', () => {
  it('creates a pending password account: the user and its auth method, with a UUIDv7 key', async () => {
    const { kernel, identity: id } = await identity.start();

    const created = await id.users.createUser({
      username: 'alice',
      email: 'alice@example.org',
      auth: local('correct horse battery'),
    });

    expect(created).toMatchObject({
      username: 'alice',
      email: 'alice@example.org',
      emailVerified: false,
      status: 'pending',
      deletedAt: null,
    });
    expect(created.id).toMatch(UUID_V7);
    const users = await rowsOf(kernel, 'identity_user');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: created.id, is_bootstrap_admin: false });
    const methods = await rowsOf(kernel, 'identity_auth_method');
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({
      user_id: created.id,
      provider: 'local',
      subject: created.id,
    });
    expect(methods[0]!.id).toMatch(UUID_V7);
  });

  it('stores the password only as an argon2id hash that verifies', async () => {
    const { kernel, identity: id } = await identity.start();
    await id.users.createUser({ username: 'alice', auth: local('correct horse battery') });

    const [method] = await rowsOf(kernel, 'identity_auth_method');
    const stored = method!.password_hash as string;
    expect(stored).toMatch(/^\$argon2id\$/);
    expect(stored).not.toContain('correct horse battery');
    expect(await verifyPassword(stored, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(stored, 'wrong horse battery')).toBe(false);
    expect(JSON.stringify(await rowsOf(kernel, 'identity_user'))).not.toContain('correct horse');
  });

  it('creates an account for an identity provider, with a verified address and no password', async () => {
    const { kernel, identity: id } = await identity.start();

    const created = await id.users.createUser({
      username: 'bob',
      email: 'bob@example.org',
      emailVerified: true,
      status: 'active',
      auth: oidc('sub-123'),
    });

    expect(created).toMatchObject({ emailVerified: true, status: 'active' });
    const [method] = await rowsOf(kernel, 'identity_auth_method');
    expect(method).toMatchObject({
      provider: 'lifescience-aai',
      subject: 'sub-123',
      password_hash: null,
    });
  });

  it('returns nothing that is secret or internal', async () => {
    const { identity: id } = await identity.start();
    const created = await id.users.createUser({ username: 'alice', auth: local() });
    expect(Object.keys(created).sort()).toEqual(
      ['createdAt', 'deletedAt', 'email', 'emailVerified', 'id', 'status', 'username'].sort(),
    );
    expect(JSON.stringify(created)).not.toMatch(/argon2|hash|bootstrap/i);
  });

  it('cannot create an admin, or smuggle in any other column', async () => {
    const { kernel, identity: id } = await identity.start();
    for (const extra of [
      { isBootstrapAdmin: true },
      { is_bootstrap_admin: true },
      { role: 'admin' },
      { id: 'x' },
    ]) {
      await expect(
        id.users.createUser({ username: 'mallory', auth: local(), ...extra }),
      ).rejects.toBeInstanceOf(Invalid);
    }
    expect(await rowsOf(kernel, 'identity_user')).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['a username with upper case', { username: 'Alice' }, 'username'],
    ['a username that is too short', { username: 'al' }, 'username'],
    ['an invalid email', { email: 'nope' }, 'email'],
    ['a short password', { auth: local('short') }, 'auth.password'],
    ['a status that is not allowed', { status: 'rejected' }, 'status'],
  ])('refuses %s with a 422 naming the field, and writes nothing', async (_name, patch, path) => {
    const { kernel, identity: id } = await identity.start();
    const error = await id.users
      .createUser({ username: 'alice', auth: local(), ...patch })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Invalid);
    expect((error as Invalid).status).toBe(422);
    expect((error as Invalid).errors?.map((e) => e.path)).toContain(path);
    expect(await rowsOf(kernel, 'identity_user')).toEqual([]);
    expect(await rowsOf(kernel, 'identity_auth_method')).toEqual([]);
  });

  it('does not repeat the password in the error', async () => {
    const { identity: id } = await identity.start();
    const error = await id.users
      .createUser({ username: 'alice', auth: local('tiny') })
      .catch((e: unknown) => e as Invalid);
    expect(
      JSON.stringify({ message: (error as Error).message, errors: (error as Invalid).errors }),
    ).not.toContain('tiny');
  });

  describe('the duplicate check', () => {
    it('refuses a taken username', async () => {
      const { identity: id } = await identity.start();
      await id.users.createUser({ username: 'alice', auth: local() });
      const error = await id.users
        .createUser({ username: 'alice', auth: local() })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Conflict);
      expect((error as Conflict).status).toBe(409);
    });

    it.each<
      [string, (id: Awaited<ReturnType<typeof identity.start>>['identity']) => Promise<unknown>]
    >([
      [
        'a password account',
        (id) =>
          id.users.createUser({ username: 'first', email: 'shared@example.org', auth: local() }),
      ],
      [
        'an identity-provider account',
        (id) =>
          id.users.createUser({
            username: 'first',
            email: 'shared@example.org',
            emailVerified: true,
            status: 'active',
            auth: oidc('sub-1'),
          }),
      ],
    ])('refuses an email address held by %s, in any letter case', async (_name, first) => {
      const { identity: id } = await identity.start();
      await first(id);
      for (const attempt of ['shared@example.org', 'Shared@Example.ORG']) {
        await expect(
          id.users.createUser({
            username: 'second',
            email: attempt,
            auth: oidc('sub-2', 'other-idp'),
          }),
        ).rejects.toBeInstanceOf(Conflict);
        await expect(
          id.users.createUser({ username: 'second', email: attempt, auth: local() }),
        ).rejects.toBeInstanceOf(Conflict);
      }
    });

    it('refuses an address that is not verified yet as well', async () => {
      const { kernel, identity: id } = await identity.start();
      await makeUser(kernel.pool, {
        username: 'first',
        email: 'held@example.org',
        emailVerified: false,
      });
      await expect(
        id.users.createUser({ username: 'second', email: 'held@example.org', auth: local() }),
      ).rejects.toBeInstanceOf(Conflict);
    });

    it('keeps the username of a soft-deleted account reserved', async () => {
      const { kernel, identity: id } = await identity.start();
      await makeUser(kernel.pool, { username: 'gone', deleted: true });
      await expect(id.users.createUser({ username: 'gone', auth: local() })).rejects.toBeInstanceOf(
        Conflict,
      );
    });

    it('refuses an identity that is already linked to another account', async () => {
      const { kernel, identity: id } = await identity.start();
      const owner = await makeUser(kernel.pool);
      await makeAuthMethod(kernel.pool, owner, { provider: 'lifescience-aai', subject: 'sub-1' });

      await expect(
        id.users.createUser({ username: 'second', auth: oidc('sub-1') }),
      ).rejects.toBeInstanceOf(Conflict);
      // The same subject at another provider is another identity.
      await expect(
        id.users.createUser({ username: 'third', auth: oidc('sub-1', 'other-idp') }),
      ).resolves.toBeTruthy();
    });

    it('lets two users without an email address exist', async () => {
      const { identity: id } = await identity.start();
      await id.users.createUser({ username: 'one', auth: local() });
      await expect(id.users.createUser({ username: 'two', auth: local() })).resolves.toBeTruthy();
    });
  });

  describe('rollback', () => {
    it('leaves neither row when the identity is taken (the user row was already written)', async () => {
      const { kernel, identity: id } = await identity.start();
      const owner = await makeUser(kernel.pool, { username: 'owner' });
      await makeAuthMethod(kernel.pool, owner, { provider: 'lifescience-aai', subject: 'sub-1' });

      await expect(
        id.users.createUser({ username: 'second', auth: oidc('sub-1') }),
      ).rejects.toBeInstanceOf(Conflict);

      expect((await rowsOf(kernel, 'identity_user')).map((r) => r.username)).toEqual(['owner']);
      expect(await rowsOf(kernel, 'identity_auth_method')).toHaveLength(1);
    });

    it('leaves neither row when the database fails while the auth method is written', async () => {
      const { kernel, identity: id } = await identity.start();
      await kernel.pool.query(`
        create function identity_test_fail() returns trigger language plpgsql as
          $$ begin raise exception 'disk on fire'; end $$;
        create trigger identity_test_fail before insert on identity_auth_method
          for each row execute function identity_test_fail();`);

      const error = await id.users
        .createUser({ username: 'alice', auth: local() })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(Conflict); // a bug or an outage is not the caller's conflict
      expect(await rowsOf(kernel, 'identity_user')).toEqual([]);
      expect(await rowsOf(kernel, 'identity_auth_method')).toEqual([]);
    });

    it('joins the caller’s transaction: when that rolls back, so does the user', async () => {
      const { kernel, identity: id } = await identity.start();
      await expect(
        kernel.db.tx(async () => {
          await id.users.createUser({ username: 'alice', auth: local() });
          throw new Error('the caller changed its mind');
        }),
      ).rejects.toThrow('changed its mind');
      expect(await rowsOf(kernel, 'identity_user')).toEqual([]);
      expect(await rowsOf(kernel, 'identity_auth_method')).toEqual([]);
    });
  });

  describe('two requests at once', () => {
    it('lets one create a username and answers the other with a 409, not a 500', async () => {
      const { kernel, identity: id } = await identity.start();
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => id.users.createUser({ username: 'alice', auth: local() })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((r) => r.status === 'rejected')) {
        expect(r.reason).toBeInstanceOf(Conflict);
      }
      expect(await rowsOf(kernel, 'identity_user')).toHaveLength(1);
      expect(await rowsOf(kernel, 'identity_auth_method')).toHaveLength(1);
    });

    it('links an identity to one account only', async () => {
      const { kernel, identity: id } = await identity.start();
      const results = await Promise.allSettled(
        ['one', 'two', 'three'].map((username) =>
          id.users.createUser({ username, auth: oidc('sub-1') }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((r) => r.status === 'rejected')) {
        expect(r.reason).toBeInstanceOf(Conflict);
      }
      expect(await rowsOf(kernel, 'identity_user')).toHaveLength(1);
    });
  });
});

describe('findByUsername', () => {
  it('finds a user by name in any letter case', async () => {
    const { identity: id } = await identity.start();
    const created = await id.users.createUser({ username: 'alice', auth: local() });
    expect(await id.users.findByUsername('alice')).toEqual(created);
    expect(await id.users.findByUsername('ALICE')).toEqual(created);
  });

  it('finds nothing for an unknown name, and treats odd input as plain text', async () => {
    const { identity: id } = await identity.start();
    await id.users.createUser({ username: 'alice', auth: local() });
    for (const name of ['bob', '', "' or 1=1 --", 'alice%', 'al_ce', 'a'.repeat(5000)]) {
      expect(await id.users.findByUsername(name)).toBeUndefined();
    }
  });

  it('finds a soft-deleted user and says so, so the caller can refuse the login', async () => {
    const { kernel, identity: id } = await identity.start();
    await makeUser(kernel.pool, { username: 'gone', deleted: true });
    expect((await id.users.findByUsername('gone'))?.deletedAt).toBeInstanceOf(Date);
  });
});

describe('findByEmail', () => {
  it('finds a user by address in any letter case', async () => {
    const { identity: id } = await identity.start();
    const created = await id.users.createUser({
      username: 'alice',
      email: 'Alice@Example.org',
      auth: local(),
    });
    expect(await id.users.findByEmail('alice@example.org')).toEqual(created);
    expect(await id.users.findByEmail('ALICE@EXAMPLE.ORG')).toEqual(created);
  });

  it('finds nothing for an unknown address, and treats odd input as plain text', async () => {
    const { identity: id } = await identity.start();
    await id.users.createUser({ username: 'alice', email: 'alice@example.org', auth: local() });
    for (const email of [
      'bob@example.org',
      '',
      "' or 1=1 --",
      '%@example.org',
      '_lice@example.org',
    ]) {
      expect(await id.users.findByEmail(email)).toBeUndefined();
    }
  });

  it('prefers the verified holder of an address over an unverified one', async () => {
    const { kernel, identity: id } = await identity.start();
    // The service refuses this state; it can still arise from an address that was verified later.
    const unverified = await makeUser(kernel.pool, {
      username: 'a-first',
      email: 'both@example.org',
    });
    const verified = await makeUser(kernel.pool, {
      username: 'b-second',
      email: 'both@example.org',
      emailVerified: true,
    });
    expect(unverified.id).not.toBe(verified.id);
    expect((await id.users.findByEmail('both@example.org'))?.id).toBe(verified.id);
  });
});
