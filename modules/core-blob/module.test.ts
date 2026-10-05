// The module as the kernel sees it: permissions and who holds them, the prefix of its tables, its
// dependencies, and the routes it registers.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
import { useBlob } from './test/harness.ts';

const harness = useBlob();

describe('the manifest', () => {
  it('declares two permissions, prefixed with the module id', () => {
    expect(Object.keys(manifest.permissions ?? {}).sort()).toEqual([
      'core.blob.manage',
      'core.blob.upload',
    ]);
  });

  it('uses the prefix blob_ for every table, in the schema and in the migrations', async () => {
    const tables = Object.values(await manifest.schema!()).filter(
      (value) => typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
    );
    expect(tables.length).toBe(2);
    const dir = fileURLToPath(new URL('./migrations', import.meta.url));
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('\n');
    const created = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual(['blob_blob', 'blob_reference']);
  });

  it('depends on core.authz and core.settings, and on the sanitiser, and on no other module', () => {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(
      Object.keys(pkg.dependencies)
        .filter((name) => name.startsWith('@scorpion/'))
        .sort(),
    ).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/core-settings',
      '@scorpion/kernel',
      '@scorpion/sanitize',
    ]);
  });

  it('has no table with a foreign key into another module', () => {
    const dir = fileURLToPath(new URL('./migrations', import.meta.url));
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('\n');
    const targets = [...sql.matchAll(/REFERENCES "public"\."([^"]+)"/g)].map((match) => match[1]);
    expect(targets.every((table) => table!.startsWith('blob_'))).toBe(true);
  });
});

describe('who holds the permissions', () => {
  it('Admin holds both, User may upload through other modules, Reviewer holds neither on its own', async () => {
    const started = await harness.start();
    const admin = await started.actorOf('admin');
    const authz = started.kernel.services.get('core.authz') as {
      listRoles(actor: unknown): Promise<{ key: string; permissions: string[] }[]>;
    };
    const held = async (key: string) =>
      (await authz.listRoles(admin))
        .find((role) => role.key === key)!
        .permissions.filter((p) => p.startsWith('core.blob.'));
    expect(await held('admin')).toEqual(['core.blob.manage', 'core.blob.upload']);
    expect(await held('user')).toEqual(['core.blob.upload']);
    expect(await held('reviewer')).toEqual([]);
  });
});

describe('the routes', () => {
  it("registers a public file route and an administrator's upload route, nothing else", async () => {
    const { kernel } = await harness.start();
    const routes = kernel.routes
      .filter((entry) => entry.module === 'core.blob')
      .map(
        (entry) =>
          `${entry.route.method.toUpperCase()} ${entry.route.path} ${entry.route.public ? 'public' : entry.route.permission}`,
      )
      .sort();
    expect(routes).toEqual(['GET /files/{hash} public', 'POST /files core.blob.manage']);
  });
});
