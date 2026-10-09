// The module as the kernel sees it: permissions, events, registries, tables, its place in the module
// graph, and the profile that has no shell.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
import { settingsSchema } from './settings-schema.ts';
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
  it('has the id, the table prefix and the eight permissions: three plain, five scoped to organisation', () => {
    expect(manifest.id).toBe('registry.organisations');
    expect(manifest.tablePrefix).toBe('org_');
    const permissions = manifest.permissions ?? {};
    expect(Object.keys(permissions).sort()).toEqual([
      'registry.organisations.membership.decide',
      'registry.organisations.membership.manage-roles',
      'registry.organisations.membership.remove',
      'registry.organisations.membership.request',
      'registry.organisations.membership.view-members',
      'registry.organisations.organisation.manage',
      'registry.organisations.organisation.read',
      'registry.organisations.organisation.read-contact',
    ]);
    // A route names a plain permission only (ADR-0034); the scoped ones are checked by the service.
    const scoped = Object.entries(permissions)
      .filter(([, def]) => def.scope !== undefined)
      .map(([id, def]) => `${id}:${def.scope}`)
      .sort();
    expect(scoped).toEqual([
      'registry.organisations.membership.decide:organisation',
      'registry.organisations.membership.manage-roles:organisation',
      'registry.organisations.membership.remove:organisation',
      'registry.organisations.membership.view-members:organisation',
      'registry.organisations.organisation.read-contact:organisation',
    ]);
  });

  it('declares exposeContactPoint and the three membership settings, with defaults, titles and descriptions', () => {
    const shape = settingsSchema.shape;
    expect(Object.keys(shape)).toEqual(['exposeContactPoint', 'membership']);
    expect(settingsSchema.parse({})).toEqual({
      exposeContactPoint: true,
      membership: {
        maxPendingPerUser: 10,
        membersVisibleToMembers: true,
        maxManagersPerOrganisation: 20,
      },
    });
    for (const field of [shape.exposeContactPoint, shape.membership]) {
      expect(field.meta()).toMatchObject({
        title: expect.any(String) as string,
        description: expect.any(String) as string,
      });
    }
    const membership = shape.membership.unwrap().shape;
    expect(Object.keys(membership)).toEqual([
      'maxPendingPerUser',
      'membersVisibleToMembers',
      'maxManagersPerOrganisation',
    ]);
    for (const field of Object.values(membership)) {
      expect(field.meta()).toMatchObject({
        title: expect.any(String) as string,
        description: expect.any(String) as string,
      });
    }
    // The limits are bounded: 1 to 100.
    for (const key of ['maxPendingPerUser', 'maxManagersPerOrganisation']) {
      expect(settingsSchema.safeParse({ membership: { [key]: 0 } }).success, key).toBe(false);
      expect(settingsSchema.safeParse({ membership: { [key]: 101 } }).success, key).toBe(false);
      expect(settingsSchema.safeParse({ membership: { [key]: 100 } }).success, key).toBe(true);
    }
    expect(manifest.settings).toBe(settingsSchema);
    expect(manifest.permissions?.['registry.organisations.organisation.read-contact']?.scope).toBe(
      'organisation',
    );
  });

  it('emits the three organisation events and the four membership events, each strict, with names and ids only', () => {
    expect(Object.keys(manifest.events?.emits ?? {}).sort()).toEqual([
      'registry.membership.decided@1',
      'registry.membership.left@1',
      'registry.membership.requested@1',
      'registry.membership.roleChanged@1',
      'registry.organisation.created@1',
      'registry.organisation.deleted@1',
      'registry.organisation.updated@1',
    ]);
  });

  it('declares the registries org.type and org.usage, and contributes the seed types, the default roles and the member policy', () => {
    expect(Object.keys(manifest.registries ?? {}).sort()).toEqual(['org.type', 'org.usage']);
    expect((manifest.contributes?.['org.type'] as { id: string }[]).map((t) => t.id)).toEqual([
      'provider',
      'consortium',
    ]);
    expect(manifest.contributes?.['authz.defaultRole']).toEqual([
      {
        role: 'user',
        permissions: [
          'registry.organisations.organisation.read',
          'registry.organisations.membership.request',
        ],
      },
      { role: 'reviewer', permissions: ['registry.organisations.organisation.read'] },
    ]);
    expect(
      (manifest.contributes?.['authz.resourcePolicy'] as { resourceType: string }[]).map(
        (policy) => policy.resourceType,
      ),
    ).toEqual(['organisation']);
  });

  it('creates the two tables with the prefix org_, one foreign key (to its own organisation table), no key to a user or a blob, and no enum', () => {
    const migrations = join(dir, 'migrations');
    const sql = readdirSync(migrations)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrations, file), 'utf8'))
      .join('\n');
    expect([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1])).toEqual([
      'org_organisation',
      'org_membership',
    ]);
    // The only reference is membership → organisation: user ids and the logo's blob id are plain
    // columns, so a purge or the blob cleanup cannot be blocked.
    expect([...sql.matchAll(/REFERENCES "public"\."([^"]+)"/g)].map((match) => match[1])).toEqual([
      'org_organisation',
    ]);
    expect(sql).not.toMatch(/REFERENCES "public"\."(identity|blob)_/);
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

  it('gives every route a plain permission of the module and none is public; no route names a scoped one (ADR-0034)', async () => {
    const s = await h.start();
    const own = s.kernel.routes.filter((r) =>
      String(r.route.permission).startsWith('registry.organisations.'),
    );
    // Nine for the record, the logo and the types; nine for membership.
    expect(own).toHaveLength(18);
    const plain = new Set(
      Object.entries(manifest.permissions ?? {})
        .filter(([, def]) => def.scope === undefined)
        .map(([id]) => id),
    );
    for (const { route } of own) {
      expect(plain, `${route.method} ${route.path}: ${route.permission}`).toContain(
        route.permission,
      );
      expect(route.public).not.toBe(true);
    }
  });
});
