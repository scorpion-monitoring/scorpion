// The module as the kernel sees it: permissions, events, registries, tables, its place in the module graph,
// the profile that has no shell and no audit module, and the rules that keep the schema free of enums.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { FIELDS } from './config/fields.ts';
import * as schema from './db/schema.ts';
import manifest, { createServicesModule } from './module.ts';
import { settingsSchema } from './settings-schema.ts';
import packageJson from './package.json' with { type: 'json' };
import { fixtureContributor, useServices } from './test/harness.ts';

const h = useServices();
const dir = fileURLToPath(new URL('.', import.meta.url));

const sourceFiles = (folder: string): string[] =>
  readdirSync(join(dir, folder), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(folder, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [join(folder, entry.name)]
        : [],
  );

describe('the manifest', () => {
  it('has the id, the table prefix, five plain permissions (one of them the v1 read) and three scoped to the service (ADR-0036)', () => {
    expect(manifest.id).toBe('registry.services');
    expect(manifest.tablePrefix).toBe('svc_');
    const permissions = manifest.permissions ?? {};
    expect(
      Object.entries(permissions)
        .filter(([, p]) => !p.scope)
        .map(([id]) => id)
        .sort(),
    ).toEqual([
      'registry.services.service.create',
      'registry.services.service.manage',
      'registry.services.service.publish',
      'registry.services.service.read',
      'registry.services.v1.read',
    ]);
    expect(
      Object.entries(permissions)
        .filter(([, p]) => p.scope)
        .map(([id, p]) => [id, p.scope])
        .sort(),
    ).toEqual([
      ['registry.services.service.edit', 'service'],
      ['registry.services.service.edit-identity', 'service'],
      ['registry.services.service.read-contact', 'service'],
    ]);
  });

  it('declares the five events with ids and field names only', () => {
    expect(Object.keys(manifest.events?.emits ?? {})).toEqual([
      'registry.service.created@1',
      'registry.service.updated@1',
      'registry.service.slugChanged@1',
      'registry.service.published@1',
      'registry.service.unpublished@1',
    ]);
  });

  it('registers the policy service.member for the resource type service', () => {
    const policies = (manifest.contributes?.['authz.resourcePolicy'] ?? []) as {
      resourceType: string;
    }[];
    expect(policies.map((p) => p.resourceType)).toEqual(['service']);
  });

  it('declares the five registries and contributes the seeds, org.usage and the stage usage', () => {
    expect(Object.keys(manifest.registries ?? {}).sort()).toEqual([
      'service.facet',
      'service.fieldType',
      'service.orgRole',
      'service.profileContributor',
      'service.wizardStep',
    ]);
    const contributes = manifest.contributes ?? {};
    expect((contributes['service.orgRole'] as { id: string }[]).map((r) => r.id)).toEqual([
      'provider',
      'consortium',
    ]);
    expect((contributes['service.fieldType'] as { id: string }[]).map((t) => t.id)).toEqual([
      'text',
      'select',
      'multi-select',
      'license',
      'organisation',
      'image',
    ]);
    expect((contributes['service.facet'] as { id: string }[]).map((f) => f.id)).toEqual([
      'consortium',
      'stage',
      'license',
      'provider',
    ]);
    expect((contributes['org.usage'] as { id: string }[]).map((u) => u.id)).toEqual([
      'registry.services',
    ]);
    expect((contributes['vocabulary'] as { id: string }[]).map((v) => v.id)).toEqual(['stage']);
    expect(contributes['authz.defaultRole']).toEqual([
      {
        role: 'user',
        permissions: [
          'registry.services.service.read',
          'registry.services.service.create',
          'registry.services.v1.read',
        ],
      },
      {
        role: 'reviewer',
        permissions: ['registry.services.service.read', 'registry.services.service.publish'],
      },
    ]);
  });

  it('declares the settings with defaults, titles and descriptions', () => {
    expect(Object.keys(settingsSchema.shape)).toEqual(['exposeContactPoint', 'allowPublic']);
    expect(settingsSchema.parse({})).toEqual({ exposeContactPoint: true, allowPublic: true });
    for (const field of Object.values(settingsSchema.shape)) {
      expect(field.meta()).toMatchObject({
        title: expect.any(String) as string,
        description: expect.any(String) as string,
      });
    }
    expect(settingsSchema.safeParse({ allowPublic: 'yes' }).success).toBe(false);
    expect(settingsSchema.safeParse({ other: true }).success).toBe(false);
  });

  it('depends on authz, settings, identity, notifications, blob, organisations and the SPDX adapter, with the shell and audit as optional peers', () => {
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/core-blob',
      '@scorpion/core-identity',
      '@scorpion/core-notifications',
      '@scorpion/core-settings',
      '@scorpion/integrations',
      '@scorpion/kernel',
      '@scorpion/registry-organisations',
      'drizzle-orm',
      'hono',
      'zod',
    ]);
    expect(Object.keys(packageJson.peerDependencies).sort()).toEqual(['@scorpion/core-ui-shell']);
    expect(packageJson.exports['./public']).toBe('./public.ts');
  });
});

describe('the tables', () => {
  const tables = Object.values(schema as Record<string, unknown>).filter(
    (value): value is PgTable => is(value, PgTable),
  );

  it('are the five of ADR-0035, every one with the prefix svc_', () => {
    expect(tables.map((t) => getTableName(t)).sort()).toEqual([
      'svc_field_value',
      'svc_license_cache',
      'svc_service',
      'svc_service_organisation',
      'svc_slug_history',
    ]);
    for (const table of tables) expect(getTableName(table).startsWith('svc_')).toBe(true);
  });

  it('are the only ones the migrations create, and the migrations contain no enum', () => {
    const sql = readdirSync(join(dir, 'migrations'))
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(dir, 'migrations', file), 'utf8'))
      .join('\n');
    const created = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]!);
    expect(created.sort()).toEqual(tables.map((t) => getTableName(t)).sort());
    expect(sql).not.toMatch(/CREATE TYPE|AS ENUM/i);
    expect(readFileSync(join(dir, 'db/schema.ts'), 'utf8')).not.toMatch(/pgEnum/);
  });

  it('create no pg enum in the migrated database, and no table without the prefix', async () => {
    const s = await h.start();
    const enums = await s.pool.query("select typname from pg_type where typtype = 'e'");
    expect(enums.rows).toEqual([]);
    const own = await s.pool.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like '%service%' and table_name not like 'svc\\_%' and table_name not like 'kernel\\_%'`,
    );
    expect(own.rows).toEqual([]);
    const all = await s.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'svc\\_%' order by 1",
    );
    expect(all.rows.map((r: { table_name: string }) => r.table_name)).toEqual(
      tables.map((t) => getTableName(t)).sort(),
    );
  });

  it('have no foreign key to an organisation, a user or a file: those ids are plain columns', async () => {
    const s = await h.start();
    const { rows } = await s.pool.query<{ from_table: string; to_table: string }>(
      `select conrelid::regclass::text as from_table, confrelid::regclass::text as to_table
         from pg_constraint where contype = 'f' and conrelid::regclass::text like 'svc\\_%'`,
    );
    expect(rows.map((r) => r.to_table).sort()).toEqual([
      'svc_service',
      'svc_service',
      'svc_service',
    ]);
  });
});

describe('no hard-coded vocabulary', () => {
  // The roles live in the registry, the stages in the vocabulary: no list of them and no label for the
  // words `provider` or `consortium` in code. The files below are the data that contains the keys.
  const DATA = new Set([
    'service/registries.ts',
    'service/facets.ts',
    // The key of the owning role and the keys of the identity fields: data, not a message.
    'service/permissions.ts',
    'service/field-rules.ts',
    'config/fields.ts',
    'config/steps.ts',
  ]);

  it('keeps the words provider and consortium out of messages and logic outside the seeds and the config', () => {
    const offenders: string[] = [];
    for (const file of [
      ...sourceFiles('service'),
      ...sourceFiles('config'),
      'routes.ts',
      'module.ts',
    ]) {
      if (DATA.has(file)) continue;
      const text = readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      for (const match of text.matchAll(
        /(['"`])[^'"`\n]*\b(provider|consortium|consortia)\b[^'"`\n]*\1/g,
      )) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    // The documented body field names and the problem texts that name a role from the registry are the
    // only places: routes.ts documents the shipped body shape, the service builds messages from entries.
    expect(offenders.filter((o) => !o.startsWith('routes.ts'))).toEqual([]);
  });

  it('keeps stage terms out of the code', () => {
    for (const file of [...sourceFiles('service'), 'module.ts', 'routes.ts']) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/['"](DEV|DEMO|PROD|TERM)['"]/);
    }
  });

  it('has no stage list in the config: the stage field reads the vocabulary', () => {
    const stage = FIELDS.find((f) => f.key === 'stage')!;
    expect(stage.config).toEqual({ vocabulary: 'stage' });
  });
});

describe('start', () => {
  it('works without the shell and without core.audit: the API alone', async () => {
    const s = await h.start();
    expect(s.kernel.services.get('registry.services')).toBeDefined();
  });

  it('refuses to start with a bad config, naming the file and the field', async () => {
    const bad = createServicesModule({
      config: {
        steps: [],
        fields: [{ ...FIELDS[0]!, type: 'rich-text' }, ...FIELDS.slice(1)],
      },
    });
    expect(bad.id).toBe('registry.services');
    const kernel = await h.build({
      config: {
        steps: [],
        fields: [{ ...FIELDS[0]!, type: 'rich-text' }, ...FIELDS.slice(1)],
      },
    });
    await expect(kernel.start()).rejects.toThrow(
      /config\/fields\.ts: field "slug": the field type "rich-text" is not registered/,
    );
  });

  it('refuses to start when a contributed step clashes with the config, naming the step', async () => {
    const kernel = await h.build({
      extra: [
        fixtureContributor({
          contributes: {
            'service.wizardStep': [
              {
                id: 'clash',
                order: 10,
                title: 'fixture.step.clash.title',
                fields: [],
                component: 'X',
              },
            ],
          },
        }),
      ],
    });
    await expect(kernel.start()).rejects.toThrow(
      /service\.wizardStep "clash" \(contributed\): order 10 is already used by step "basics"/,
    );
  });
});
