import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeAuthMethod, makeSession, makeToken, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
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
      'core.identity.me.read',
      'core.identity.session.manage',
      'core.identity.token.manage',
      'core.identity.token.read',
      'core.identity.user.approve',
      'core.identity.user.list-pending',
      'core.identity.user.reject',
    ]);
    expect(Object.keys(manifest.events?.emits ?? {}).sort()).toEqual([
      'identity.admin.created@1',
      'identity.authMethod.linked@1',
      'identity.token.created@1',
      'identity.token.revoked@1',
      'identity.token.rotated@1',
      'identity.user.approved@1',
      'identity.user.registered@1',
      'identity.user.rejected@1',
    ]);
    expect(Object.keys(manifest.registries ?? {})).toEqual(['auth.approvalPolicy']);
    expect(Object.keys(manifest.contributes ?? {}).sort()).toEqual([
      'auth.approvalPolicy',
      'kernel.authenticator',
    ]);
    expect(manifest.routes).toBeDefined();
    expect(manifest.commands?.map((command) => command.name)).toEqual(['create-admin']);
    expect(Object.keys(manifest.events?.on ?? {})).toEqual(['system.ready']);
    expect(manifest.jobs).toBeUndefined();
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
    });
    expect(() => settings.parse({ localAccounts: 'yes' })).toThrow();
  });

  it('creates exactly its six tables, all with the module prefix', async () => {
    const { kernel } = await identity.start();
    const { rows } = await kernel.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'identity\\_%' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'identity_auth_method',
      'identity_first_run_token',
      'identity_login_state',
      'identity_session',
      'identity_token',
      'identity_user',
    ]);
    const others = await kernel.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name not like 'identity\\_%' and table_name not like 'kernel\\_%'`,
    );
    expect(others.rows).toEqual([]);
  });

  it('migrates under the advisory lock: two processes starting together apply it once', async () => {
    const url = await identity.server().createDatabase();
    await Promise.all([identity.start({ databaseUrl: url }), identity.start({ databaseUrl: url })]);
    const { kernel } = await identity.start({ databaseUrl: url });
    const journal = await kernel.pool.query(`select * from kernel_migrations_core_identity`);
    expect(journal.rows).toHaveLength(4); // 0000 to 0003, each once
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
      'identity_login_state.state_hash',
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

describe('the temporary isBootstrapAdmin column (ADR 0006)', () => {
  it('exists, is false by default and is the only trace of it', async () => {
    const { kernel } = await identity.start();
    const { rows } = await kernel.pool.query<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns
        where table_name = 'identity_user' and column_name = 'is_bootstrap_admin'`,
    );
    expect(rows).toEqual([{ is_nullable: 'NO', column_default: 'false' }]);
    expect((await makeUser(kernel.pool)).is_bootstrap_admin).toBe(false);
  });

  it('is read by no code of the module (M3 drops the column, so nothing may depend on it)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'migrations', 'dist'].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
      }
    };
    walk(import.meta.dirname);
    const mentioning = files
      .filter((file) => /isBootstrapAdmin|is_bootstrap_admin/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(import.meta.dirname.length + 1));
    // Only the schema knows the column. `create-admin` and the first-run token set it through the
    // exported `BOOTSTRAP_ADMIN_MARK` (a value, not a mention), and nothing reads it or decides by it.
    expect(mentioning).toEqual(['db/schema.ts']);
  });
});

describe('the marker is written, never read (ADR 0006)', () => {
  it('is used only by the bootstrap service, and only as the argument of a `.set()`', () => {
    const source = (file: string) => readFileSync(join(import.meta.dirname, file), 'utf8');
    const mentioning: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'migrations', 'dist'].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          if (readFileSync(path, 'utf8').includes('BOOTSTRAP_ADMIN_MARK'))
            mentioning.push(path.slice(import.meta.dirname.length + 1));
        }
      }
    };
    walk(import.meta.dirname);
    expect(mentioning.sort()).toEqual(['db/schema.ts', 'service/bootstrap.ts']);
    const uses = source('service/bootstrap.ts').match(/.*BOOTSTRAP_ADMIN_MARK.*/g) ?? [];
    expect(
      uses.filter((line) => !line.includes('import') && !line.trim().startsWith('//')),
    ).toEqual([
      '      await tx.update(user).set(BOOTSTRAP_ADMIN_MARK).where(eq(user.id, created.id));',
    ]);
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
          `insert into identity_session (id, user_id, secret_hash, expires_at)
           select gen_random_uuid(), user_id, secret_hash, expires_at from identity_session where id = $1`,
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

  it('has a nullable avatar column that nothing sets', async () => {
    const { kernel } = await identity.start();
    const user = await makeUser(kernel.pool);
    expect(
      (await kernel.pool.query(`select avatar_blob_id from identity_user where id = $1`, [user.id]))
        .rows,
    ).toEqual([{ avatar_blob_id: null }]);
  });
});
