// The module as the kernel sees it: permissions, events, registries, tables, its place in the module
// graph, and the profile that has no shell.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { useOrganisations } from './test/harness.ts';

const h = useOrganisations();
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
  it('has the id, the table prefix and the two permissions', () => {
    expect(manifest.id).toBe('registry.organisations');
    expect(manifest.tablePrefix).toBe('org_');
    expect(Object.keys(manifest.permissions ?? {}).sort()).toEqual([
      'registry.organisations.organisation.manage',
      'registry.organisations.organisation.read',
    ]);
  });

  it('emits the three organisation events, each strict, with names and ids only', () => {
    expect(Object.keys(manifest.events?.emits ?? {}).sort()).toEqual([
      'registry.organisation.created@1',
      'registry.organisation.deleted@1',
      'registry.organisation.updated@1',
    ]);
  });

  it('declares the registries org.type and org.usage, and contributes the seed types and the default roles', () => {
    expect(Object.keys(manifest.registries ?? {}).sort()).toEqual(['org.type', 'org.usage']);
    expect((manifest.contributes?.['org.type'] as { id: string }[]).map((t) => t.id)).toEqual([
      'provider',
      'consortium',
    ]);
    expect(manifest.contributes?.['authz.defaultRole']).toEqual([
      { role: 'user', permissions: ['registry.organisations.organisation.read'] },
    ]);
  });

  it('creates one table with the prefix org_, no foreign key and no enum', () => {
    const migrations = join(dir, 'migrations');
    const sql = readdirSync(migrations)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrations, file), 'utf8'))
      .join('\n');
    expect([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1])).toEqual([
      'org_organisation',
    ]);
    expect(sql).not.toMatch(/REFERENCES/i);
    expect(sql).not.toMatch(/CREATE TYPE/i);
  });

  it('uses no pgEnum anywhere in its source', () => {
    const offenders = [...sourceFiles('db'), ...sourceFiles('service')].filter((file) =>
      /\bpgEnum\b/.test(readFileSync(join(dir, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('hard-codes no instance name or address (rule 9)', () => {
    const text = [...sourceFiles('service'), 'module.ts', 'routes.ts']
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('\n');
    expect(text).not.toMatch(/de\.NBI|NFDI|denbi\.de|@ipk-/i);
  });

  it('depends on authz, settings, identity, notifications and blob, with the shell as the one optional peer', () => {
    const own = Object.keys(packageJson.dependencies).filter((n) =>
      n.startsWith('@scorpion/core-'),
    );
    expect(own.sort()).toEqual([
      '@scorpion/core-authz',
      '@scorpion/core-blob',
      '@scorpion/core-identity',
      '@scorpion/core-notifications',
      '@scorpion/core-settings',
    ]);
    expect(Object.keys(packageJson.peerDependencies)).toEqual(['@scorpion/core-ui-shell']);
    expect(packageJson.peerDependenciesMeta['@scorpion/core-ui-shell']).toEqual({ optional: true });
  });
});

describe('in a profile', () => {
  it('loads after the core modules it depends on, creates its table and its events are known', async () => {
    const s = await h.start();
    const ids = s.kernel.profile.modules.map((m) => m.id);
    expect(ids.indexOf('registry.organisations')).toBeGreaterThan(ids.indexOf('core.authz'));
    expect(ids.indexOf('registry.organisations')).toBeGreaterThan(ids.indexOf('core.identity'));
    const { rows } = await s.pool.query<{ t: string | null }>(
      "select to_regclass('org_organisation') as t",
    );
    expect(rows[0]!.t).toBe('org_organisation');
    expect([...s.kernel.composition.events.keys()]).toContain('registry.organisation.created@1');
  });

  it('starts without the shell: no web profile is needed for the service and the routes', async () => {
    const s = await h.start();
    expect(s.kernel.profile.modules.map((m) => m.id)).not.toContain('core.ui-shell');
    const paths = s.kernel.routes.map((r) => r.route.path);
    expect(paths).toContain('/organisations');
    expect(paths).toContain('/organisations/{id}');
    expect(paths).toContain('/organisation-types');
  });

  it('gives every route a permission and none is public', async () => {
    const s = await h.start();
    const own = s.kernel.routes.filter((r) => r.route.path.startsWith('/organisation'));
    expect(own).toHaveLength(6);
    for (const { route } of own) {
      expect(route.permission, `${route.method} ${route.path}`).toMatch(
        /^registry\.organisations\./,
      );
      expect(route.public).not.toBe(true);
    }
  });
});
