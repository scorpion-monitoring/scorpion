// `migrate-legacy run` for the registry part against real Postgres (Testcontainers) and the `full` profile: a dry run
// writes nothing, a run creates what the report says, a second run keeps everything, a run stopped halfway and run again
// ends in the same state, a refused record does not stop the others, and an account without Admin is refused at the
// first write with nothing written. Every count is read through the services; the snapshot is made up.
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Forbidden, Invalid } from '@scorpion/contracts';
import { createKernel, createLogger, loadConfig } from '@scorpion/kernel';
import { moduleIds, profileName, sources } from '@scorpion/server/src/generated/profile.ts';
import { makeSecretsKey, startPostgres, type StartedPostgres } from '@scorpion/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, type CliDeps } from '../src/cli.ts';
import { loadRegistry, RunStopped, type RegistryPorts } from '../src/load.ts';
import { MAPPING_FORMAT, readMapping } from '../src/mapping.ts';
import type { Report } from '../src/report.ts';
import { spdxIndex } from '../src/rules.ts';
import { readSnapshot } from '../src/snapshot.ts';
import { migrationAccount, MIGRATION_USERNAME, openTarget } from '../src/target.ts';
import { transformRegistry } from '../src/transform.ts';
import { service, writeSnapshot } from './snapshot-factory.ts';

// core.settings reads the key from the process environment, as in `scorpion start`.
const SECRETS_KEY = makeSecretsKey();
process.env.SECRETS_KEY = SECRETS_KEY;
let pg: StartedPostgres;
let work: string;
let snapshotDir: string;
let mappingFile: string;
let n = 0;

/** Made-up data shaped like the maintainer's discovery: no stage, no licence, a space in an abbreviation, consortia by name. */
const SNAPSHOT = {
  providers: [
    { abbreviation: 'BioNet', name: 'BioNet Services' },
    { abbreviation: 'PlantData', name: 'PlantData Centre' },
    { abbreviation: 'Seed Lab', name: 'Seed Laboratory' },
    { abbreviation: 'Root Works', name: 'Root Works Ltd' },
  ],
  services: [
    service('GeneFlow', { stage: '', license: '', consortia: ['Imaginary Consortium', 'PLX'] }),
    service('LeafDB', {
      provider: 'PlantData',
      stage: 'prod',
      license: 'apache-2.0',
      consortia: ['Green Alliance'],
    }),
    service('Root Atlas', { provider: 'PlantData', stage: '', license: 'MIT' }),
    service('SeedBank', { provider: 'Seed Lab', stage: 'TERM', license: 'Proprietary' }),
    service('Twin', { stage: '' }),
    service('Twin', { provider: 'PlantData', stage: '' }),
    service('Stray', { provider: 'Root Works', stage: '' }),
  ],
};
const MAPPING = {
  format: MAPPING_FORMAT,
  providers: { 'Seed Lab': { abbreviation: 'SeedLab' }, 'Root Works': { abbreviation: null } },
  consortia: {
    'Imaginary Consortium': { abbreviation: 'IMC' },
    'Green Alliance': { abbreviation: null },
  },
  missingStage: 'PROD',
};
const PROVIDERS = ['BioNet', 'PlantData', 'SeedLab', 'Root Works'];
const SLUGS = ['GeneFlow', 'LeafDB', 'Root-Atlas', 'SeedBank', 'Twin', 'Stray'];

beforeAll(async () => {
  pg = await startPostgres();
  work = await mkdtemp(join(tmpdir(), 'migrate-legacy-run-'));
  snapshotDir = join(work, 'snapshot');
  await writeSnapshot(snapshotDir, SNAPSHOT);
  mappingFile = join(work, 'mapping.json');
  await writeFile(mappingFile, JSON.stringify(MAPPING));
}, 120_000);
afterAll(async () => {
  await pg?.stop();
  await rm(work, { recursive: true, force: true });
});

/** A new database with the `full` profile's migrations applied (`scorpion migrate`); the tool never migrates. */
async function migratedDatabase(): Promise<Record<string, string>> {
  const url = await pg.createDatabase();
  const kernel = createKernel({
    profile: { name: profileName, modules: moduleIds },
    sources,
    config: loadConfig({ DATABASE_URL: url, PROFILE: profileName, SECRETS_KEY }),
    log: createLogger({ level: 'silent' }),
  });
  await kernel.migrate();
  await kernel.stop();
  return { DATABASE_URL: url, SECRETS_KEY, PROFILE: profileName };
}

function cli(env: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = { env, io: { out: (t) => void out.push(t), err: (t) => void err.push(t) } };
  return { out, err, deps };
}

const reportDir = () => join(work, `report-${n++}`);
const readReport = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as Report;

async function run(env: Record<string, string>, ...flags: string[]) {
  const dir = reportDir();
  const c = cli(env);
  const code = await runCli(
    ['run', snapshotDir, '--mapping', mappingFile, '--report', dir, ...flags],
    c.deps,
  );
  return { code, dir, ...c };
}

/** The registry as the services read it: organisations by abbreviation, services by slug, the account. */
async function state(env: Record<string, string>) {
  const target = await openTarget(env);
  try {
    const providers: Record<string, string> = {};
    for (const abbreviation of PROVIDERS) {
      const found = await target.organisations.findByAbbreviationAsSystem('provider', abbreviation);
      if (found) providers[found.abbreviation] = found.name;
    }
    const consortia = await target.organisations.listConsortiaAsSystem();
    const consortiumById = new Map(consortia.map((c) => [c.id, c.abbreviation]));
    const providerIds = new Map<string, string>();
    for (const abbreviation of Object.keys(providers)) {
      providerIds.set(
        (await target.organisations.findByAbbreviationAsSystem('provider', abbreviation))!.id,
        abbreviation,
      );
    }
    const services: Record<string, unknown> = {};
    for (const slug of SLUGS) {
      const found = await target.services.findBySlugAsSystem(slug);
      if (!found) continue;
      services[found.slug] = {
        name: found.name,
        stage: found.stage,
        license: found.license,
        public: found.public,
        provider: found.organisations
          .filter((o) => o.role === 'provider')
          .map((o) => providerIds.get(o.id)),
        consortia: found.organisations
          .filter((o) => o.role === 'consortium')
          .map((o) => consortiumById.get(o.id))
          .sort(),
      };
    }
    return {
      providers,
      consortia: consortia.map((c) => [c.abbreviation, c.name]).sort(),
      services,
      serviceCount: (await target.services.listForPickerAsSystem({ limit: 200 })).length,
      account: (await target.identity.users.findByUsername(MIGRATION_USERNAME)) !== undefined,
    };
  } finally {
    await target.stop();
  }
}

const EXPECTED = {
  providers: {
    BioNet: 'BioNet Services',
    PlantData: 'PlantData Centre',
    SeedLab: 'Seed Laboratory',
  },
  consortia: [
    ['IMC', 'Imaginary Consortium'],
    ['PLX', 'PLX'],
  ],
  services: {
    GeneFlow: {
      name: 'GeneFlow',
      stage: 'PROD',
      license: null,
      public: false,
      provider: ['BioNet'],
      consortia: ['IMC', 'PLX'],
    },
    LeafDB: {
      name: 'LeafDB',
      stage: 'PROD',
      license: 'Apache-2.0',
      public: false,
      provider: ['PlantData'],
      consortia: [],
    },
    'Root-Atlas': {
      name: 'Root Atlas',
      stage: 'PROD',
      license: 'MIT',
      public: false,
      provider: ['PlantData'],
      consortia: [],
    },
    SeedBank: {
      name: 'SeedBank',
      stage: 'TERM',
      license: null,
      public: false,
      provider: ['SeedLab'],
      consortia: [],
    },
  },
  serviceCount: 4,
  account: true,
};
const EMPTY = { providers: {}, consortia: [], services: {}, serviceCount: 0, account: false };

describe('run (registry)', () => {
  it('a dry run writes nothing, not even the account, and reports what a run would do', async () => {
    const env = await migratedDatabase();
    const before = await state(env);
    const { code, dir, out } = await run(env, '--dry-run');
    expect(code).toBe(0);
    expect(await state(env)).toEqual(before);
    expect(before).toEqual(EMPTY);
    const report = await readReport(dir);
    expect(report.mode).toBe('dry-run');
    expect(report.account.state).toBe('not created (dry run)');
    expect(report.counts).toEqual({
      provider: { read: 4, created: 3, kept: 0, changed: 0, dropped: 1 },
      consortium: { read: 3, created: 2, kept: 0, changed: 0, dropped: 1 },
      service: { read: 6, created: 4, kept: 0, changed: 0, dropped: 2 },
    });
    expect(out.join('\n')).toMatch(/dry run: nothing was written/);
  });

  it('refuses a run that writes without --yes, and says whether the target is empty', async () => {
    const env = await migratedDatabase();
    const { code, err } = await run(env);
    expect(code).toBe(2);
    expect(err.join('\n')).toMatch(/which is empty.*--yes/);
    expect(await state(env)).toEqual(EMPTY);
  });

  it('a run creates what the report says (private services, decision 8), and a second run keeps everything', async () => {
    const env = await migratedDatabase();
    const first = await run(env, '--yes');
    expect(first.code).toBe(0);
    expect(await state(env)).toEqual(EXPECTED);
    const report = await readReport(first.dir);
    expect(report.account.state).toBe('created');
    const created = report.records
      .filter((r) => r.outcome === 'created')
      .map((r) => `${r.kind}:${r.target}`);
    expect(created.sort()).toEqual([
      'consortium:IMC',
      'consortium:PLX',
      'provider:BioNet',
      'provider:PlantData',
      'provider:SeedLab',
      'service:GeneFlow',
      'service:LeafDB',
      'service:Root-Atlas',
      'service:SeedBank',
    ]);
    const dropped = Object.fromEntries(
      report.records
        .filter((r) => r.outcome === 'dropped')
        .map((r) => [r.legacy, r.rules.map((x) => x.rule)]),
    );
    expect(dropped).toEqual({
      'Root Works': ['provider.abbreviation-open'],
      'Green Alliance': ['consortium.abbreviation-open'],
      Twin: ['service.two-providers'],
      Stray: ['service.provider-dropped'],
    });
    const md = await readFile(join(first.dir, 'report.md'), 'utf8');
    expect(md).toMatch(
      /^- service `Root Atlas` → `Root-Atlas`: .*service\.slug-derived: "Root Atlas" is not a valid slug → "Root-Atlas"/m,
    );
    expect(md).toContain('service.stage.missing-mapped');
    for (const file of ['report.json', 'report.md']) {
      expect((await stat(join(first.dir, file))).mode & 0o777).toBe(0o600);
    }

    const second = await run(env, '--yes');
    expect(second.code).toBe(0);
    expect(second.err.join('\n')).toMatch(/not empty/);
    const again = await readReport(second.dir);
    expect(again.account.state).toBe('found');
    expect(
      again.records.filter((r) => r.outcome !== 'dropped').every((r) => r.outcome === 'kept'),
    ).toBe(true);
    expect(again.counts.service).toMatchObject({ created: 0, changed: 0, kept: 4 });
    expect(await state(env)).toEqual(EXPECTED);
  });

  it('a run stopped halfway and run again ends in the same state as one run', async () => {
    const env = await migratedDatabase();
    const target = await openTarget(env);
    try {
      const { actor } = await migrationAccount(target, { create: true });
      const terms = (await target.settings.listTerms('stage')).map((t) => t.key);
      const plan = transformRegistry(
        await readSnapshot(snapshotDir),
        await readMapping(mappingFile),
        {
          stageTerms: terms,
          spdx: spdxIndex(),
        },
      );
      let writes = 0;
      const stopAfterThree = <T extends (...args: never[]) => Promise<unknown>>(fn: T) =>
        (async (...args: Parameters<T>) => {
          if (++writes > 3) throw new Forbidden('The connection to the operator was lost.');
          return fn(...args);
        }) as unknown as T;
      const ports: RegistryPorts = {
        organisations: {
          ...target.organisations,
          create: stopAfterThree(target.organisations.create),
        },
        services: target.services,
      };
      await expect(loadRegistry(plan, ports, { dryRun: false, actor })).rejects.toBeInstanceOf(
        RunStopped,
      );
    } finally {
      await target.stop();
    }
    const halfway = await state(env);
    expect(Object.keys(halfway.providers)).toHaveLength(3);
    expect(halfway.serviceCount).toBe(0);

    expect((await run(env, '--yes')).code).toBe(0);
    expect(await state(env)).toEqual(EXPECTED);
  });

  it('a record the services refuse is reported, and the others are migrated', async () => {
    const env = await migratedDatabase();
    // The target holds a provider with the name of a legacy one under another abbreviation: names are unique.
    const target = await openTarget(env);
    try {
      const { actor } = await migrationAccount(target, { create: true });
      await target.organisations.create(actor!, {
        type: 'provider',
        abbreviation: 'PD',
        name: 'PlantData Centre',
      });
      const terms = (await target.settings.listTerms('stage')).map((t) => t.key);
      const plan = transformRegistry(
        await readSnapshot(snapshotDir),
        await readMapping(mappingFile),
        {
          stageTerms: terms,
          spdx: spdxIndex(),
        },
      );
      // And one service the services refuse on create.
      const ports: RegistryPorts = {
        organisations: target.organisations,
        services: {
          ...target.services,
          create: async (who, input) => {
            if ((input as { slug: string }).slug === 'SeedBank')
              throw new Invalid('The request is not valid.', [
                { path: 'stage', message: 'is not allowed' },
              ]);
            return target.services.create(who, input);
          },
        },
      };
      const { results, findings } = await loadRegistry(plan, ports, { dryRun: false, actor });
      const outcome = Object.fromEntries(results.map((r) => [`${r.kind}:${r.legacy}`, r.outcome]));
      expect(outcome).toMatchObject({
        'provider:PlantData': 'dropped',
        'provider:BioNet': 'created',
        'service:LeafDB': 'dropped',
        'service:Root Atlas': 'dropped',
        'service:SeedBank': 'dropped',
        'service:GeneFlow': 'created',
      });
      expect(findings.map((f) => `${f.legacy}:${f.rule}`).sort()).toEqual([
        'LeafDB:service.provider-refused',
        'PlantData:provider.refused',
        'Root Atlas:service.provider-refused',
        'SeedBank:service.refused',
      ]);
      expect(findings.find((f) => f.legacy === 'SeedBank')!.detail).toBe(
        'The request is not valid. (stage: is not allowed)',
      );
      expect(findings.find((f) => f.legacy === 'PlantData')!.detail).toMatch(/name/i);
    } finally {
      await target.stop();
    }
    expect(Object.keys((await state(env)).services)).toEqual(['GeneFlow']);
  });

  it('[denied] the migration account without Admin is refused at the first write, and nothing is written', async () => {
    const env = await migratedDatabase();
    const target = await openTarget(env);
    try {
      await target.identity.users.createUser({
        username: MIGRATION_USERNAME,
        status: 'active',
        auth: { provider: 'local', password: 'a long password nobody uses 7' },
      });
    } finally {
      await target.stop();
    }
    const before = await state(env);
    const { code, err, dir } = await run(env, '--yes');
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/refused the migration account at provider "BioNet"/);
    const after = await state(env);
    expect(after).toEqual(before);
    expect(after).toEqual({ ...EMPTY, account: true });
    const report = await readReport(dir);
    expect(report.stopped).toMatch(/Nothing after it was written/);
    expect(report.records.filter((r) => r.outcome === 'created')).toEqual([]);
  });

  it('refuses a database whose migrations are pending, and never migrates it', async () => {
    const url = await pg.createDatabase();
    const { code, err } = await run(
      { DATABASE_URL: url, SECRETS_KEY, PROFILE: profileName },
      '--dry-run',
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/Migrations are pending/);
  });

  it('plan writes a first mapping with every gap marked', async () => {
    const env = await migratedDatabase();
    const out = join(work, 'first-mapping.json');
    const c = cli(env);
    expect(await runCli(['plan', snapshotDir, '--out', out], c.deps)).toBe(0);
    const mapping = await readMapping(out);
    expect(mapping.providers).toEqual({
      'Root Works': { abbreviation: null },
      'Seed Lab': { abbreviation: null },
    });
    expect(mapping.consortia).toEqual({
      'Green Alliance': { abbreviation: null },
      'Imaginary Consortium': { abbreviation: null },
    });
    expect(mapping.missingStage).toBeNull();
    expect(mapping.licences).toEqual({ Proprietary: null });
    expect(mapping.open).toContain(
      'missingStage: the legacy data has no stage, and the mapping gives no missingStage',
    );
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    expect(await runCli(['plan', snapshotDir, '--out', out], cli(env).deps)).toBe(1);
  });
});
