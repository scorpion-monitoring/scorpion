import {
  Conflict,
  Forbidden,
  Invalid,
  Unauthorized,
  ANONYMOUS,
  type Actor,
  type UserActor,
} from '@scorpion/contracts';
import { makeAuthMethod, makeRoleAssignment, makeUser } from '@scorpion/testing';
import { describe, expect, it, vi } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { csrfTokenFor } from './session-id.ts';
import { settingsSchema, type IdentitySettings } from './settings.ts';

const identity = useIdentity();
const PASSWORD = 'correct horse battery';

const settingsOf = (
  values: Partial<ReturnType<typeof settingsSchema.parse>>,
): IdentitySettings => ({
  get: () => Promise.resolve(settingsSchema.parse(values)),
});
const actorOf = (user: { id: string; username: string }): UserActor => ({
  kind: 'user',
  userId: user.id,
  username: user.username,
  roles: [],
  via: 'session',
});
const all = async (
  kernel: { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } },
  table: string,
) => (await kernel.pool.query(`select * from ${table}`)).rows as Record<string, unknown>[];

/** A user who can sign in with `PASSWORD`. */
async function withPassword(
  kernel: { pool: Parameters<typeof makeMember>[0] },
  overrides: Parameters<typeof makeMember>[1] = {},
) {
  const user = await makeMember(kernel.pool, overrides);
  await makeAuthMethod(kernel.pool, user, { passwordHash: await hashPassword(PASSWORD) });
  return user;
}

describe('register', () => {
  const input = { username: 'alice', email: 'alice@example.org', password: PASSWORD };

  it('creates a pending account with a password hash, under the manual policy', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = (await id.accounts.register(input))!;
    expect(user).toMatchObject({
      username: 'alice',
      email: 'alice@example.org',
      status: 'pending',
    });
    const [method] = await all(kernel, 'identity_auth_method');
    expect(method).toMatchObject({ user_id: user.id, provider: 'local' });
    expect(await verifyPassword(method!.password_hash as string, PASSWORD)).toBe(true);
    expect(JSON.stringify(user)).not.toContain(PASSWORD);
  });

  it('emits identity.user.registered@1 in the same transaction as the rows', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = (await id.accounts.register(input))!;
    const events = await all(kernel, 'kernel_outbox');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'identity.user.registered@1',
      emitter: 'core.identity',
      payload: { userId: user.id, username: 'alice', status: 'pending' },
    });
    expect(JSON.stringify(events)).not.toContain(PASSWORD);
    expect(JSON.stringify(events)).not.toContain('alice@example.org');
  });

  it('refuses when local accounts are off (defect 13), and writes nothing', async () => {
    const { kernel, identity: id } = await identity.start({
      settings: settingsOf({ localAccounts: false }),
    });
    await expect(id.accounts.register(input)).rejects.toBeInstanceOf(Forbidden);
    expect(await all(kernel, 'identity_user')).toEqual([]);
  });

  it.each([
    ['no email', { username: 'alice', password: PASSWORD }],
    ['a malformed email', { ...input, email: 'not-an-email' }],
    ['an email without a domain', { ...input, email: 'alice@' }],
    ['a short password', { ...input, password: 'short' }],
    ['an upper-case username', { ...input, username: 'Alice' }],
    ['an unknown field', { ...input, status: 'active' }],
    ['not an object', 'alice'],
  ])('refuses %s with a 422 and does not repeat the password', async (_name, body) => {
    const { kernel, identity: id } = await identity.start();
    const error = await id.accounts.register(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    expect(JSON.stringify(error)).not.toContain(PASSWORD);
    expect((error as Error).message).not.toContain(PASSWORD);
    expect(await all(kernel, 'identity_user')).toEqual([]);
  });

  it('answers 409 for a taken username, whatever way its holder signs in (usernames are public)', async () => {
    const { kernel, identity: id } = await identity.start();
    const oidc = await makeMember(kernel.pool, { username: 'bob', email: 'bob@example.org' });
    await makeAuthMethod(kernel.pool, oidc, { provider: 'lifescience-aai' });
    await expect(id.accounts.register({ ...input, username: 'bob' })).rejects.toBeInstanceOf(
      Conflict,
    );
    // The username is checked first: a taken username with a taken address is the same 409.
    await expect(
      id.accounts.register({ ...input, username: 'bob', email: 'bob@example.org' }),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('does not reveal a taken email address: nothing is created and the caller gets no error (M4 decision 4)', async () => {
    const { kernel, identity: id, mail } = await identity.start();
    const oidc = await makeMember(kernel.pool, { username: 'bob', email: 'bob@example.org' });
    await makeAuthMethod(kernel.pool, oidc, { provider: 'lifescience-aai' });
    await kernel.pool.query("update identity_user set status = 'active'");

    await expect(
      id.accounts.register({ ...input, email: 'BOB@example.org' }),
    ).resolves.toBeUndefined();

    expect(await all(kernel, 'identity_user')).toHaveLength(1); // still only bob
    // The owner hears about it, in the one mail that exists; no welcome, no confirmation link.
    expect(await mail.all()).toMatchObject([
      { template: 'identity.register-attempt', to: 'bob@example.org', userId: oidc.id },
    ]);
    expect(await all(kernel, 'kernel_outbox')).toEqual([]); // and no event
  });

  it('lets a policy from another module decide the status from the registration context', async () => {
    const seen = vi.fn();
    const { identity: id } = await identity.start({
      settings: settingsOf({ approvalPolicy: 'trusted-domain' }),
      extraModule: {
        id: 'test.policy',
        manifest: {
          id: 'test.policy',
          version: '1.0.0',
          contributes: {
            'auth.approvalPolicy': [
              {
                id: 'trusted-domain',
                decide: (registration: { email?: string }) => {
                  seen(registration);
                  return {
                    status: registration.email?.endsWith('@ipk-gatersleben.de')
                      ? 'active'
                      : 'pending',
                  };
                },
              },
            ],
          },
        },
      },
    });

    const trusted = (await id.accounts.register({ ...input, email: 'a@ipk-gatersleben.de' }))!;
    const other = (await id.accounts.register({
      ...input,
      username: 'carol',
      email: 'c@example.org',
    }))!;

    expect(trusted.status).toBe('active');
    expect(other.status).toBe('pending');
    expect(seen).toHaveBeenCalledWith({
      username: 'alice',
      email: 'a@ipk-gatersleben.de',
      emailVerified: false,
      provider: 'local',
    });
    // The context a policy sees never holds the password.
    expect(JSON.stringify(seen.mock.calls)).not.toContain(PASSWORD);
  });

  it('keeps the account pending when the configured policy is not installed', async () => {
    const { identity: id } = await identity.start({
      settings: settingsOf({ approvalPolicy: 'gone' }),
    });
    expect((await id.accounts.register(input))?.status).toBe('pending');
  });

  describe('rollback', () => {
    it('leaves no user, no auth method and no event when writing the auth method fails', async () => {
      const { kernel, identity: id } = await identity.start();
      await kernel.pool.query(`
        create function identity_test_fail() returns trigger language plpgsql as
          $$ begin raise exception 'disk on fire'; end $$;
        create trigger identity_test_fail before insert on identity_auth_method
          for each row execute function identity_test_fail();`);

      const error = await id.accounts.register(input).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(Conflict);
      expect(await all(kernel, 'identity_user')).toEqual([]);
      expect(await all(kernel, 'identity_auth_method')).toEqual([]);
      expect(await all(kernel, 'kernel_outbox')).toEqual([]);
    });

    it('leaves no user and no auth method when emitting the event fails', async () => {
      const { kernel, identity: id } = await identity.start();
      await kernel.pool.query(`
        create function identity_test_fail() returns trigger language plpgsql as
          $$ begin raise exception 'outbox on fire'; end $$;
        create trigger identity_test_fail before insert on kernel_outbox
          for each row execute function identity_test_fail();`);

      await expect(id.accounts.register(input)).rejects.toThrow();

      expect(await all(kernel, 'identity_user')).toEqual([]);
      expect(await all(kernel, 'identity_auth_method')).toEqual([]);
    });
  });
});

describe('login', () => {
  it('starts a session and returns the user and the CSRF token of that session', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await withPassword(kernel, { username: 'alice' });

    const result = await id.accounts.login({ username: 'alice', password: PASSWORD });

    expect(result.user).toMatchObject({ id: user.id, username: 'alice' });
    expect(result.csrfToken).toBe(csrfTokenFor(result.sessionId));
    expect(await id.sessions.resolve(result.sessionId)).toMatchObject({ userId: user.id });
    const [method] = await all(kernel, 'identity_auth_method');
    expect(method!.last_login_at).not.toBeNull();
    const [row] = await all(kernel, 'identity_session');
    expect(JSON.stringify(row)).not.toContain(result.sessionId);
  });

  it('accepts the username in any letter case', async () => {
    const { kernel, identity: id } = await identity.start();
    await withPassword(kernel, { username: 'alice' });
    await expect(
      id.accounts.login({ username: 'ALICE', password: PASSWORD }),
    ).resolves.toBeTruthy();
  });

  it('gives an unknown user and a wrong password the same answer', async () => {
    const { kernel, identity: id } = await identity.start();
    await withPassword(kernel, { username: 'alice' });
    const unknown = await id.accounts
      .login({ username: 'nobody', password: PASSWORD })
      .catch((e: unknown) => e);
    const wrong = await id.accounts
      .login({ username: 'alice', password: 'wrong password' })
      .catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(Unauthorized);
    expect(wrong).toBeInstanceOf(Unauthorized);
    expect({ ...(unknown as Error), message: (unknown as Error).message }).toEqual({
      ...(wrong as Error),
      message: (wrong as Error).message,
    });
    expect(await all(kernel, 'identity_session')).toEqual([]);
  });

  it('does the password work for an unknown user as well (no early return that shows in the timing)', async () => {
    const { kernel, identity: id } = await identity.start();
    await withPassword(kernel, { username: 'alice' });
    const time = async (username: string) => {
      const start = process.hrtime.bigint();
      await id.accounts.login({ username, password: 'wrong password' }).catch(() => undefined);
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    await time('nobody'); // the decoy hash is made on first use
    const [known, unknown] = [await time('alice'), await time('nobody')];
    // Both ran a full hash check; neither is an order of magnitude faster than the other.
    expect(unknown).toBeGreaterThan(known / 5);
  });

  it('treats an account that signs in another way, with no password, like an unknown user', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeMember(kernel.pool, { username: 'oidc-only' });
    await makeAuthMethod(kernel.pool, user, { provider: 'lifescience-aai' });
    await expect(
      id.accounts.login({ username: 'oidc-only', password: PASSWORD }),
    ).rejects.toBeInstanceOf(Unauthorized);
  });

  it('tells a pending account to wait, but only after the right password', async () => {
    const { kernel, identity: id } = await identity.start();
    await withPassword(kernel, { username: 'alice', status: 'pending' });
    await expect(
      id.accounts.login({ username: 'alice', password: PASSWORD }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      id.accounts.login({ username: 'alice', password: 'wrong password' }),
    ).rejects.toBeInstanceOf(Unauthorized);
    expect(await all(kernel, 'identity_session')).toEqual([]);
  });

  it.each([
    ['rejected', { status: 'rejected' as const }],
    ['soft-deleted', { deleted: true }],
  ])('refuses a %s account with the answer for a wrong password', async (_name, overrides) => {
    const { kernel, identity: id } = await identity.start();
    await withPassword(kernel, { username: 'alice', ...overrides });
    const error = await id.accounts
      .login({ username: 'alice', password: PASSWORD })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Unauthorized);
    expect((error as Error).message).toBe('The username or password is wrong.');
    expect(await all(kernel, 'identity_session')).toEqual([]);
  });

  it('refuses when local accounts are off (defect 13), even with the right password', async () => {
    const { kernel, identity: id } = await identity.start({
      settings: settingsOf({ localAccounts: false }),
    });
    await withPassword(kernel, { username: 'alice' });
    await expect(
      id.accounts.login({ username: 'alice', password: PASSWORD }),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await all(kernel, 'identity_session')).toEqual([]);
  });

  it.each([
    ['no password', { username: 'alice' }],
    ['an empty password', { username: 'alice', password: '' }],
    ['an over-long password', { username: 'alice', password: 'x'.repeat(256) }],
    ['a number as username', { username: 5, password: PASSWORD }],
    ['an extra field', { username: 'alice', password: PASSWORD, remember: true }],
  ])('refuses %s with a 422', async (_name, body) => {
    const { identity: id } = await identity.start();
    await expect(id.accounts.login(body)).rejects.toBeInstanceOf(Invalid);
  });

  it('ends the session the browser held before, so an old id cannot be carried over [ASVS-7.2.4]', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    await withPassword(kernel, { username: 'alice' });
    const first = await id.accounts.login({ username: 'alice', password: PASSWORD });
    const second = await id.accounts.login(
      { username: 'alice', password: PASSWORD },
      first.sessionId,
    );
    expect(await id.sessions.resolve(first.sessionId)).toBeUndefined();
    expect(await id.sessions.resolve(second.sessionId)).toBeDefined();
  });

  it('leaves no session when updating the auth method fails', async () => {
    const { kernel, identity: id } = await identity.start();
    await withPassword(kernel, { username: 'alice' });
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'disk on fire'; end $$;
      create trigger identity_test_fail before update on identity_auth_method
        for each row execute function identity_test_fail();`);
    await expect(id.accounts.login({ username: 'alice', password: PASSWORD })).rejects.toThrow();
    expect(await all(kernel, 'identity_session')).toEqual([]);
  });
});

describe('logout and logoutAll (defect 4)', () => {
  it('ends the caller’s session', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    const user = await withPassword(kernel, { username: 'alice' });
    const { sessionId } = await id.accounts.login({ username: 'alice', password: PASSWORD });
    await id.accounts.logout(actorOf(user), sessionId);
    expect(await id.sessions.resolve(sessionId)).toBeUndefined();
  });

  it('ends all sessions of the caller and counts them', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    const user = await withPassword(kernel, { username: 'alice' });
    const one = await id.accounts.login({ username: 'alice', password: PASSWORD });
    const two = await id.accounts.login({ username: 'alice', password: PASSWORD });
    const current = (await id.sessions.resolve(one.sessionId))!.sessionId;
    expect(await id.accounts.logoutAll({ ...actorOf(user), sessionId: current })).toBe(2);
    expect(await id.sessions.resolve(one.sessionId)).toBeUndefined();
    expect(await id.sessions.resolve(two.sessionId)).toBeUndefined();
  });

  it('refuses an anonymous caller (denied)', async () => {
    const { identity: id } = await identity.start();
    await expect(id.accounts.logout(ANONYMOUS, undefined)).rejects.toBeInstanceOf(Unauthorized);
    await expect(id.accounts.logoutAll(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
  });

  it('does not end the sessions of someone else', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const alice = await withPassword(kernel, { username: 'alice' });
    const bob = await withPassword(kernel, { username: 'bobby' });
    const bobs = await id.accounts.login({ username: 'bobby', password: PASSWORD });
    const mine = await id.sessions.create(alice.id);
    await id.accounts.logoutAll({ ...actorOf(alice), sessionId: mine.sessionId });
    expect(await id.sessions.resolve(bobs.sessionId)).toMatchObject({ userId: bob.id });
  });
});

describe('me', () => {
  it('returns the caller and the CSRF token of their session', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await withPassword(kernel, { username: 'alice' });
    const { sessionId } = await id.accounts.login({ username: 'alice', password: PASSWORD });
    const me = await id.accounts.me(actorOf(user), sessionId);
    expect(me.user).toMatchObject({ id: user.id, username: 'alice' });
    expect(me.csrfToken).toBe(csrfTokenFor(sessionId));
    expect(JSON.stringify(me)).not.toContain(sessionId);
  });

  it('gives no CSRF token to a caller without a session', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await withPassword(kernel, { username: 'alice' });
    expect((await id.accounts.me(actorOf(user), undefined)).csrfToken).toBeNull();
    const viaToken: Actor = {
      ...actorOf(user),
      via: 'token',
      scopes: ['core.identity.me.read'],
    };
    expect((await id.accounts.me(viaToken, 'x'.repeat(43))).csrfToken).toBeNull();
  });

  it('refuses an anonymous caller (denied), and a user that no longer exists', async () => {
    const { identity: id } = await identity.start();
    await expect(id.accounts.me(ANONYMOUS, undefined)).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      id.accounts.me(
        actorOf({ id: '019a0000-0000-7000-8000-000000000000', username: 'ghost' }),
        undefined,
      ),
    ).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe('roles and the second check, with core.authz', () => {
  it('returns the roles of the caller from core.authz, every time', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await withPassword(kernel, { username: 'alice' });
    const actor = actorOf(user); // makeMember gave the account the role `user`
    expect((await id.accounts.me(actor, undefined)).roles).toEqual(['user']);
    // Not cached by identity: a change in the roles shows at once.
    await makeRoleAssignment(kernel.pool, user, 'reviewer');
    expect((await id.accounts.me(actor, undefined)).roles).toEqual(['reviewer', 'user']);
  });

  it('denies a user without roles on me, logout and logoutAll', async () => {
    const { kernel, identity: id } = await identity.start();
    const roleless = await makeUser(kernel.pool);
    const actor = actorOf(roleless);
    await expect(id.accounts.me(actor, undefined)).rejects.toBeInstanceOf(Forbidden);
    await expect(id.accounts.logout(actor, undefined)).rejects.toBeInstanceOf(Forbidden);
    await expect(id.accounts.logoutAll(actor)).rejects.toBeInstanceOf(Forbidden);
  });

  it('gives an account the default role when a policy activates it at registration, and none when it waits', async () => {
    const auto = {
      id: 'test.auto',
      version: '1.0.0',
      contributes: {
        'auth.approvalPolicy': [{ id: 'auto', decide: () => ({ status: 'active' }) }],
      },
    };
    const manual = await identity.start();
    const waiting = (await manual.identity.accounts.register({
      username: 'waiter',
      email: 'waiter@example.org',
      password: PASSWORD,
    }))!;
    expect(waiting.status).toBe('pending');
    expect(await all(manual.kernel, 'authz_role_assignment')).toEqual([]);

    const started = await identity.start({
      settings: { get: () => Promise.resolve(settingsSchema.parse({ approvalPolicy: 'auto' })) },
      extraModule: { id: 'test.auto', manifest: auto },
    });
    const created = (await started.identity.accounts.register({
      username: 'quick',
      email: 'quick@example.org',
      password: PASSWORD,
    }))!;
    expect(created.status).toBe('active');
    expect(await all(started.kernel, 'authz_role_assignment')).toEqual([
      expect.objectContaining({ user_id: created.id, assigned_by: null }),
    ]);
  });
});
