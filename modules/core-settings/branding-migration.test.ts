// Migration 0002 (ADR-0018): `instanceName` and `mailFrom` moved from the settings of core.identity
// to the `branding` settings of core.settings. A database that stored them keeps them.
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
import { useSettings } from './test/harness.ts';

const harness = useSettings();
const folder = join(import.meta.dirname, 'migrations');
const scratch: string[] = [];
const pools: ReturnType<typeof createPool>[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => closePool(pool)));
});
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** The migrations as 0.4.0-dev (sprint 3) left them: the real folder without 0001 and 0002. */
function migrationsBeforeBranding(): string {
  const dir = mkdtempSync(join(tmpdir(), 'settings-migrations-'));
  scratch.push(dir);
  cpSync(folder, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  expect(journal.entries.map((e) => e.tag).slice(-1)).toEqual(['0002_branding_from_identity']);
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const target = (migrations: string): MigrationTarget[] => [
  { id: 'core.settings', migrations, tablePrefix: 'settings_' },
];
const migrate = (pool: ReturnType<typeof createPool>, migrations: string) =>
  runMigrations(pool, target(migrations), createLogger({ level: 'silent' }));

async function database() {
  const url = await harness.server().createDatabase();
  const pool = createPool({ DATABASE_URL: url });
  pools.push(pool);
  await migrate(pool, migrationsBeforeBranding());
  return pool;
}
const stored = async (pool: ReturnType<typeof createPool>, moduleId: string) =>
  (
    await pool.query<{ value: Record<string, unknown>; version: number }>(
      'select value, version from settings_setting where module_id = $1',
      [moduleId],
    )
  ).rows[0];
const put = (pool: ReturnType<typeof createPool>, moduleId: string, value: unknown, version = 1) =>
  pool.query('insert into settings_setting (module_id, value, version) values ($1, $2, $3)', [
    moduleId,
    JSON.stringify(value),
    version,
  ]);

describe('migration 0002: branding from identity', () => {
  it('moves both keys, keeps the other identity settings, and bumps the versions', async () => {
    const pool = await database();
    await put(
      pool,
      'core.identity',
      {
        localAccounts: false,
        instanceName: 'de.NBI Registry',
        mailFrom: 'registry@example.org',
      },
      3,
    );
    await migrate(pool, folder);
    expect(await stored(pool, 'core.identity')).toEqual({
      value: { localAccounts: false },
      version: 4,
    });
    expect(await stored(pool, 'core.settings')).toEqual({
      value: { branding: { instanceName: 'de.NBI Registry', mailFrom: 'registry@example.org' } },
      version: 1,
    });
  });

  it('moves one key when only one was stored', async () => {
    const pool = await database();
    await put(pool, 'core.identity', { mailFrom: 'registry@example.org' });
    await migrate(pool, folder);
    expect((await stored(pool, 'core.settings'))!.value).toEqual({
      branding: { mailFrom: 'registry@example.org' },
    });
    expect((await stored(pool, 'core.identity'))!.value).toEqual({});
  });

  it('merges into the settings of core.settings, keeps their other keys, and lets a value already in branding win', async () => {
    const pool = await database();
    await put(pool, 'core.identity', { instanceName: 'Old', mailFrom: 'old@example.org' });
    await put(
      pool,
      'core.settings',
      {
        rateLimits: { default: { burst: 7, perMinute: 7 } },
        branding: { instanceName: 'New', contactEmail: 'help@example.org' },
      },
      5,
    );
    await migrate(pool, folder);
    expect(await stored(pool, 'core.settings')).toEqual({
      value: {
        rateLimits: { default: { burst: 7, perMinute: 7 } },
        branding: {
          instanceName: 'New',
          mailFrom: 'old@example.org',
          contactEmail: 'help@example.org',
        },
      },
      version: 6,
    });
  });

  it('adds branding to settings of core.settings that have none', async () => {
    const pool = await database();
    await put(pool, 'core.identity', { instanceName: 'Old' });
    await put(pool, 'core.settings', { rateLimits: { strict: { burst: 3, perMinute: 3 } } });
    await migrate(pool, folder);
    expect((await stored(pool, 'core.settings'))!.value).toEqual({
      rateLimits: { strict: { burst: 3, perMinute: 3 } },
      branding: { instanceName: 'Old' },
    });
  });

  it.each([
    ['no settings at all', undefined],
    ['identity settings without either key', { localAccounts: true }],
  ])('changes nothing for %s', async (_name, identity) => {
    const pool = await database();
    if (identity) await put(pool, 'core.identity', identity);
    await migrate(pool, folder);
    expect(await stored(pool, 'core.settings')).toBeUndefined();
    expect((await stored(pool, 'core.identity'))?.value).toEqual(identity);
    expect((await stored(pool, 'core.identity'))?.version ?? 1).toBe(1);
  });

  it('is not run twice: the second start finds the journal up to date', async () => {
    const pool = await database();
    await put(pool, 'core.identity', { instanceName: 'Old' });
    await migrate(pool, folder);
    await migrate(pool, folder);
    expect(await stored(pool, 'core.settings')).toMatchObject({ version: 1 });
  });

  it('gives a kernel started on the migrated database the old name', async () => {
    const pool = await database();
    await put(pool, 'core.identity', {
      instanceName: 'de.NBI Registry',
      mailFrom: 'registry@example.org',
    });
    await migrate(pool, folder);
    const url = pool.options.connectionString!;
    const started = await harness.start({ databaseUrl: url });
    expect(await started.settings.getBranding()).toMatchObject({
      instanceName: 'de.NBI Registry',
      mailFrom: 'registry@example.org',
    });
  });
});
