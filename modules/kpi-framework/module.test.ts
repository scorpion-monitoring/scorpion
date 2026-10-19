// The module as the kernel sees it: its place in the module graph, its tables and their prefix, the registries,
// the events, the settings, and the rules that keep the schema free of enums and of foreign keys to other modules.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './db/schema.ts';
import manifest from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { SEED_UNITS } from './config/units.ts';
import { settingsSchema } from './settings-schema.ts';
import { fixtureContributor, useKpi } from './test/harness.ts';

const h = useKpi();
const dir = fileURLToPath(new URL('.', import.meta.url));

const sourceFiles = (folder: string): string[] =>
  readdirSync(join(dir, folder), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === 'node_modules' || entry.name === 'dist'
        ? []
        : sourceFiles(join(folder, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [join(folder, entry.name)]
        : [],
  );

const TABLES = [
  'kpif_evaluation',
  'kpif_indicator',
  'kpif_indicator_means',
  'kpif_indicator_tool',
  'kpif_kpi_set',
  'kpif_kpi_set_indicator',
  'kpif_service_extra_indicator',
  'kpif_service_set',
];

describe('the manifest', () => {
  it('has the id, the table prefix kpif_ and the permissions of the indicator and set families, the service KPIs and the v1 read', () => {
    expect(manifest.id).toBe('kpi.framework');
    expect(manifest.tablePrefix).toBe('kpif_');
    expect(Object.keys(manifest.permissions ?? {}).sort()).toEqual([
      'kpi.framework.indicator.manage',
      'kpi.framework.indicator.read',
      'kpi.framework.service.kpis.edit',
      'kpi.framework.set.manage',
      'kpi.framework.set.read',
      'kpi.framework.v1.read',
    ]);
    // Only the service-scoped one has a scope (ADR-0036): the policy `service.member` grants it to a provider's members.
    const scoped = Object.entries(manifest.permissions ?? {}).filter(([, value]) => value.scope);
    expect(scoped.map(([id, value]) => [id, value.scope])).toEqual([
      ['kpi.framework.service.kpis.edit', 'service'],
    ]);
    for (const permission of Object.values(manifest.permissions ?? {}))
      expect(permission.description.length).toBeGreaterThan(10);
  });

  it('gives the role user the two read permissions and the v1 read, and nobody else a default grant (Admin holds everything)', () => {
    expect(manifest.contributes?.['authz.defaultRole']).toEqual([
      {
        role: 'user',
        permissions: [
          'kpi.framework.indicator.read',
          'kpi.framework.set.read',
          'kpi.framework.v1.read',
        ],
      },
    ]);
  });

  it('declares the three events, the value type registry and the contributions', () => {
    expect(Object.keys(manifest.events?.emits ?? {})).toEqual([
      'kpi.indicator.changed@1',
      'kpi.set.changed@1',
      'kpi.serviceSet.changed@1',
    ]);
    expect(Object.keys(manifest.registries ?? {})).toEqual(['kpi.valueType']);
    const contributes = manifest.contributes ?? {};
    expect((contributes['kpi.valueType'] as { id: string }[]).map((t) => t.id)).toEqual([
      'integer',
      'float',
      'text',
      'duration',
      'percentage',
    ]);
    expect((contributes['vocabulary'] as { id: string }[]).map((v) => v.id)).toEqual([
      'kpi.unit',
      'kpi.measured-by',
      'kpi.automation-tool',
      'kpi.service-category',
      'thematic-category',
      'necessity',
      'aggregate',
    ]);
    // What it adds to the registries of registry.services (ADR-0040 addendum): one field type, step and facet, and
    // the policy of its scoped permission.
    expect((contributes['service.fieldType'] as { id: string }[]).map((t) => t.id)).toEqual([
      'kpi-set',
    ]);
    expect((contributes['service.wizardStep'] as { id: string }[]).map((t) => t.id)).toEqual([
      'kpi-set',
    ]);
    expect((contributes['service.facet'] as { id: string }[]).map((t) => t.id)).toEqual([
      'kpi-set',
    ]);
    expect(
      (contributes['authz.resourcePolicy'] as { resourceType: string }[]).map(
        (t) => t.resourceType,
      ),
    ).toEqual(['service']);
  });

  it('declares iriBase with a default, a title and a description', () => {
    expect(Object.keys(settingsSchema.shape)).toEqual(['iriBase']);
    expect(settingsSchema.parse({})).toEqual({ iriBase: '' });
    expect(settingsSchema.shape.iriBase.meta()).toMatchObject({
      title: expect.any(String) as string,
      description: expect.any(String) as string,
    });
    expect(settingsSchema.safeParse({ other: true }).success).toBe(false);
  });

  it.each([
    ['https://kpi.example.org', 'https://kpi.example.org'],
    ['  https://kpi.example.org/base  ', 'https://kpi.example.org/base'],
    ['', ''],
  ])('accepts the IRI base %j', (value, expected) => {
    expect(settingsSchema.parse({ iriBase: value })).toEqual({ iriBase: expected });
  });

  it.each([
    'kpi.example.org',
    'ftp://kpi.example.org',
    'https://kpi.example.org?x=1',
    'https://kpi.example.org/a b',
    'https://u:p@kpi.example.org',
    `https://kpi.example.org/${'a'.repeat(200)}`,
    42,
  ])('refuses the IRI base %j', (value) => {
    expect(settingsSchema.safeParse({ iriBase: value }).success).toBe(false);
  });

  it('depends on core.authz, core.settings and registry.services, and on no other module', () => {
    const modules = Object.keys(packageJson.dependencies)
      .filter((name) => name.startsWith('@scorpion/'))
      .sort();
    expect(modules).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/core-settings',
      '@scorpion/kernel',
      '@scorpion/registry-services',
    ]);
    expect(Object.keys(packageJson.exports)).toEqual([
      './module',
      './public',
      './ui',
      './package.json',
    ]);
  });
});

describe('the events carry ids and field names, never text', () => {
  const emits = manifest.events!.emits!;
  const id = '0198a2f0-0000-7000-8000-000000000001';

  it('accepts the documented payloads', () => {
    expect(
      emits['kpi.indicator.changed@1']!.safeParse({
        indicatorId: id,
        change: 'updated',
        fields: ['unit', 'measuredBy'],
        actorId: id,
      }).success,
    ).toBe(true);
    expect(
      emits['kpi.set.changed@1']!.safeParse({
        setId: id,
        change: 'created',
        fields: ['indicators', 'evaluation'],
        actorId: null,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['a name', { name: 'Downloads' }],
    ['a description', { description: 'text' }],
    ['a slug', { slug: 'downloads' }],
  ])('refuses a payload that adds %s', (_what, extra) => {
    const base = { indicatorId: id, change: 'created', fields: [], actorId: null };
    expect(emits['kpi.indicator.changed@1']!.safeParse({ ...base, ...extra }).success).toBe(false);
    expect(
      emits['kpi.set.changed@1']!.safeParse({
        setId: id,
        change: 'created',
        fields: [],
        actorId: null,
        ...extra,
      }).success,
    ).toBe(false);
  });

  it('has a payload for the KPIs of a service that holds ids and field names only', () => {
    const schema = emits['kpi.serviceSet.changed@1']!;
    const base = { serviceId: id, setId: id, fields: ['set', 'extras'], actorId: null };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, setId: null }).success).toBe(true);
    for (const extra of [{ name: 'KPI' }, { extras: [id] }, { indicatorIds: [id] }])
      expect(schema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false);
    expect(schema.safeParse({ ...base, serviceId: 'svc' }).success).toBe(false);
    expect(schema.safeParse({ ...base, setId: 'set' }).success).toBe(false);
  });

  it('refuses an unknown change and an id that is not a UUID', () => {
    expect(
      emits['kpi.set.changed@1']!.safeParse({
        setId: id,
        change: 'renamed',
        fields: [],
        actorId: null,
      }).success,
    ).toBe(false);
    expect(
      emits['kpi.indicator.changed@1']!.safeParse({
        indicatorId: 'downloads',
        change: 'created',
        fields: [],
        actorId: null,
      }).success,
    ).toBe(false);
  });
});

describe('the schema', () => {
  const tables = Object.values(schema as Record<string, unknown>).filter(
    (value): value is PgTable => is(value, PgTable),
  );

  it('has the eight tables, each with the prefix of the manifest', () => {
    expect(tables.map((table) => getTableName(table)).sort()).toEqual(TABLES);
    for (const table of tables)
      expect(getTableName(table).startsWith(manifest.tablePrefix!)).toBe(true);
  });

  it('has no pg enum, in the schema, the migrations or the sources', () => {
    expect(Object.keys(schema).filter((name) => /enum/i.test(name))).toEqual([]);
    const migrations = join(dir, 'migrations');
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')))
      expect(readFileSync(join(migrations, file), 'utf8'), file).not.toMatch(/create type/i);
    for (const file of sourceFiles('.').filter((name) => !name.startsWith('node_modules')))
      expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(/pgEnum/);
  });

  it('imports no other module except through its public.ts and the packages it declares', () => {
    const allowed = new Set([
      '@scorpion/contracts',
      '@scorpion/core-authz/public',
      '@scorpion/core-settings/public',
      '@scorpion/core-ui-shell/public',
      '@scorpion/registry-services/public',
      '@scorpion/kernel',
      '@scorpion/ui-kit',
      '@scorpion/contracts/client',
    ]);
    for (const file of sourceFiles('.').filter(
      (name) => !name.startsWith('node_modules') && !name.startsWith('test'),
    )) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const [, from] of text.matchAll(/from '(@scorpion\/[^']+)'/g))
        expect(allowed.has(from!), `${file} imports ${from}`).toBe(true);
    }
  });
});

describe('in a profile', () => {
  it('starts: the loader accepts the prefix, the migration creates exactly the eight tables, and every foreign key stays inside the module', async () => {
    const s = await h.start();
    const { rows } = await s.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'kpif\\_%' order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(TABLES);
    const foreign = await s.pool.query<{ from: string; to: string }>(
      `select conrelid::regclass::text as "from", confrelid::regclass::text as "to"
         from pg_constraint where contype = 'f' and conrelid::regclass::text like 'kpif\\_%'`,
    );
    expect(foreign.rows.length).toBeGreaterThan(0);
    for (const row of foreign.rows) expect(row.to, `${row.from} -> ${row.to}`).toMatch(/^kpif_/);
    const enums = await s.pool.query<{ typname: string }>(
      `select t.typname from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`,
    );
    expect(enums.rows).toEqual([]);
  });

  it('migrates twice without a change (a restart)', async () => {
    const s = await h.start();
    await expect(s.kernel.migrate()).resolves.toBeDefined();
  });

  it('seeds the value types, the units and the 16 RIMO categories, and leaves means and tools empty', async () => {
    const s = await h.start();
    expect(s.kpi.listValueTypes().map((type) => type.id)).toEqual([
      'integer',
      'float',
      'text',
      'duration',
      'percentage',
    ]);
    const keys = async (vocabulary: string) =>
      (await s.settings.listTerms(vocabulary)).map((term) => term.key);
    expect(await keys('kpi.unit')).toEqual(SEED_UNITS.map((unit) => unit.key));
    expect(await keys('kpi.service-category')).toHaveLength(16);
    expect(await keys('kpi.service-category')).toContain('Web_application');
    expect(await keys('kpi.measured-by')).toEqual([]);
    expect(await keys('kpi.automation-tool')).toEqual([]);
    const german = await s.settings.listTerms('kpi.unit', { locale: 'de' });
    expect(german.find((term) => term.key === 'second')?.label).toBe('Sekunde');
  });

  it('keeps a changed label across a restart (the seed adds what is missing and never overwrites)', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    await s.settings.vocabularies.updateTerm(admin, 'kpi.unit', 'count', {
      labels: { en: 'Number of things' },
    });
    await s.kernel.migrate();
    const units = await s.settings.listTerms('kpi.unit');
    expect(units.find((term) => term.key === 'count')?.label).toBe('Number of things');
  });

  it('saves an IRI base through the settings and refuses a bad one with a 422 that names the field', async () => {
    const s = await h.start();
    await s.configure({ iriBase: 'https://kpi.example.org' });
    const admin = await s.actor('admin');
    const saved = await s.settings.settings.get(admin, 'kpi.framework');
    expect(saved.values).toEqual({ iriBase: 'https://kpi.example.org' });
    await expect(s.configure({ iriBase: 'ftp://nope' })).rejects.toMatchObject({ status: 422 });
    await expect(s.configure({ iriBase: 'ftp://nope' })).rejects.toMatchObject({
      errors: [expect.objectContaining({ path: expect.stringContaining('iriBase') as string })],
    });
  });
});

describe('the value type registry', () => {
  const rating = {
    id: 'rating',
    labels: { en: 'Rating' },
    numeric: true,
    range: { min: 1, max: 5 },
    aggregates: ['avg'],
    parse: (input: unknown) =>
      Number.isInteger(input) ? { ok: true, value: input } : { ok: false, problem: 'no' },
    format: (value: unknown) => String(value),
    schema: () => ({}) as never,
  };

  it('takes a type from another module without a change here', async () => {
    const s = await h.start({
      extra: [fixtureContributor({ contributes: { 'kpi.valueType': [rating] } })],
    });
    expect(s.kpi.listValueTypes().map((type) => type.id)).toContain('rating');
    expect(s.kpi.findValueType('rating')?.range).toEqual({ min: 1, max: 5 });
    expect(s.kpi.findValueType('nonsense')).toBeUndefined();
  });

  it('refuses to start when two modules give the same id, and names the id', async () => {
    const s = h.start({
      extra: [
        fixtureContributor({ contributes: { 'kpi.valueType': [{ ...rating, id: 'integer' }] } }),
      ],
    });
    await expect(s).rejects.toThrow(/integer.*twice/);
  });

  it('refuses a contributed entry that is not valid, and names the module', async () => {
    const failure = h.build({
      extra: [
        fixtureContributor({
          id: 'fixture.bad-type',
          contributes: { 'kpi.valueType': [{ id: 'Bad Id', labels: { en: 'x' } }] },
        }),
      ],
    });
    await expect(failure).rejects.toThrow(/fixture\.bad-type: registry "kpi\.valueType" entry 0/);
  });
});
