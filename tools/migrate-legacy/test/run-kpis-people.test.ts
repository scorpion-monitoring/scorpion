// `migrate-legacy run` for the KPI framework, the measurements and the people (sprint 2) against real Postgres
// (Testcontainers) and the `full` profile. Every state is read through the services; the data is made up. Proves: a dry run
// writes nothing (row counts before and after), a run creates what the report says, a second run creates nothing, a run
// stopped halfway and run again ends in the same state, a refused record does not stop the others, a key value is nowhere,
// an account without Admin is refused at the first write, and a gap in the mapping stops a run that writes.
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKernel, createLogger, loadConfig } from '@scorpion/kernel';
import { moduleIds, profileName, sources } from '@scorpion/server/src/generated/profile.ts';
import {
  makeSecretsKey,
  makeUser,
  startPostgres,
  tableCounts,
  tablesContaining,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, type CliDeps } from '../src/cli.ts';
import { REPOSITORY_ROOT } from '../src/files.ts';
import { loadKpis } from '../src/load-kpis.ts';
import { loadMeasurements } from '../src/load-measurements.ts';
import { buildPlans } from '../src/commands.ts';
import { loadRegistry } from '../src/load.ts';
import { MAPPING_FORMAT } from '../src/mapping.ts';
import { parseSubjects } from '../src/subjects.ts';
import type { Report } from '../src/report.ts';
import { readMapping } from '../src/mapping.ts';
import { spdxIndex } from '../src/rules.ts';
import { readSnapshot } from '../src/snapshot.ts';
import { migrationAccount, openTarget } from '../src/target.ts';
import { service, writeSnapshot } from './snapshot-factory.ts';

const SECRETS_KEY = makeSecretsKey();
process.env.SECRETS_KEY = SECRETS_KEY;
let pg: StartedPostgres;
let work: string;
let snapshotDir: string;
let mappingFile: string;
let subjectsFile: string;
let n = 0;

const PROVIDER = 'ls-login';
const kpi = (name: string, categories: { name: string; necessity: string | null }[] = []) => ({
  name,
  description: `${name} description`,
  categories,
  selected: null,
});
const at = (year: number, month: number, day = 1) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 00:00:00+00:00`;

/** Ten years and one month (121 months) of one KPI, two KPIs the set lacks and one it has, dates that must be dropped. */
function usersHistory() {
  const points = [];
  for (let i = 0; i < 121; i += 1) {
    const total = 2015 * 12 + 10 + i; // 2015-11 … 2025-11
    points.push({
      kpi: 'Users',
      date: at(Math.floor(total / 12), (total % 12) + 1, i % 2 === 0 ? 1 : 15),
      value: i + 1,
    });
  }
  return points;
}

/** Made up, shaped like the maintainer's discovery but with no real name. */
const SNAPSHOT = {
  providers: [
    { abbreviation: 'BioNet', name: 'BioNet Services' },
    { abbreviation: 'PlantData', name: 'PlantData Centre' },
  ],
  categories: ['Tools', 'Data'],
  services: [
    service('GeneFlow', { category: 'Tools', stage: '', license: '' }),
    service('LeafDB', { category: 'Data', provider: 'PlantData', stage: '', license: '' }),
  ],
  indicatorsByCategory: {
    Tools: [
      kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }]),
      kpi('Papers', [{ name: 'Tools', necessity: 'optional' }]),
    ],
    Data: [kpi('Records', [{ name: 'Data', necessity: null }])],
  },
  indicatorsByService: { GeneFlow: [kpi('Citations')] },
  users: [
    {
      user_name: 'alice',
      email: 'alice@example.org',
      is_admin: true,
      providers: ['BioNet', 'PlantData'],
    },
    { user_name: 'Bob.Jones', email: 'bob@example.org', is_admin: false, providers: ['BioNet'] },
    { user_name: 'bob-jones', email: 'bob2@example.org', is_admin: false, providers: [] },
    { user_name: 'carol', email: 'shared@example.org', is_admin: false, providers: [] },
    { user_name: 'dave', email: 'Shared@Example.org', is_admin: false, providers: [] },
    { user_name: 'erin', email: 'erin@example.org', is_admin: false, providers: [] },
    { user_name: 'frank', email: 'not an address', is_admin: false, providers: [] },
    { user_name: 'gina', email: 'gina@example.org', is_admin: false, providers: [] },
    { user_name: 'Hank', email: 'hank@example.org', is_admin: false, providers: [] },
    { user_name: 'ivy', email: 'ivy@example.org', is_admin: false, providers: [] },
  ],
  membershipRequests: [
    { id: 'r1', mail: 'erin@example.org', username: 'erin', provider: 'PlantData' },
  ],
  measurements: {
    GeneFlow: [
      ...usersHistory(),
      // A KPI the service's set does not have (decision 9), a gap between two points (decision 13), and the dropped dates.
      { kpi: 'Orphan', date: at(2024, 1), value: 7 },
      { kpi: 'Papers', date: at(2024, 1), value: 2 },
      { kpi: 'Papers', date: at(2024, 4, 15), value: 5 },
      { kpi: 'Papers', date: at(2024, 4, 3), value: 4 },
      { kpi: 'Papers', date: at(2999, 1), value: 9 },
      { kpi: 'Papers', date: at(1899, 12), value: 9 },
    ],
    LeafDB: [{ kpi: 'Records', date: at(2025, 5), value: 11 }],
  },
};
const SUBJECTS = [
  ['sub-alice', 'alice'],
  ['sub-bob', 'Bob.Jones'],
  ['sub-bob2', 'bob-jones'],
  ['sub-carol', 'carol'],
  ['sub-dave', 'dave'],
  ['sub-erin', 'erin'],
  ['sub-frank', 'frank'],
  // gina has none
  ['sub-hank', 'Hank'],
  ['sub-ivy', 'ivy'],
];
const MAPPING = {
  format: MAPPING_FORMAT,
  oidcProvider: PROVIDER,
  missingStage: 'PROD',
  indicators: {
    Users: { thematic: 'Usage' },
    Papers: { thematic: 'Bibliographic' },
    Records: { thematic: 'Usage' },
    Citations: { thematic: 'Bibliographic' },
    Orphan: { thematic: 'Usage' },
  },
};

beforeAll(async () => {
  pg = await startPostgres();
  work = await mkdtemp(join(tmpdir(), 'migrate-legacy-people-'));
  snapshotDir = join(work, 'snapshot');
  await writeSnapshot(snapshotDir, SNAPSHOT);
  mappingFile = join(work, 'mapping.json');
  await writeFile(mappingFile, JSON.stringify(MAPPING));
  subjectsFile = join(work, 'subjects.tsv');
  await writeFile(subjectsFile, SUBJECTS.map(([s, u]) => `${s}\t${u}`).join('\n'));
}, 120_000);
afterAll(async () => {
  await pg?.stop();
  await rm(work, { recursive: true, force: true });
});

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

async function run(
  env: Record<string, string>,
  flags: string[] = [],
  options: { mapping?: string; subjects?: string } = {},
) {
  const dir = reportDir();
  const c = cli(env);
  const code = await runCli(
    [
      'run',
      snapshotDir,
      '--mapping',
      options.mapping ?? mappingFile,
      '--report',
      dir,
      '--subjects',
      options.subjects ?? subjectsFile,
      ...flags,
    ],
    c.deps,
  );
  return { code, dir, ...c };
}

/** Counts of every table, through a connection to the database (read only). */
async function counts(env: Record<string, string>) {
  const target = await openTarget(env);
  try {
    return await tableCounts(target.kernel.pool);
  } finally {
    await target.stop();
  }
}

/** What the services say, for the checks below. */
async function inspect(env: Record<string, string>) {
  const target = await openTarget(env);
  try {
    const { actor } = await migrationAccount(target, { create: false });
    if (!actor) throw new Error('the migration account is missing (run with --keep-account)');
    const user = (subject: string) =>
      target.identity.users.findByIdentityAsSystem(PROVIDER, subject);
    const users: Record<
      string,
      { username: string; email: string | null; roles: string[]; status: string }
    > = {};
    for (const [subject] of SUBJECTS) {
      if (subject === undefined) continue;
      const found = await user(subject);
      if (found) {
        users[subject] = {
          username: found.username,
          email: found.email,
          roles: (await target.authz.rolesOf(actor, found.id)).sort(),
          status: found.status,
        };
      }
    }
    const sets = (await target.kpi.sets.list(actor, {}, { page: 0, pageSize: 100 })).sets;
    const setRows: Record<string, string[]> = {};
    for (const set of sets) {
      setRows[set.name] = (await target.kpi.sets.get(actor, set.id)).indicators
        .map((r) => `${r.name}:${r.necessity}`)
        .sort();
    }
    const serviceKpis: Record<string, { set: string | null; extras: string[] }> = {};
    for (const slug of ['GeneFlow', 'LeafDB']) {
      const found = await target.services.findBySlugAsSystem(slug);
      if (!found) continue;
      const view = await target.kpi.serviceKpis.get(actor, found.id);
      serviceKpis[slug] = {
        set: view.set?.name ?? null,
        extras: view.extras.map((e) => e.name).sort(),
      };
    }
    const bioNet = await target.organisations.findByAbbreviationAsSystem('provider', 'BioNet');
    const plantData = await target.organisations.findByAbbreviationAsSystem(
      'provider',
      'PlantData',
    );
    const member = async (subject: string, org: typeof bioNet) => {
      const found = await user(subject);
      return found && org ? target.organisations.isApprovedMemberAsSystem(found.id, org.id) : null;
    };
    const erin = await user('sub-erin');
    const erinRows = erin
      ? (
          await target.organisations.listOwn(
            { kind: 'user', userId: erin.id, username: erin.username, roles: [], via: 'session' },
            { page: 0, pageSize: 100 },
          )
        ).items
      : [];
    return {
      users,
      sets: setRows,
      serviceKpis,
      alice: [await member('sub-alice', bioNet), await member('sub-alice', plantData)],
      bob: await member('sub-bob', bioNet),
      erin: erinRows.map((r) => `${r.organisation.abbreviation}:${r.state}`),
    };
  } finally {
    await target.stop();
  }
}

describe('run (KPIs, measurements, people)', () => {
  it('a dry run writes nothing, and reports what a run would do', async () => {
    const env = await migratedDatabase();
    const before = await counts(env);
    const { code, dir, out } = await run(env, ['--dry-run']);
    expect(code).toBe(0);
    expect(await counts(env)).toEqual(before);
    const report = await readReport(dir);
    expect(report.mode).toBe('dry-run');
    expect(report.counts).toMatchObject({
      indicator: { read: 5, created: 5 },
      'kpi-set': { read: 2, created: 2 },
      'service-kpis': { read: 2, created: 2 },
      user: { read: 10, created: 6, dropped: 4 },
      membership: { read: 4, created: 4 },
      // 121 + 1 + 5 + 1 points read; two dropped (2999, 1899); two Papers points in one month (one merged); 2 zeros filled.
      measurement: { read: 128, created: 127, dropped: 2, merged: 1 },
    });
    expect(out.join('\n')).toMatch(/dry run: nothing was written/);
  });

  it('a run creates what the report says, with the identity, the roles, the memberships, the sets and the measurements', async () => {
    const env = await migratedDatabase();
    const empty = await counts(env);
    const first = await run(env, ['--yes', '--keep-account']);
    expect(first.code).toBe(0);
    // The "nothing changed" checks of the other tests compare against a run that does change the counts.
    const written = await counts(env);
    expect(written.identity_user).toBeGreaterThan(empty.identity_user!);
    expect(
      Object.keys(written).filter((table) => written[table] !== empty[table]).length,
    ).toBeGreaterThan(8);
    const state = await inspect(env);
    expect(state.users).toEqual({
      'sub-alice': {
        username: 'alice',
        email: 'alice@example.org',
        roles: ['admin'],
        status: 'active',
      },
      'sub-bob': {
        username: 'bob-jones',
        email: 'bob@example.org',
        roles: ['user'],
        status: 'active',
      },
      'sub-bob2': {
        username: 'bob-jones-2',
        email: 'bob2@example.org',
        roles: ['user'],
        status: 'active',
      },
      'sub-erin': {
        username: 'erin',
        email: 'erin@example.org',
        roles: ['user'],
        status: 'active',
      },
      'sub-hank': {
        username: 'hank',
        email: 'hank@example.org',
        roles: ['user'],
        status: 'active',
      },
      'sub-ivy': { username: 'ivy', email: 'ivy@example.org', roles: ['user'], status: 'active' },
    });
    expect(state.sets).toEqual({
      Tools: ['Papers:optional', 'Users:mandatory'],
      // No necessity in the legacy data: the default of decision 6.
      Data: ['Records:mandatory'],
    });
    expect(state.serviceKpis).toEqual({
      GeneFlow: { set: 'Tools', extras: ['Citations', 'Orphan'] },
      LeafDB: { set: 'Data', extras: [] },
    });
    expect(state.alice).toEqual([true, true]);
    expect(state.bob).toBe(true);
    expect(state.erin).toEqual(['PlantData:requested']);

    const report = await readReport(first.dir);
    const rules = (kind: string, legacy: string) =>
      report.records.find((r) => r.kind === kind && r.legacy === legacy)?.rules.map((r) => r.rule);
    expect(rules('user', 'carol')).toEqual(['user.email-duplicate']);
    expect(rules('user', 'dave')).toEqual(['user.email-duplicate']);
    expect(rules('user', 'frank')).toEqual(['user.email-invalid']);
    expect(rules('user', 'gina')).toEqual(['user.subject-missing']);
    expect(rules('user', 'alice')).toEqual(['user.admin']);
    expect(rules('user', 'bob-jones')).toEqual(['user.username-suffixed']);
    expect(rules('service-kpis', 'GeneFlow')).toEqual(['service-kpis.kpi-added-optional']);
    expect(report.counts.measurement).toMatchObject({
      read: 128,
      created: 127,
      dropped: 2,
      merged: 1,
    });
    const geneFlow = report.records.find(
      (r) => r.kind === 'measurement' && r.legacy === 'GeneFlow',
    )!;
    expect(geneFlow.rules.map((r) => r.rule).sort()).toEqual([
      'measurement.before-1900',
      'measurement.duplicate-in-month',
      'measurement.future-month',
      'measurement.gap-filled',
    ]);
    expect(geneFlow.values).toMatchObject({ inserted: 126, updated: 0, unchanged: 0, filled: 2 });
  });

  it('--skip-users migrates the registry, the KPIs and the measurements without users, roles or memberships', async () => {
    const env = await migratedDatabase();
    // No --subjects and no provider needed: the users part is left out, not reported user by user.
    const dir = reportDir();
    const c = cli(env);
    const code = await runCli(
      [
        'run',
        snapshotDir,
        '--mapping',
        mappingFile,
        '--report',
        dir,
        '--skip-users',
        '--yes',
        '--keep-account',
      ],
      c.deps,
    );
    expect(code).toBe(0);
    const report = await readReport(dir);
    expect(report.counts).toMatchObject({
      indicator: { created: 5 },
      'kpi-set': { created: 2 },
      measurement: { read: 128, created: 127 },
      user: { read: 0, created: 0 },
      membership: { read: 0, created: 0 },
    });
    expect(report.records.filter((r) => r.kind === 'user' || r.kind === 'membership')).toEqual([]);
    expect(report.notes.join(' ')).toMatch(/--skip-users/);
    const state = await inspect(env);
    expect(state.users).toEqual({});
    expect(state.serviceKpis.GeneFlow).toEqual({ set: 'Tools', extras: ['Citations', 'Orphan'] });
    // The users part can be added later by a run without the flag.
    expect((await run(env, ['--yes', '--keep-account'])).code).toBe(0);
    expect(Object.keys((await inspect(env)).users)).toHaveLength(6);
  });

  it('a second run creates nothing: the same table counts and every record kept', async () => {
    const env = await migratedDatabase();
    await run(env, ['--yes', '--keep-account']);
    const before = await counts(env);
    const second = await run(env, ['--yes', '--keep-account']);
    expect(second.code).toBe(0);
    expect(await counts(env)).toEqual(before);
    const report = await readReport(second.dir);
    expect(report.account.state).toBe('found');
    expect(
      report.records.filter((r) => r.outcome === 'created' || r.outcome === 'changed'),
    ).toEqual([]);
    expect(report.counts.measurement).toMatchObject({ created: 0, changed: 0, kept: 127 });
    expect(report.counts.user).toMatchObject({ created: 0, kept: 6 });
    expect(report.counts.membership).toMatchObject({ created: 0, kept: 4 });
  });

  it('a run stopped halfway and run again ends in the same state as one run', async () => {
    const whole = await migratedDatabase();
    await run(whole, ['--yes', '--keep-account']);

    const half = await migratedDatabase();
    const target = await openTarget(half);
    try {
      const { actor } = await migrationAccount(target, { create: true });
      const plans = buildPlans({
        snapshot: await readSnapshot(snapshotDir),
        mapping: await readMapping(mappingFile),
        subjects: parseSubjects(SUBJECTS.map(([s, u]) => `${s}\t${u}`).join('\n')),
        facts: { stageTerms: ['PROD', 'DEV', 'TERM'], spdx: spdxIndex() },
        kpiFacts: {
          valueTypes: ['integer'],
          thematic: ['Usage', 'Bibliographic'],
          units: [],
          necessities: ['mandatory', 'optional'],
          rimoCategories: [],
        },
        providers: [PROVIDER],
        now: new Date(),
      });
      // Stopped after the registry and the KPI sets: no users, no measurements.
      await loadRegistry(plans.registry, target, { dryRun: false, actor });
      await loadKpis(plans.kpis, target, { dryRun: false, actor });
    } finally {
      await target.stop();
    }
    expect((await run(half, ['--yes', '--keep-account'])).code).toBe(0);
    expect(await counts(half)).toEqual(await counts(whole));
    expect(await inspect(half)).toEqual(await inspect(whole));
  });

  it('a dry run over existing services says their sets and extras would change, not "kept"', async () => {
    const env = await migratedDatabase();
    const target = await openTarget(env);
    try {
      const { actor } = await migrationAccount(target, { create: true });
      const plans = buildPlans({
        snapshot: await readSnapshot(snapshotDir),
        mapping: await readMapping(mappingFile),
        subjects: parseSubjects(''),
        facts: { stageTerms: ['PROD'], spdx: spdxIndex() },
        kpiFacts: {
          valueTypes: ['integer'],
          thematic: ['Usage', 'Bibliographic'],
          units: [],
          necessities: ['mandatory', 'optional'],
          rimoCategories: [],
        },
        providers: [PROVIDER],
        now: new Date(),
      });
      await loadRegistry(plans.registry, target, { dryRun: false, actor });
    } finally {
      await target.stop();
    }
    const before = await counts(env);
    const { code, dir } = await run(env, ['--dry-run', '--skip-users', '--keep-account']);
    expect(code).toBe(0);
    expect(await counts(env)).toEqual(before);
    expect((await readReport(dir)).counts['service-kpis']).toMatchObject({
      read: 2,
      changed: 2,
      kept: 0,
    });
  });

  it('cuts ten years and one month into two batches, 120 months and 1', async () => {
    const env = await migratedDatabase();
    const target = await openTarget(env);
    try {
      const { actor } = await migrationAccount(target, { create: true });
      const plans = buildPlans({
        snapshot: await readSnapshot(snapshotDir),
        mapping: await readMapping(mappingFile),
        subjects: parseSubjects(''),
        facts: { stageTerms: ['PROD'], spdx: spdxIndex() },
        kpiFacts: {
          valueTypes: ['integer'],
          thematic: ['Usage', 'Bibliographic'],
          units: [],
          necessities: ['mandatory', 'optional'],
          rimoCategories: [],
        },
        providers: [PROVIDER],
        now: new Date(),
      });
      await loadRegistry(plans.registry, target, { dryRun: false, actor });
      const kpis = await loadKpis(plans.kpis, target, { dryRun: false, actor });
      const sizes: number[] = [];
      const spy = {
        ...target,
        ingestion: {
          measurements: {
            upsertBatch: (
              ...args: Parameters<typeof target.ingestion.measurements.upsertBatch>
            ) => {
              if (!args[3].dryRun) sizes.push(new Set(args[2].map((r) => r.period)).size);
              return target.ingestion.measurements.upsertBatch(...args);
            },
          },
        },
      };
      const slugs = new Map([
        ['GeneFlow', 'GeneFlow'],
        ['LeafDB', 'LeafDB'],
      ]);
      await loadMeasurements(
        plans.measurements,
        slugs,
        kpis.indicatorIds,
        plans.kpis.unavailable,
        spy,
        { dryRun: false, actor },
      );
      // GeneFlow: 121 months (2015-11 … 2025-11) in two batches; LeafDB: one month in one.
      expect(sizes).toEqual([120, 1, 1]);
    } finally {
      await target.stop();
    }
  });

  it('reports a record the services refuse and goes on with the others', async () => {
    const env = await migratedDatabase();
    const target = await openTarget(env);
    try {
      // An account of the target already has ivy's address, and one holds the username "hank".
      await makeUser(target.kernel.pool, { username: 'someone', email: 'ivy@example.org' });
      await makeUser(target.kernel.pool, { username: 'hank' });
    } finally {
      await target.stop();
    }
    const result = await run(env, ['--yes', '--keep-account']);
    expect(result.code).toBe(0);
    const report = await readReport(result.dir);
    const ivy = report.records.find((r) => r.kind === 'user' && r.legacy === 'ivy')!;
    expect(ivy.outcome).toBe('dropped');
    expect(ivy.rules.map((r) => r.rule)).toEqual(['user.email-taken']);
    const hank = report.records.find((r) => r.kind === 'user' && r.legacy === 'Hank')!;
    expect(hank).toMatchObject({ outcome: 'created', target: 'hank-2' });
    expect(hank.rules.map((r) => r.rule)).toContain('user.username-taken');
    const state = await inspect(env);
    expect(Object.keys(state.users).sort()).toEqual([
      'sub-alice',
      'sub-bob',
      'sub-bob2',
      'sub-erin',
      'sub-hank',
    ]);
    expect(report.counts.measurement.created).toBe(127);
  });

  it('never has a key value in the report, the output or the database', async () => {
    const key = 'legacy-key-0123456789-abcdefghijklmnopqrstuvwxyz';
    const env = { ...(await migratedDatabase()), LEGACY_API_KEY: key };
    process.env.LEGACY_API_KEY = key;
    try {
      const result = await run(env, ['--yes', '--keep-account']);
      expect(result.code).toBe(0);
      const text = [
        ...result.out,
        ...result.err,
        await readFile(join(result.dir, 'report.json'), 'utf8'),
        await readFile(join(result.dir, 'report.md'), 'utf8'),
      ].join('\n');
      expect(text).not.toContain(key);
      const target = await openTarget(env);
      try {
        expect(await tablesContaining(target.kernel.pool, key)).toEqual([]);
      } finally {
        await target.stop();
      }
    } finally {
      delete process.env.LEGACY_API_KEY;
    }
  });

  it('refuses a migration account without Admin at the first write, and writes nothing', async () => {
    const env = await migratedDatabase();
    const target = await openTarget(env);
    try {
      await makeUser(target.kernel.pool, { username: 'legacy-migration', status: 'active' });
    } finally {
      await target.stop();
    }
    const before = await counts(env);
    const { code, err } = await run(env, ['--yes']);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/refused the migration account/);
    expect(await counts(env)).toEqual(before);
  });

  it('stops a run that writes while a KPI has no thematic term, and a dry run reports it', async () => {
    const env = await migratedDatabase();
    const file = join(work, `mapping-gap-${n++}.json`);
    await writeFile(
      file,
      JSON.stringify({
        ...MAPPING,
        indicators: { ...MAPPING.indicators, Orphan: { thematic: null } },
      }),
    );
    const before = await counts(env);
    const stopped = await run(env, ['--yes'], { mapping: file });
    expect(stopped.code).toBe(1);
    expect(stopped.err.join('\n')).toMatch(/indicators\["Orphan"\]\.thematic/);
    expect(await counts(env)).toEqual(before);
    const dry = await run(env, ['--dry-run'], { mapping: file });
    expect(dry.code).toBe(0);
    const report = await readReport(dry.dir);
    expect(
      report.records.find((r) => r.kind === 'indicator' && r.legacy === 'Orphan')?.rules[0]?.rule,
    ).toBe('indicator.thematic-open');
  });

  it('deactivates the account at the end of a run, uses the next one on the next run, and says when it cannot', async () => {
    const env = await migratedDatabase();
    const first = await run(env, ['--yes']);
    expect((await readReport(first.dir)).account).toMatchObject({
      username: 'legacy-migration',
      state: 'created',
      after: 'deactivated',
    });
    const target = await openTarget(env);
    try {
      expect((await target.identity.users.findByUsername('legacy-migration'))?.status).toBe(
        'deactivated',
      );
    } finally {
      await target.stop();
    }
    const second = await run(env, ['--yes']);
    const report = await readReport(second.dir);
    expect(report.account).toMatchObject({
      username: 'legacy-migration-2',
      state: 'created',
      after: 'deactivated',
    });
    expect(
      report.records.filter((r) => r.outcome === 'created' || r.outcome === 'changed'),
    ).toEqual([]);

    // No administrator in the snapshot: the last-Admin rule keeps the account active, and the report says so.
    const lone = await migratedDatabase();
    const file = join(work, `mapping-lone-${n++}.json`);
    await writeFile(file, JSON.stringify({ ...MAPPING, users: { alice: { drop: true } } }));
    const loneRun = await run(lone, ['--yes'], { mapping: file });
    expect(loneRun.code).toBe(0);
    const loneReport = await readReport(loneRun.dir);
    expect(loneReport.account.after).toMatch(/^still active: .*last Admin/i);
    expect(loneReport.notes.join(' ')).toMatch(/still active/);
  });

  it('lists the migrated users and addresses for the announcement, never to the output', async () => {
    const env = await migratedDatabase();
    await run(env, ['--yes', '--keep-account']);
    const out = join(work, `users-${n++}.tsv`);
    const c = cli(env);
    const code = await runCli(
      ['users', snapshotDir, '--mapping', mappingFile, '--subjects', subjectsFile, '--out', out],
      c.deps,
    );
    expect(code).toBe(0);
    expect((await readFile(out, 'utf8')).trim().split('\n').sort()).toEqual([
      'alice\talice@example.org',
      'bob-jones\tbob@example.org',
      'bob-jones-2\tbob2@example.org',
      'erin\terin@example.org',
      'hank\thank@example.org',
      'ivy\tivy@example.org',
    ]);
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    expect([...c.out, ...c.err].join('\n')).not.toMatch(/@example\.org/);
    expect(c.out.join('\n')).toMatch(/6 migrated user/);
    // Never over an existing file, never inside the repository.
    const again = cli(env);
    expect(
      await runCli(
        ['users', snapshotDir, '--mapping', mappingFile, '--subjects', subjectsFile, '--out', out],
        again.deps,
      ),
    ).toBe(1);
    const inside = cli(env);
    expect(
      await runCli(
        [
          'users',
          snapshotDir,
          '--mapping',
          mappingFile,
          '--subjects',
          subjectsFile,
          '--out',
          join(REPOSITORY_ROOT, 'users.tsv'),
        ],
        inside.deps,
      ),
    ).toBe(1);
  });
});
