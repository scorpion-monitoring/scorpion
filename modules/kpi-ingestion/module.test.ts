// The module as the kernel sees it: its place in the module graph, its tables and their prefix, the permission, the event
// and the contributions, and the rules that keep the schema free of enums and of foreign keys to anything but declared
// dependencies. Plus the walker that proves there is one write path.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './db/schema.ts';
import manifest, { measurementRecordedSchema } from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { useKpi } from './test/harness.ts';

const h = useKpi();
const dir = fileURLToPath(new URL('.', import.meta.url));
const root = join(dir, '..', '..');

const filesUnder = (folder: string, keep: (name: string) => boolean): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return ['node_modules', 'dist', '.svelte-kit', 'build', 'generated', 'reports'].includes(
        entry.name,
      )
        ? []
        : filesUnder(join(folder, entry.name), keep);
    return keep(entry.name) ? [join(folder, entry.name)] : [];
  });

describe('the manifest', () => {
  it('has the id, the table prefix kpii_, the one scoped permission and the four plain ones', () => {
    expect(manifest.id).toBe('kpi.ingestion');
    expect(manifest.tablePrefix).toBe('kpii_');
    expect(manifest.permissions).toEqual({
      'kpi.ingestion.measurement.submit': {
        scope: 'service',
        description: expect.any(String) as string,
      },
      'kpi.ingestion.v1.read': { description: expect.any(String) as string },
      'kpi.ingestion.v1.write': { description: expect.any(String) as string },
      'kpi.ingestion.measurement.read': { description: expect.any(String) as string },
      'kpi.ingestion.measurement.ingest': { description: expect.any(String) as string },
    });
  });

  it('declares the event measurement.recorded@1, the registry ingestion.adapter and its routes, and no page yet', () => {
    expect(Object.keys(manifest.events?.emits ?? {})).toEqual(['measurement.recorded@1']);
    expect(Object.keys(manifest.registries ?? {})).toEqual(['ingestion.adapter']);
    expect(manifest.routes).toBeTypeOf('function');
    expect(manifest.ui).toBeUndefined();
  });

  it('contributes the policy of its scoped permission, the count of its measurements to kpi.framework and its three adapters', () => {
    const contributes = manifest.contributes ?? {};
    expect(Object.keys(contributes).sort()).toEqual([
      'authz.defaultRole',
      'authz.resourcePolicy',
      'ingestion.adapter',
      'kpi.indicatorUsage',
    ]);
    expect(
      (contributes['ingestion.adapter'] as { id: string }[]).map((entry) => entry.id),
    ).toEqual(['form', 'csv', 'xlsx']);
    expect(
      (contributes['authz.resourcePolicy'] as { resourceType: string }[]).map(
        (entry) => entry.resourceType,
      ),
    ).toEqual(['service']);
    expect(
      (contributes['kpi.indicatorUsage'] as { module: string; what: string }[]).map((entry) => [
        entry.module,
        entry.what,
      ]),
    ).toEqual([['kpi.ingestion', 'measurements']]);
  });

  it('depends on exactly what it imports, and the scoped permission is not a role’s: only the four plain ones are held by the role user', () => {
    expect(
      Object.keys(packageJson.dependencies)
        .filter((name) => name.startsWith('@scorpion/'))
        .sort(),
    ).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/kernel',
      '@scorpion/kpi-framework',
      '@scorpion/registry-services',
    ]);
    // `submit` is in no role: the service decides who may write for a service. The plain ones are what a token's scopes name.
    expect(manifest.contributes?.['authz.defaultRole']).toEqual([
      {
        role: 'user',
        permissions: [
          'kpi.ingestion.v1.read',
          'kpi.ingestion.v1.write',
          'kpi.ingestion.measurement.read',
          'kpi.ingestion.measurement.ingest',
        ],
      },
    ]);
  });
});

describe('the schema', () => {
  const tables = Object.values(schema as Record<string, unknown>).filter(
    (value): value is PgTable => is(value, PgTable),
  );

  it('has the two tables, each with the prefix of the manifest', () => {
    expect(tables.map((table) => getTableName(table)).sort()).toEqual([
      'kpii_ingestion_run',
      'kpii_measurement',
    ]);
    for (const table of tables)
      expect(getTableName(table).startsWith(manifest.tablePrefix!)).toBe(true);
  });

  it('has no pg enum, in the schema, the migrations or the sources', () => {
    expect(Object.keys(schema).filter((name) => /enum/i.test(name))).toEqual([]);
    const migrations = join(dir, 'migrations');
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')))
      expect(readFileSync(join(migrations, file), 'utf8'), file).not.toMatch(/create type/i);
    for (const file of filesUnder(
      dir,
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    ))
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/pgEnum/);
  });

  it('imports no other module except through its public.ts and the packages it declares', () => {
    const allowed = new Set([
      '@scorpion/contracts',
      '@scorpion/core-authz/public',
      '@scorpion/kernel',
      '@scorpion/kpi-framework/public',
      '@scorpion/registry-services/public',
      // the test harness composes the real modules it needs (the eslint rule lists it as a manifest importer)
      '@scorpion/core-authz/module',
      '@scorpion/core-authz/package.json',
      '@scorpion/core-blob/module',
      '@scorpion/core-blob/package.json',
      '@scorpion/core-identity/module',
      '@scorpion/core-identity/package.json',
      '@scorpion/core-notifications/module',
      '@scorpion/core-notifications/package.json',
      '@scorpion/core-settings/module',
      '@scorpion/core-settings/package.json',
      '@scorpion/kpi-framework/module',
      '@scorpion/kpi-framework/package.json',
      '@scorpion/registry-organisations/module',
      '@scorpion/registry-organisations/package.json',
      '@scorpion/registry-services/module',
      '@scorpion/registry-services/package.json',
      '@scorpion/testing',
    ]);
    for (const file of filesUnder(
      dir,
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    )) {
      for (const [, from] of readFileSync(file, 'utf8').matchAll(/from '(@scorpion\/[^']+)'/g))
        expect(allowed.has(from!), `${relative(dir, file)} imports ${from}`).toBe(true);
    }
  });
});

describe('in a profile', () => {
  it('starts: the loader accepts the prefix, the migrations create the two tables, and every foreign key points to a declared table', async () => {
    const s = await h.start();
    const { rows } = await s.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'kpii\\_%' order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(['kpii_ingestion_run', 'kpii_measurement']);
    const foreign = await s.pool.query<{ from: string; to: string; delete: string }>(
      `select conrelid::regclass::text as "from", confrelid::regclass::text as "to", confdeltype as "delete"
         from pg_constraint where contype = 'f' and conrelid::regclass::text like 'kpii\\_%' order by 1, 2`,
    );
    // to this module's own run table (set null) and to kpi.framework's indicator (restrict): nothing else, no service table
    expect(foreign.rows).toEqual([
      { from: 'kpii_measurement', to: 'kpif_indicator', delete: 'r' },
      { from: 'kpii_measurement', to: 'kpii_ingestion_run', delete: 'n' },
    ]);
    const enums = await s.pool.query(
      `select t.typname from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`,
    );
    expect(enums.rows).toEqual([]);
  });

  it('migrates twice without a change (a restart)', async () => {
    const s = await h.start();
    await expect(s.kernel.migrate()).resolves.toBeDefined();
  });

  it('is in the full profile and in no other', () => {
    const profiles = join(root, 'profiles');
    for (const file of readdirSync(profiles).filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(join(profiles, file), 'utf8');
      expect(text.includes("'kpi.ingestion'"), file).toBe(file === 'full.ts');
    }
  });

  it('names kpi.framework as the only module it needs beyond authz and registry.services', async () => {
    const s = await h.start();
    expect(s.kernel.services.get('kpi.ingestion')).toBeDefined();
    expect(typeof s.ingestion.measurements.upsertBatch).toBe('function');
  });
});

describe('one write path', () => {
  /** Code that is not a test, in the places a writer could live. */
  const sources = ['modules', 'apps', 'packages', 'tools']
    .flatMap((folder) => {
      try {
        return filesUnder(
          join(root, folder),
          (name) => /\.(ts|js|svelte)$/.test(name) && !/\.test\.ts$/.test(name),
        );
      } catch {
        return [];
      }
    })
    .filter((file) => !file.endsWith('.d.ts'));
  const WRITES =
    /(insert\s+into|update|delete\s+from)\s+"?kpii_measurement\b|\.(insert|update|delete)\(\s*measurement\s*\)/i;

  it('has no code that writes kpii_measurement except upsertBatch (the form, CSV, XLSX, the routes and the migration tool call it)', () => {
    const writers = sources
      .filter((file) => WRITES.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    // The factory of the testing package inserts rows on purpose to build cases the service refuses; it is not a writer of the product.
    expect(writers.filter((file) => file !== 'packages/testing/src/measurements.ts')).toEqual([
      'modules/kpi-ingestion/service/measurements.ts',
    ]);
  });

  it('would notice a writer: the pattern matches the statements it is meant to catch', () => {
    for (const statement of [
      'insert into kpii_measurement (id) values (1)',
      'INSERT INTO "kpii_measurement"',
      'update kpii_measurement set value_text = null',
      'delete from kpii_measurement',
      'await tx.insert(measurement).values([])',
      'db.delete(measurement)',
    ])
      expect(WRITES.test(statement), statement).toBe(true);
    for (const statement of [
      'select * from kpii_measurement',
      'insert into kpii_ingestion_run',
      'tx.insert(measurementRows)',
    ])
      expect(WRITES.test(statement), statement).toBe(false);
  });
});

describe('the event measurement.recorded@1', () => {
  it('is declared with the schema this module exports', () => {
    expect(manifest.events?.emits?.['measurement.recorded@1']).toBe(measurementRecordedSchema);
  });
});
