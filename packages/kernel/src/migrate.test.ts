import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  allFixtureSources,
  FIXTURE_MODULE_PACKAGES,
  fixtureProfile,
} from '../test/fixtures/index.ts';
import { loadConfig } from './config.ts';
import { KernelStartupError } from './errors.ts';
import { createKernel, type Kernel } from './kernel.ts';
import { createLogger } from './logger.ts';

// However many migrations the kernel itself has; the tests should not need editing for each new one.
const kernelMigrations = (
  JSON.parse(
    readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'),
  ) as {
    entries: unknown[];
  }
).entries.length;

let server: StartedPostgres;
const sources = await allFixtureSources();
const open: Kernel[] = [];

beforeAll(async () => {
  server = await startPostgres();
}, 120_000);

afterEach(async () => {
  await Promise.all(open.splice(0).map((kernel) => kernel.stop()));
});

afterAll(async () => {
  await server?.stop();
});

async function kernelFor(profileName: string, databaseUrl: string): Promise<Kernel> {
  const kernel = createKernel({
    profile: await fixtureProfile(profileName),
    sources,
    modulePackages: FIXTURE_MODULE_PACKAGES,
    config: loadConfig({ DATABASE_URL: databaseUrl }),
    log: createLogger({ level: 'silent' }),
  });
  open.push(kernel);
  return kernel;
}

async function query<T extends pg.QueryResultRow>(url: string, text: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

const tables = async (url: string) =>
  (
    await query<{ table_name: string }>(
      url,
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    )
  ).map((row) => row.table_name);

describe('migrations', () => {
  it('creates each module’s tables and one journal table per module, dependencies first', async () => {
    const url = await server.createDatabase();
    const kernel = await kernelFor('ab', url);

    const report = await kernel.migrate();

    expect(Object.keys(report.applied)).toEqual(['kernel', 'fixture.b', 'fixture.a']);
    expect(await tables(url)).toEqual([
      'fixture_a_note',
      'fixture_b_thing',
      'kernel_job_run',
      'kernel_migrations_fixture_a',
      'kernel_migrations_fixture_b',
      'kernel_migrations_kernel',
      'kernel_outbox',
      'kernel_outbox_delivery',
      'kernel_rate_bucket',
    ]);
  });

  it('applies nothing the second time', async () => {
    const url = await server.createDatabase();
    const kernel = await kernelFor('ab', url);
    await kernel.migrate();

    expect((await kernel.migrate()).applied).toEqual({});
    const rows = await query(url, 'select * from kernel_migrations_fixture_a');
    expect(rows).toHaveLength(1);
  });

  it('reports pending migrations until they are applied', async () => {
    const url = await server.createDatabase();
    const kernel = await kernelFor('ab', url);
    expect(await kernel.pendingMigrations()).toEqual([
      { module: 'kernel', pending: kernelMigrations },
      { module: 'fixture.b', pending: 1 },
      { module: 'fixture.a', pending: 1 },
    ]);
    await kernel.migrate();
    expect(await kernel.pendingMigrations()).toEqual([]);
  });

  it('does not migrate a module that is not in the profile', async () => {
    const url = await server.createDatabase();
    await (await kernelFor('b-only', url)).migrate();
    expect(await tables(url)).not.toContain('fixture_a_note');
    expect(await tables(url)).toContain('fixture_b_thing');
  });
});

describe('two processes starting at the same time', () => {
  it('migrate exactly once and neither fails', async () => {
    const url = await server.createDatabase();
    const kernels = await Promise.all([1, 2, 3, 4].map(() => kernelFor('ab', url)));

    const reports = await Promise.all(kernels.map((kernel) => kernel.migrate()));

    const appliedTotal = reports.reduce(
      (sum, report) => sum + Object.values(report.applied).reduce((a, b) => a + b, 0),
      0,
    );
    expect(appliedTotal).toBe(kernelMigrations + 2); // plus one each for fixture.b and fixture.a, in one process
    expect(reports.filter((report) => Object.keys(report.applied).length > 0)).toHaveLength(1);
    expect(await query(url, 'select * from kernel_migrations_fixture_a')).toHaveLength(1);
    expect(await query(url, 'select * from kernel_migrations_fixture_b')).toHaveLength(1);
  });

  it('start() from two kernels at once also succeeds', async () => {
    const url = await server.createDatabase();
    const [one, two] = await Promise.all([kernelFor('ab', url), kernelFor('ab', url)]);
    await Promise.all([one.start(), two.start()]);
    expect(await query(url, 'select * from kernel_migrations_fixture_b')).toHaveLength(1);
  });

  it('releases the lock, so a later run is not blocked', async () => {
    const url = await server.createDatabase();
    await (await kernelFor('b-only', url)).migrate();
    const locks = await query<{ count: string }>(
      url,
      `select count(*) from pg_locks where locktype = 'advisory'`,
    );
    expect(Number(locks[0]!.count)).toBe(0);
  });
});

describe('the table-prefix rule', () => {
  it('fails when a migration creates a table without the module’s prefix, and names it', async () => {
    const url = await server.createDatabase();
    const kernel = await kernelFor('bad-prefix', url);

    const error = await kernel.migrate().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KernelStartupError);
    expect((error as KernelStartupError).message).toContain('fixture.bad-prefix');
    expect((error as KernelStartupError).message).toContain('"stray_table"');
    expect((error as KernelStartupError).message).toContain(
      'must start with "fixture_bad_prefix_"',
    );
  });

  it('leaves nothing behind: the module’s migration rolls back as a whole, journal included', async () => {
    const url = await server.createDatabase();
    await (await kernelFor('bad-prefix', url)).migrate().catch(() => undefined);
    const found = await tables(url);
    expect(found).not.toContain('stray_table');
    expect(found).not.toContain('fixture_bad_prefix_fine');
    expect(found).not.toContain('kernel_migrations_fixture_bad_prefix');
  });

  it('also checks the Drizzle schema before start() touches the database', async () => {
    const url = await server.createDatabase();
    const kernel = await kernelFor('bad-prefix', url);
    await expect(kernel.start()).rejects.toThrowError(
      /table "stray_table" must start with "fixture_bad_prefix_"/,
    );
    expect(await tables(url)).toEqual([]); // not even the kernel's tables: it failed first
  });

  it('stops the run at the failing module; the lock is released', async () => {
    const url = await server.createDatabase();
    await (await kernelFor('bad-prefix', url)).migrate().catch(() => undefined);
    const locks = await query<{ count: string }>(
      url,
      `select count(*) from pg_locks where locktype = 'advisory'`,
    );
    expect(Number(locks[0]!.count)).toBe(0);
  });
});
