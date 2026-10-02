// The bootstrap migration (ADR 0014, "The bootstrap exception"): migration 0006 turns the temporary
// `is_bootstrap_admin` marker into an Admin role assignment and drops the column. It is the only
// place in the repository that touches a table of another module, and these tests prove it does
// that and nothing else: the data, the order of the two modules' migrations, atomicity, and the
// guards that nothing else mentions the column or a foreign table.
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createLogger, createPool, runMigrations, type MigrationTarget } from '@scorpion/kernel';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { useIdentity } from './test/harness.ts';

type Pool = ReturnType<typeof createPool>;
const identity = useIdentity();
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const here = import.meta.dirname;
const repo = join(here, '..', '..');

const authzFolder = join(repo, 'modules', 'core-authz', 'migrations');
const scratch: string[] = [];
const pools: Pool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** The identity migrations as 0.3.0 left them: the real folder without 0006. */
function migrationsBeforeBootstrap(): string {
  const dir = mkdtempSync(join(tmpdir(), 'identity-migrations-'));
  scratch.push(dir);
  cpSync(join(here, 'migrations'), dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.pop()!;
  expect(last.tag).toBe('0006_bootstrap_admin_to_authz'); // this test is about the last migration
  writeFileSync(journalPath, JSON.stringify(journal));
  rmSync(join(dir, `${last.tag}.sql`));
  return dir;
}

const targets = (identityFolder: string): MigrationTarget[] => [
  { id: 'core.authz', migrations: authzFolder, tablePrefix: 'authz_' },
  { id: 'core.identity', migrations: identityFolder, tablePrefix: 'identity_' },
];
const migrate = (pool: Pool, folder: string) =>
  runMigrations(pool, targets(folder), createLogger({ level: 'silent' }));

/** A database as 0.3.0 left it: both modules migrated up to before 0006, and these users. */
async function before(users: { name: string; marked: boolean }[]) {
  const url = await identity.server().createDatabase();
  const pool = createPool({ DATABASE_URL: url });
  pools.push(pool);
  const folder = migrationsBeforeBootstrap();
  await migrate(pool, folder);
  const ids: Record<string, string> = {};
  for (const [index, user] of users.entries()) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into identity_user (id, username, email, status, is_bootstrap_admin)
       values (gen_random_uuid(), $1, $2, 'active', $3) returning id`,
      [user.name, `${user.name}-${index}@example.org`, user.marked],
    );
    ids[user.name] = rows[0]!.id;
  }
  return { url, pool, ids, folder };
}
const query = async (pool: Pool, sql: string) =>
  (await pool.query(sql)).rows as Record<string, unknown>[];
const holders = (pool: Pool) =>
  query(
    pool,
    `select u.username, a.assigned_by, r.key from authz_role_assignment a
       join authz_role r on r.id = a.role_id
       left join identity_user u on u.id = a.user_id order by u.username`,
  );
const columnExists = async (pool: Pool) =>
  (
    await query(
      pool,
      `select 1 from information_schema.columns
        where table_name = 'identity_user' and column_name = 'is_bootstrap_admin'`,
    )
  ).length > 0;

describe('migration 0006: is_bootstrap_admin becomes the Admin role', () => {
  it('with no marked user changes nothing: no role row, no assignment, the column is gone', async () => {
    const { pool, ids, folder } = await before([
      { name: 'ann', marked: false },
      { name: 'bob', marked: false },
    ]);
    expect(await columnExists(pool)).toBe(true);
    await migrate(pool, join(here, 'migrations'));
    expect(await columnExists(pool)).toBe(false);
    expect(await query(pool, 'select * from authz_role')).toEqual([]);
    expect(await query(pool, 'select * from authz_role_assignment')).toEqual([]);
    expect(await query(pool, 'select id from identity_user order by username')).toHaveLength(2);
    expect(Object.keys(ids)).toHaveLength(2);
    expect(folder).toBeTruthy();
  });

  it('with one marked user gives that user, and nobody else, the Admin role', async () => {
    const { pool, ids } = await before([
      { name: 'ann', marked: false },
      { name: 'root', marked: true },
    ]);
    await migrate(pool, join(here, 'migrations'));
    expect(await columnExists(pool)).toBe(false);
    expect(await holders(pool)).toEqual([{ username: 'root', assigned_by: null, key: 'admin' }]);
    const roles = await query(pool, 'select id, key, label, system from authz_role');
    expect(roles).toEqual([
      { id: expect.stringMatching(UUID_V7) as unknown, key: 'admin', label: 'Admin', system: true },
    ]);
    const [assignment] = await query(
      pool,
      'select id, user_id, assigned_at from authz_role_assignment',
    );
    expect(assignment).toMatchObject({ user_id: ids.root });
    expect(assignment!.id).toMatch(UUID_V7);
  });

  it('with several marked users gives each of them the Admin role, with ids of their own', async () => {
    const { pool } = await before([
      { name: 'ann', marked: false },
      { name: 'root1', marked: true },
      { name: 'root2', marked: true },
      { name: 'root3', marked: true },
    ]);
    await migrate(pool, join(here, 'migrations'));
    expect((await holders(pool)).map((h) => h.username)).toEqual(['root1', 'root2', 'root3']);
    const ids = await query(pool, 'select id from authz_role_assignment');
    expect(new Set(ids.map((row) => row.id)).size).toBe(3);
    expect(await query(pool, 'select id from authz_role')).toHaveLength(1);
  });

  it('uses the Admin role row that core.authz already seeded instead of making a second one', async () => {
    const { pool } = await before([{ name: 'root', marked: true }]);
    // A 0.3.x instance with core.authz in the profile has seeded its roles at start.
    await pool.query(
      `insert into authz_role (id, key, label, system)
       values ('01900000-0000-7000-8000-000000000001', 'admin', 'Admin', true)`,
    );
    await migrate(pool, join(here, 'migrations'));
    expect(await query(pool, 'select id from authz_role')).toEqual([
      { id: '01900000-0000-7000-8000-000000000001' },
    ]);
    expect(await query(pool, 'select role_id from authz_role_assignment')).toEqual([
      { role_id: '01900000-0000-7000-8000-000000000001' },
    ]);
  });

  it('is one transaction: if the copy fails, the column is still there and no role was created', async () => {
    const { pool } = await before([{ name: 'root', marked: true }]);
    await pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'assignment on fire'; end $$;
      create trigger identity_test_fail before insert on authz_role_assignment
        for each row execute function identity_test_fail();`);
    await expect(migrate(pool, join(here, 'migrations'))).rejects.toThrow();
    expect(await columnExists(pool)).toBe(true);
    expect(await query(pool, 'select * from authz_role')).toEqual([]);
    expect(await query(pool, 'select * from authz_role_assignment')).toEqual([]);
    // 0006 is not in the journal, so the next start tries again.
    expect(await query(pool, 'select * from kernel_migrations_core_identity')).toHaveLength(6);
  });

  it('leaves a working instance: a former bootstrap admin is Admin, the seed adds the other roles, no first-run token', async () => {
    const { url, ids } = await before([
      { name: 'ann', marked: false },
      { name: 'root', marked: true },
    ]);
    const { kernel, authz } = await identity.start({ databaseUrl: url });
    const roles = await query(kernel.pool, 'select key from authz_role order by key');
    expect(roles).toEqual([{ key: 'admin' }, { key: 'reviewer' }, { key: 'user' }]); // seed found Admin
    expect(await holders(kernel.pool)).toEqual([
      { username: 'root', assigned_by: null, key: 'admin' },
    ]);
    expect(await authz.hasHolders('admin')).toBe(true);
    await expect(
      authz.require(
        { kind: 'user', userId: ids.root!, username: 'root', roles: [], via: 'session' },
        'core.authz.role.manage',
      ),
    ).resolves.toBeUndefined();
    expect(await query(kernel.pool, 'select * from identity_first_run_token')).toEqual([]);
  });

  it('keeps create-admin and the first-run token working when nobody was marked', async () => {
    const { url } = await before([{ name: 'ann', marked: false }]);
    const shown: string[] = [];
    const {
      kernel,
      identity: id,
      authz,
    } = await identity.start({
      databaseUrl: url,
      announce: (text) => shown.push(text),
    });
    expect(shown.join('')).toMatch(/sfr_/); // no administrator yet: the token is shown
    const created = await id.bootstrap.createAdmin({
      username: 'root',
      email: 'root@example.org',
      password: 'correct horse battery',
    });
    expect(await holders(kernel.pool)).toEqual([
      { username: 'root', assigned_by: null, key: 'admin' },
    ]);
    expect(created.username).toBe('root');
    expect(await authz.hasHolders('admin')).toBe(true);
  });
});

describe('after the migration nothing knows the column, and no module touches another one’s tables', () => {
  /** Source files of the repository that ship: not tests, not migrations, not build output. */
  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        ['node_modules', 'dist', 'build', '.svelte-kit', 'migrations', '.git'].includes(entry.name)
      ) {
        continue;
      }
      if (entry.name === 'coverage' || entry.name === '.code-review-graph') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) sources(path, out);
      else if (/\.(ts|js|svelte|json)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        out.push(path);
      }
    }
    return out;
  }

  it('is mentioned by no source file outside the migrations (the M2 guard test is replaced by this)', () => {
    const mentioning = ['apps', 'modules', 'packages', 'profiles', 'tools']
      .flatMap((dir) => sources(join(repo, dir)))
      .filter((file) =>
        /isBootstrapAdmin|is_bootstrap_admin|BOOTSTRAP_ADMIN_MARK/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(repo, file));
    expect(mentioning).toEqual([]);
  });

  it('is gone from the schema of a fresh instance', async () => {
    const { kernel } = await identity.start();
    expect(await columnExists(kernel.pool)).toBe(false);
  });

  it('is the only migration or source file of a module that names a table of another module', () => {
    // Tables by module, from the schema files (`pgTable('name', ...)`).
    const modulesDir = join(repo, 'modules');
    const owner = new Map<string, string>();
    const moduleNames = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const name of moduleNames) {
      const schemaFile = join(modulesDir, name, 'db', 'schema.ts');
      if (!existsSync(schemaFile)) continue;
      const schema = readFileSync(schemaFile, 'utf8');
      for (const match of schema.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g))
        owner.set(match[1]!, name);
    }
    expect(owner.size).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const name of moduleNames) {
      const files = [
        ...sources(join(modulesDir, name)),
        ...migrationFiles(join(modulesDir, name, 'migrations')),
      ];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const [table, tableOwner] of owner) {
          if (tableOwner !== name && new RegExp(`\\b${table}\\b`).test(text)) {
            offenders.push(`${relative(repo, file)} names ${table} (${tableOwner})`);
          }
        }
      }
    }
    // The one exception to rule 3 of CLAUDE.md (ADR 0014).
    expect(offenders.sort()).toEqual([
      'modules/core-identity/migrations/0006_bootstrap_admin_to_authz.sql names authz_role (core-authz)',
      'modules/core-identity/migrations/0006_bootstrap_admin_to_authz.sql names authz_role_assignment (core-authz)',
    ]);
  });
});

function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => join(dir, file));
}
