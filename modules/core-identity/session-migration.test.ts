// Migration 0007 (ADR 0025): `absolute_expires_at` and `authenticated_at` on `identity_session`, and the
// purpose of a login state. It runs over rows that already exist, so these tests build a database as
// 0.5.1 left it (the real folder without 0007), put rows in it, and run the migration.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closePool,
  createLogger,
  createPool,
  runMigrations,
  type MigrationTarget,
} from '@scorpion/kernel';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { useIdentity } from './test/harness.ts';

type Pool = ReturnType<typeof createPool>;
const identity = useIdentity();
const here = import.meta.dirname;
const authzFolder = join(here, '..', 'core-authz', 'migrations');
const DAY = 24 * 3600 * 1000;

const scratch: string[] = [];
const pools: Pool[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => closePool(pool)));
});
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const TAG = '0007_flaky_nitro';

/** The identity migrations as 0.5.1 left them: the real folder without 0007 and what came after it. */
function migrationsBefore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'identity-migrations-'));
  scratch.push(dir);
  cpSync(join(here, 'migrations'), dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const first = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(first).toBeGreaterThanOrEqual(0); // this test is about migration 0007
  const dropped = journal.entries.splice(first);
  writeFileSync(journalPath, JSON.stringify(journal));
  for (const entry of dropped) rmSync(join(dir, `${entry.tag}.sql`));
  return dir;
}

const migrate = (pool: Pool, folder: string) =>
  runMigrations(
    pool,
    [
      { id: 'core.authz', migrations: authzFolder, tablePrefix: 'authz_' },
      { id: 'core.identity', migrations: folder, tablePrefix: 'identity_' },
    ] satisfies MigrationTarget[],
    createLogger({ level: 'silent' }),
  );

async function oldDatabase() {
  const pool = createPool({ DATABASE_URL: await identity.server().createDatabase() });
  pools.push(pool);
  await migrate(pool, migrationsBefore());
  return pool;
}
const rows = async (pool: Pool, sql: string) =>
  (await pool.query(sql)).rows as Record<string, unknown>[];

describe('migration 0007: the absolute end and the authentication time of existing sessions', () => {
  it('gives each existing session an absolute end of its creation plus 30 days, and authenticated_at = created_at', async () => {
    const pool = await oldDatabase();
    const created = new Date(Date.now() - 10 * DAY);
    await pool.query(
      `insert into identity_user (id, username, status) values ('00000000-0000-7000-8000-000000000001', 'ann', 'active')`,
    );
    await pool.query(
      `insert into identity_session (id, user_id, secret_hash, created_at, last_seen_at, expires_at)
       values ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-000000000001', 'h1', $1, $1, $2),
              ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-000000000001', 'h2', $3, $3, $4)`,
      [created, new Date(created.getTime() + 7 * DAY), new Date(Date.now() - 40 * DAY), new Date()],
    );

    await migrate(pool, join(here, 'migrations'));

    const sessions = await rows(
      pool,
      'select secret_hash, created_at, absolute_expires_at, authenticated_at from identity_session order by secret_hash',
    );
    expect(sessions).toHaveLength(2);
    for (const row of sessions) {
      const createdAt = (row.created_at as Date).getTime();
      expect((row.absolute_expires_at as Date).getTime()).toBe(createdAt + 30 * DAY);
      expect((row.authenticated_at as Date).getTime()).toBe(createdAt);
    }
    // The second one began 40 days ago: it is over, and nothing resolves it any more.
    expect((sessions[1]!.absolute_expires_at as Date).getTime()).toBeLessThan(Date.now());
    // The column cannot be left empty afterwards.
    await expect(
      pool.query(
        `insert into identity_session (id, user_id, secret_hash, expires_at)
         values (gen_random_uuid(), '00000000-0000-7000-8000-000000000001', 'h3', now())`,
      ),
    ).rejects.toThrow(/absolute_expires_at/);
  });

  it('keeps the meaning of a login state that was started to link a provider', async () => {
    const pool = await oldDatabase();
    await pool.query(
      `insert into identity_user (id, username, status) values ('00000000-0000-7000-8000-000000000001', 'ann', 'active')`,
    );
    await pool.query(
      `insert into identity_login_state (id, provider_id, state_hash, nonce_hash, binding_hash, link_user_id, expires_at)
       values (gen_random_uuid(), 'idp', 's1', 'n', 'b', '00000000-0000-7000-8000-000000000001', now() + interval '5 minutes'),
              (gen_random_uuid(), 'idp', 's2', 'n', 'b', null, now() + interval '5 minutes')`,
    );

    await migrate(pool, join(here, 'migrations'));

    expect(
      await rows(pool, 'select state_hash, purpose from identity_login_state order by state_hash'),
    ).toEqual([
      { state_hash: 's1', purpose: 'link' },
      { state_hash: 's2', purpose: 'login' },
    ]);
  });
});
