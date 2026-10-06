import { randomUUID } from 'node:crypto';
import {
  makeAuthMethod,
  makeRoleAssignment,
  makeSession,
  makeToken,
  makeUser,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import manifest, { USER_PERMISSIONS } from './module.ts';
import { useIdentity } from './test/harness.ts';

const identity = useIdentity();

/** Runs a statement that must be refused and returns the constraint it broke. */
async function refused(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e as { constraint?: string; cause?: { constraint?: string }; message: string },
  );
  expect(error, 'the statement should have been refused').toBeDefined();
  return error!.constraint ?? error!.cause?.constraint ?? error!.message;
}

describe('the module', () => {
  it('declares itself: id, prefix, permissions, settings, events, the policy registry and its routes', () => {
    expect(manifest).toMatchObject({ id: 'core.identity', tablePrefix: 'identity_' });
    expect(Object.keys(manifest.permissions ?? {}).sort()).toEqual([
      'core.identity.auth-method.link',
      'core.identity.avatar.update',
      'core.identity.email.verify',
      'core.identity.me.read',
      'core.identity.password.change',
      'core.identity.profile.read',
      'core.identity.profile.update',
      'core.identity.role.assign',
      'core.identity.role.read',
      'core.identity.session.manage',
      'core.identity.session.manage-any',
      'core.identity.token.manage',
      'core.identity.token.manage-any',
      'core.identity.token.read',
      'core.identity.user.approve',
      'core.identity.user.list-pending',
      'core.identity.user.reject',
    ]);
    expect(Object.keys(manifest.events?.emits ?? {}).sort()).toEqual([
      'identity.admin.created@1',
      'identity.authMethod.linked@1',
      'identity.email.verified@1',
      'identity.password.changed@1',
      'identity.password.reset@1',
      'identity.password.resetRequested@1',
      'identity.profile.updated@1',
      'identity.session.reauthenticated@1',
      'identity.sessions.revoked@1',
      'identity.sessions.revokedAll@1',
      'identity.token.created@1',
      'identity.token.revoked@1',
      'identity.token.rotated@1',
      'identity.user.approved@1',
      'identity.user.purged@1',
      'identity.user.registered@1',
      'identity.user.rejected@1',
    ]);
    expect(Object.keys(manifest.registries ?? {})).toEqual(['auth.approvalPolicy']);
    expect(Object.keys(manifest.contributes ?? {}).sort()).toEqual([
      'auth.approvalPolicy',
      'authz.defaultRole',
      'kernel.authenticator',
      'notify.recipientAddress',
      'notify.template',
    ]);
    expect(manifest.routes).toBeDefined();
    expect(manifest.commands?.map((command) => command.name)).toEqual(['create-admin']);
    expect(Object.keys(manifest.events?.on ?? {})).toEqual(['system.ready']);
    expect(manifest.jobs?.map((job) => job.name)).toEqual(['core.identity.cleanup']);
  });

  it('contributes the manual policy and exactly one authenticator', async () => {
    const { kernel } = await identity.start();
    expect(kernel.composition.registries.get('auth.approvalPolicy')?.entries).toEqual([
      { module: 'core.identity', value: expect.objectContaining({ id: 'manual' }) as unknown },
    ]);
    expect(kernel.composition.registries.get('kernel.authenticator')?.entries).toHaveLength(1);
  });

  it('declares localAccounts (default true) and the approval policy in its settings schema', () => {
    const settings = manifest.settings as { parse(input: unknown): unknown };
    expect(settings.parse({})).toEqual({
      localAccounts: true,
      approvalPolicy: 'manual',
      oidcProviders: [],
      // Today's constants are the defaults (README, "Settings").
      retention: { purgeAfterDays: 30, tokenGraceDays: 30, purgeBatch: 500 },
      sessions: { inactivityDays: 7, absoluteDays: 30, recentAuthSeconds: 300 },
      mailBudgets: { perAddress: { burst: 3, perHour: 3 }, perUser: { burst: 5, perHour: 5 } },
    });
    expect(() => settings.parse({ localAccounts: 'yes' })).toThrow();
  });

  it('creates exactly its seven tables, all with the module prefix', async () => {
    const { kernel } = await identity.start();
    const { rows } = await kernel.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'identity\\_%' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'identity_auth_method',
      'identity_first_run_token',
      'identity_login_state',
      'identity_mail_token',
      'identity_session',
      'identity_token',
      'identity_user',
    ]);
    const others = await kernel.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name not like 'identity\\_%' and table_name not like 'kernel\\_%'
          and table_name not like 'authz\\_%' and table_name not like 'settings\\_%' and table_name not like 'blob\\_%' and table_name not like 'notify\\_%'`, // the tables of the modules this one depends on
    );
    expect(others.rows).toEqual([]);
  });

  it('migrates under the advisory lock: two processes starting together apply it once', async () => {
    const url = await identity.server().createDatabase();
    await Promise.all([identity.start({ databaseUrl: url }), identity.start({ databaseUrl: url })]);
    const { kernel } = await identity.start({ databaseUrl: url });
    const journal = await kernel.pool.query(`select * from kernel_migrations_core_identity`);
    expect(journal.rows).toHaveLength(8); // 0000 to 0007, each once
  });

  it('keeps no secret in the clear: every secret or password column is a hash', async () => {
    const { kernel } = await identity.start();
    const { rows } = await kernel.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_name like 'identity\\_%' and column_name ~ 'secret|password|token|session_id|state'`,
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`).sort()).toEqual([
      'identity_auth_method.password_hash',
      'identity_first_run_token.secret_hash',
      'identity_login_state.reauth_session_id', // the id of a session row, which holds no secret
      'identity_login_state.state_hash',
      'identity_mail_token.secret_hash',
      'identity_session.secret_hash',
      'identity_token.secret_hash',
    ]);
  });

  it('stores a session and a token only as hashes of what the client holds', async () => {
    const { kernel } = await identity.start();
    const user = await makeUser(kernel.pool);
    const { row: session, secret } = await makeSession(kernel.pool, user);
    const { token } = await makeToken(kernel.pool, user, { secretHash: '$argon2id$x' });
    const stored =
      JSON.stringify((await kernel.pool.query('select * from identity_session')).rows) +
      JSON.stringify((await kernel.pool.query('select * from identity_token')).rows);
    expect(stored).not.toContain(secret);
    expect(stored).not.toContain(token);
    expect(session.id).not.toBe(secret);
  });
});

describe('the permissions identity gives to roles (authz.defaultRole)', () => {
  it('gives the role user every self-service permission, Reviewer nothing, and Admin everything', async () => {
    const { kernel, authz } = await identity.start();
    const admin = {
      kind: 'user',
      userId: randomUUID(),
      username: 'a',
      roles: [],
      via: 'session',
    } as const;
    await makeRoleAssignment(kernel.pool, { id: admin.userId }, 'admin');
    const roles = Object.fromEntries((await authz.listRoles(admin)).map((r) => [r.key, r]));
    expect(roles.user!.permissions.filter((p) => p.startsWith('core.identity.'))).toEqual(
      [...USER_PERMISSIONS].sort(),
    );
    expect(roles.reviewer!.permissions).toEqual([]);
    expect(roles.admin!.permissions).toEqual(
      expect.arrayContaining(['core.identity.role.assign', 'core.identity.token.manage-any']),
    );
  });

  it('keeps administration out of the role user: nothing that approves, assigns roles or manages any token', () => {
    const declared = Object.keys(manifest.permissions ?? {});
    const adminOnly = declared.filter((permission) => !USER_PERMISSIONS.includes(permission));
    expect(adminOnly.sort()).toEqual([
      'core.identity.role.assign',
      'core.identity.role.read',
      'core.identity.session.manage-any',
      'core.identity.token.manage-any',
      'core.identity.user.approve',
      'core.identity.user.list-pending',
      'core.identity.user.reject',
    ]);
    for (const permission of USER_PERMISSIONS) expect(declared).toContain(permission);
  });
});

describe('the constraints of the tables', () => {
  it('keeps a username unique', async () => {
    const { kernel } = await identity.start();
    await makeUser(kernel.pool, { username: 'alice' });
    expect(await refused(makeUser(kernel.pool, { username: 'alice' }))).toBe(
      'identity_user_username_uidx',
    );
  });

  it.each(['Alice', 'al', 'a'.repeat(32), 'al ice', 'al.ice'])(
    'refuses the username %j',
    async (username) => {
      const { kernel } = await identity.start();
      expect(await refused(makeUser(kernel.pool, { username }))).toBe(
        'identity_user_username_format',
      );
    },
  );

  it('refuses a status that does not exist', async () => {
    const { kernel } = await identity.start();
    expect(await refused(makeUser(kernel.pool, { status: 'admin' as never }))).toBe(
      'identity_user_status_known',
    );
  });

  it('lets only one user hold a verified address, in any letter case; unverified ones may repeat', async () => {
    const { kernel } = await identity.start();
    await makeUser(kernel.pool, { email: 'x@example.org', emailVerified: true });
    expect(
      await refused(makeUser(kernel.pool, { email: 'X@Example.org', emailVerified: true })),
    ).toBe('identity_user_email_verified_uidx');
    await expect(makeUser(kernel.pool, { email: 'x@example.org' })).resolves.toBeTruthy();
    await expect(makeUser(kernel.pool, { email: 'x@example.org' })).resolves.toBeTruthy();
  });

  it('refuses a verified time without an address', async () => {
    const { kernel } = await identity.start();
    const user = await makeUser(kernel.pool, { email: null });
    expect(
      await refused(
        kernel.pool.query(`update identity_user set email_verified_at = now() where id = $1`, [
          user.id,
        ]),
      ),
    ).toBe('identity_user_verified_has_email');
  });

  it('keeps (provider, subject) unique, and one password account per user', async () => {
    const { kernel } = await identity.start();
    const [one, two] = [await makeUser(kernel.pool), await makeUser(kernel.pool)];
    await makeAuthMethod(kernel.pool, one, { provider: 'idp', subject: 's1' });
    expect(
      await refused(makeAuthMethod(kernel.pool, two, { provider: 'idp', subject: 's1' })),
    ).toBe('identity_auth_method_provider_subject_uidx');
    await makeAuthMethod(kernel.pool, one); // local
    expect(await refused(makeAuthMethod(kernel.pool, one, { subject: 'another' }))).toBe(
      'identity_auth_method_local_user_uidx',
    );
    // A user may have several identity-provider accounts.
    await expect(
      makeAuthMethod(kernel.pool, one, { provider: 'idp', subject: 's2' }),
    ).resolves.toBeTruthy();
  });

  it('allows a password hash on a local method only, and requires it there', async () => {
    const { kernel } = await identity.start();
    const user = await makeUser(kernel.pool);
    const insert = (provider: string, hash: string | null) =>
      kernel.pool.query(
        `insert into identity_auth_method (id, user_id, provider, subject, password_hash)
         values (gen_random_uuid(), $1, $2, gen_random_uuid()::text, $3)`,
        [user.id, provider, hash],
      );
    expect(await refused(insert('local', null))).toBe('identity_auth_method_password_only_local');
    expect(await refused(insert('idp', '$argon2id$x'))).toBe(
      'identity_auth_method_password_only_local',
    );
  });

  it('keeps a token prefix unique and a live token name unique per user', async () => {
    const { kernel } = await identity.start();
    const [one, two] = [await makeUser(kernel.pool), await makeUser(kernel.pool)];
    const { row } = await makeToken(kernel.pool, one, { name: 'ci' });
    expect(await refused(makeToken(kernel.pool, one, { name: 'ci' }))).toBe(
      'identity_token_user_name_uidx',
    );
    await expect(makeToken(kernel.pool, two, { name: 'ci' })).resolves.toBeTruthy();
    // A revoked token frees its name (rotation relies on it).
    await kernel.pool.query('update identity_token set revoked_at = now() where id = $1', [row.id]);
    await expect(makeToken(kernel.pool, one, { name: 'ci' })).resolves.toBeTruthy();
    expect(
      await refused(
        kernel.pool.query(`update identity_token set prefix = $1 where id <> $2`, [
          row.prefix,
          row.id,
        ]),
      ),
    ).toBe('identity_token_prefix_uidx');
  });

  it('refuses a token prefix that is not 8 letters or digits', async () => {
    const { kernel } = await identity.start();
    const user = await makeUser(kernel.pool);
    const { row } = await makeToken(kernel.pool, user);
    for (const prefix of ['short', 'toolongprefix', 'bad_char!']) {
      expect(
        await refused(
          kernel.pool.query(`update identity_token set prefix = $1 where id = $2`, [
            prefix,
            row.id,
          ]),
        ),
      ).toBe('identity_token_prefix_format');
    }
  });

  it('keeps session secrets unique and deletes a user’s sessions, tokens and methods with the user', async () => {
    const { kernel } = await identity.start();
    const user = await makeUser(kernel.pool);
    const { row } = await makeSession(kernel.pool, user);
    await makeSession(kernel.pool, user);
    await makeToken(kernel.pool, user);
    await makeAuthMethod(kernel.pool, user);
    expect(
      await refused(
        kernel.pool.query(
          `insert into identity_session (id, user_id, secret_hash, expires_at, absolute_expires_at)
           select gen_random_uuid(), user_id, secret_hash, expires_at, absolute_expires_at from identity_session where id = $1`,
          [row.id],
        ),
      ),
    ).toBe('identity_session_secret_hash_uidx');

    await kernel.pool.query(`delete from identity_user where id = $1`, [user.id]);
    for (const table of ['identity_session', 'identity_token', 'identity_auth_method']) {
      expect((await kernel.pool.query(`select 1 from ${table}`)).rows).toEqual([]);
    }
  });

  it('has a login-state table with a unique hash and an expiry, and only hashes about the login', async () => {
    const { kernel } = await identity.start();
    const { rows } = await kernel.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'identity_login_state' order by 1`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'binding_hash',
      'created_at',
      'expires_at',
      'id',
      'link_user_id',
      'nonce_hash',
      'provider_id',
      'purpose',
      'reauth_session_id',
      'state_hash',
    ]);
    const insert = () =>
      kernel.pool.query(
        `insert into identity_login_state (id, provider_id, state_hash, nonce_hash, binding_hash, expires_at)
         values (gen_random_uuid(), 'idp', 'same', 'n', 'b', now() + interval '10 minutes')`,
      );
    await insert();
    expect(await refused(insert())).toBe('identity_login_state_hash_uidx');
  });

  it('starts every account without an avatar', async () => {
    const { kernel } = await identity.start();
    const user = await makeUser(kernel.pool);
    expect(
      (await kernel.pool.query(`select avatar_blob_id from identity_user where id = $1`, [user.id]))
        .rows,
    ).toEqual([{ avatar_blob_id: null }]);
  });
});
