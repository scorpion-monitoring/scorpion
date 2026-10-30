// `scorpion docs:export` (ADR-0047): the files it writes fit their schemas, two exports are the same bytes, what it says of the
// modules is what their manifests say, the two shapes the knowledge base reads are the ones it reads, and nothing from the environment gets in.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadWorkspaceModules } from './docs-export/collect.ts';
import { exportFiles, docsExportCommand } from './docs-export/run.ts';
import { checkFile, EXPORT_SCHEMA_VERSION } from './docs-export/schema.ts';
import { unzip, zip } from './docs-export/zip.ts';
import { buildExport } from './docs-export/build.ts';
import { describe, expect, it, vi } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const noRelease = () => null;
const exported = await exportFiles({ root, firstRelease: noRelease });
const json = (path: string): unknown => JSON.parse(exported.get(path)!.toString('utf8'));
const rows = (path: string) => json(path) as Record<string, unknown>[];

describe('the files of the export', () => {
  it('are the ones the schema names, and each fits its schema', () => {
    const paths = [...exported.keys()];
    for (const path of [
      'docs-export.json',
      'modules.json',
      'permissions.json',
      'settings.json',
      'settings-schemas.json',
      'events.json',
      'registries.json',
      'jobs.json',
      'env.json',
      'env.schema.json',
      'cli.json',
      'profiles.json',
      'journeys.json',
      'journey-steps.json',
      'screenshots.json',
      'openapi.json',
      'openapi/full.json',
      'openapi/registry.json',
      'openapi/core-only.json',
    ]) {
      expect(paths, path).toContain(path);
    }
    for (const [path, bytes] of exported) {
      if (path.endsWith('.json'))
        expect(checkFile(path, JSON.parse(bytes.toString('utf8'))), path).toEqual([]);
    }
  });

  it('start with the schema version, the Scorpion version and the profiles, and list every other file', () => {
    const info = json('docs-export.json') as Record<string, unknown>;
    expect(info).toMatchObject({
      schemaVersion: EXPORT_SCHEMA_VERSION,
      profiles: ['core-only', 'full', 'registry'],
    });
    expect(info.scorpionVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.files).toEqual(
      [...exported.keys()].filter((path) => path !== 'docs-export.json').sort(),
    );
  });

  it('are the same bytes when the export is made twice', async () => {
    const again = await exportFiles({ root, firstRelease: noRelease });
    expect([...again.keys()]).toEqual([...exported.keys()]);
    for (const [path, bytes] of exported) expect(again.get(path)!.equals(bytes), path).toBe(true);
  });

  it('have their keys in sorted order at every depth, and their rows in the order of their key', () => {
    const sorted = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.every(sorted);
      if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        return (
          keys.every((key, index) => index === 0 || keys[index - 1]! < key) &&
          Object.values(value).every(sorted)
        );
      }
      return true;
    };
    for (const [path, bytes] of exported) {
      if (path.endsWith('.json'))
        expect(sorted(JSON.parse(bytes.toString('utf8'))), path).toBe(true);
    }
    for (const file of ['modules.json', 'permissions.json']) {
      const ids = rows(file).map((row) => row.id as string);
      expect(ids, file).toEqual([...ids].sort());
    }
  });
});

describe('the modules', () => {
  it('have the permissions their manifest declares: each one, and no other', async () => {
    const manifests = await loadWorkspaceModules(root);
    const declared = manifests.flatMap(({ id, manifest }) =>
      Object.entries(manifest.permissions ?? {}).map(
        ([permission, def]) => `${id}|${permission}|${def.scope ?? ''}|${def.description}`,
      ),
    );
    const listed = (
      json('permissions.json') as {
        module: string;
        id: string;
        scope: string | null;
        description: string;
      }[]
    ).map((row) => `${row.module}|${row.id}|${row.scope ?? ''}|${row.description}`);
    expect(listed.sort()).toEqual(declared.sort());
    expect(listed.length).toBeGreaterThan(50);
  });

  it('name every module of the workspace with its kind, dependencies and profiles', () => {
    const modules = rows('modules.json');
    expect(modules.map((module) => module.id)).toContain('kpi.ingestion');
    const ingestion = modules.find((module) => module.id === 'kpi.ingestion')!;
    expect(ingestion).toMatchObject({
      kind: 'optional',
      displayName: 'KPI data submission',
      profiles: ['full'],
    });
    expect(ingestion.dependencies).toEqual(
      expect.arrayContaining(['kpi.framework', 'registry.services']),
    );
    expect(modules.find((module) => module.id === 'core.authz')).toMatchObject({
      kind: 'core',
      profiles: ['core-only', 'full', 'registry'],
    });
  });

  it('give the settings of a module with their schema and default, and the events, registries and jobs', () => {
    const setting = rows('settings.json').find(
      (row) => row.module === 'core.settings' && row.key === 'rateLimits',
    );
    expect(setting).toBeDefined();
    expect(rows('events.json').find((row) => row.name === 'authz.role.assigned@1')).toMatchObject({
      module: 'core.authz',
    });
    expect(rows('registries.json').find((row) => row.name === 'ui.nav')).toMatchObject({
      owner: 'core.ui-shell',
    });
    expect(rows('jobs.json').find((row) => row.name === 'core.identity.cleanup')).toMatchObject({
      schedule: '0 * * * *',
    });
  });

  it('put the planned profiles of the architecture beside the defined ones', () => {
    const profiles = rows('profiles.json');
    expect(profiles.map((profile) => [profile.name, profile.status])).toEqual([
      ['core-only', 'defined'],
      ['full', 'defined'],
      ['kpi-tracker', 'planned'],
      ['nfdi-onboarding', 'planned'],
      ['registry', 'defined'],
    ]);
    const planned = profiles.find((profile) => profile.name === 'nfdi-onboarding')!.modules as {
      id: string;
      inclusion: string;
    }[];
    expect(planned).toContainEqual({ id: 'onboarding', inclusion: 'included' });
    expect(planned).toContainEqual({ id: 'kpi.framework', inclusion: 'optional' });
  });
});

describe('what the knowledge base reads', () => {
  it('has permissions.json as rows with an id, and journey-steps.json as an object from jNN to the step titles', () => {
    expect(Array.isArray(json('permissions.json'))).toBe(true);
    for (const row of rows('permissions.json')) expect(typeof row.id).toBe('string');
    const steps = json('journey-steps.json') as Record<string, string[]>;
    expect(Object.keys(steps)).toEqual([
      'j01',
      'j02',
      'j03',
      'j04',
      'j05',
      'j06',
      'j07',
      'j08',
      'j09',
      'j10',
      'j12',
    ]);
    for (const list of Object.values(steps)) {
      expect(list.length).toBeGreaterThan(0);
      for (const title of list) expect(title).toMatch(/^[A-Z].*[^.]$/);
    }
    expect(steps.j06![0]).toBe('Open the wizard from the catalogue');
  });

  it('fails the export for a journey spec that has no step', () => {
    const base = {
      scorpionVersion: '0.0.0',
      modules: [],
      profiles: [],
      planned: [],
      screenshots: [],
      firstRelease: noRelease,
    };
    const journey = {
      id: 'j99',
      slug: 'x',
      title: 'X',
      file: 'j99-x.spec.ts',
      steps: [] as string[],
      problems: ['has no test.step'],
    };
    expect(() => buildExport({ ...base, journeys: [journey] })).toThrow(
      /j99-x\.spec\.ts: has no test\.step/,
    );
  });
});

describe('the environment and the command line', () => {
  it('list the variables with a type and a description, mark the secrets and carry no default for them', () => {
    const env = rows('env.json');
    expect(env.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'PORT',
        'PROFILE',
        'SECRETS_KEY',
        'SECRETS_KEY_NEXT',
      ]),
    );
    for (const row of env) {
      expect(String(row.description).length, String(row.name)).toBeGreaterThan(10);
      if (row.secret === true) expect(row.default).toBeNull();
    }
    expect(env.find((row) => row.name === 'PORT')).toMatchObject({
      default: 3000,
      required: false,
      secret: false,
    });
    expect(env.find((row) => row.name === 'DATABASE_URL')).toMatchObject({
      required: true,
      secret: true,
    });
    expect(env.find((row) => row.name === 'SECRETS_KEY')).toMatchObject({
      module: 'core.settings',
      required: true,
      secret: true,
    });
  });

  it('never carry a value of the environment', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:hunter2-sentinel@db.invalid/scorpion');
    vi.stubEnv('SECRETS_KEY', 'c2VudGluZWwtc2VjcmV0LWtleS1zZW50aW5lbC0zMg==');
    try {
      const files = await exportFiles({ root, firstRelease: noRelease });
      for (const [path, bytes] of files) {
        const text = bytes.toString('utf8');
        expect(text, path).not.toContain('hunter2-sentinel');
        expect(text, path).not.toContain('c2VudGluZWwtc2VjcmV0');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('give every command, with its flags, the server ones and the ones modules contribute', () => {
    const cli = rows('cli.json') as {
      name: string;
      module: string;
      flags: { name: string; value: string | null; required: boolean }[];
    }[];
    expect(cli.map((command) => command.name)).toEqual(
      expect.arrayContaining([
        'start',
        'worker',
        'migrate',
        'seed',
        'docs:export',
        'profile:generate',
        'create-admin',
        'set-secret',
        'rotate-secrets',
      ]),
    );
    expect(cli.find((command) => command.name === 'seed')!.flags).toEqual([
      { name: '--demo', value: null, required: true },
      { name: '--profile', value: 'name', required: false },
      { name: '--allow-production', value: null, required: false },
    ]);
    expect(cli.find((command) => command.name === 'create-admin')).toMatchObject({
      module: 'core.identity',
    });
    expect(
      cli.find((command) => command.name === 'create-admin')!.flags.map((flag) => flag.name),
    ).toEqual(['--username', '--email']);
  });
});

describe('the zip file', () => {
  it('holds the files as they are, in the order given, and is the same bytes every time', () => {
    const entries = [...exported].map(([path, data]) => ({ path, data }));
    const bytes = zip(entries);
    expect(zip(entries).equals(bytes)).toBe(true);
    const back = unzip(bytes);
    expect(back.map((entry) => entry.path)).toEqual(entries.map((entry) => entry.path));
    for (const [index, entry] of back.entries())
      expect(entry.data.equals(entries[index]!.data), entry.path).toBe(true);
  });

  it.each([['/etc/passwd'], ['a/../b'], ['a//b'], ['']])('refuses the path %j', (path) => {
    expect(() => zip([{ path, data: Buffer.from('x') }])).toThrow(/safe relative path/);
  });
});

describe('docsExportCommand', () => {
  const quiet = () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return vi.spyOn(console, 'error').mockImplementation(() => {});
  };

  it('writes the folder and the zip, and replaces an earlier export but nothing else', async () => {
    quiet();
    const dir = mkdtempSync(join(tmpdir(), 'docs-export-'));
    expect(
      await docsExportCommand(['--out', join(dir, 'out'), '--zip', join(dir, 'x.zip')], root),
    ).toBe(0);
    expect(
      (
        JSON.parse(readFileSync(join(dir, 'out/docs-export.json'), 'utf8')) as {
          schemaVersion: number;
        }
      ).schemaVersion,
    ).toBe(EXPORT_SCHEMA_VERSION);
    expect(
      unzip(readFileSync(join(dir, 'x.zip'))).some((entry) => entry.path === 'permissions.json'),
    ).toBe(true);
    // A second run replaces the first.
    expect(await docsExportCommand(['--out', join(dir, 'out')], root)).toBe(0);
    // A folder that is not an export is left alone.
    mkdirSync(join(dir, 'mine'));
    writeFileSync(join(dir, 'mine/notes.txt'), 'keep');
    const error = quiet();
    expect(await docsExportCommand(['--out', join(dir, 'mine')], root)).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('is not a docs export'));
    expect(readFileSync(join(dir, 'mine/notes.txt'), 'utf8')).toBe('keep');
  });

  it('refuses a folder that is no checkout, an unknown flag and a missing screenshots folder', async () => {
    const error = quiet();
    expect(await docsExportCommand([], mkdtempSync(join(tmpdir(), 'no-checkout-')))).toBe(1);
    expect(await docsExportCommand(['--nope'], root)).toBe(2);
    expect(await docsExportCommand(['--screenshots', '/no/such/folder'], root)).toBe(1);
    expect(error).toHaveBeenCalled();
  });
});
