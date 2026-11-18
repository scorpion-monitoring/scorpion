// `migrate-legacy compare` (sprint 3) against real Postgres (Testcontainers) and the `full` profile, after a real run. The data is
// made up. Proves: a clean run compares clean and every expected difference has its reason; a value changed after the run
// with the migration's source, a value of that source the snapshot lacks and a value missing from the target are
// unexplained (exit 1); values a person entered are reported, not failed; records the run did not write are unexplained;
// compare writes nothing; a key value is nowhere.
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKernel, createLogger, loadConfig } from '@scorpion/kernel';
import { moduleIds, profileName, sources } from '@scorpion/server/src/generated/profile.ts';
import {
  makeSecretsKey,
  startPostgres,
  tableCounts,
  tablesContaining,
  type StartedPostgres,
} from '@scorpion/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, type CliDeps } from '../src/cli.ts';
import type { CompareReport } from '../src/compare.ts';
import { REPOSITORY_ROOT } from '../src/files.ts';
import { MAPPING_FORMAT } from '../src/mapping.ts';
import { migrationAccount, openTarget } from '../src/target.ts';
import { service, writeSnapshot, type SnapshotParts } from './snapshot-factory.ts';

const SECRETS_KEY = makeSecretsKey();
process.env.SECRETS_KEY = SECRETS_KEY;
const KEY = 'legacy-key-value-7f3c2a91d4';
let pg: StartedPostgres;
let work: string;
let snapshotDir: string;
let mappingFile: string;
let n = 0;

const at = (year: number, month: number, day = 1) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 00:00:00+00:00`;
const kpi = (name: string, categories: { name: string; necessity: string | null }[] = []) => ({
  name,
  description: `${name} description`,
  categories,
  selected: categories.length > 0,
});

const SNAPSHOT: SnapshotParts = {
  providers: [
    { abbreviation: 'BioNet', name: 'BioNet Services' },
    { abbreviation: 'PlantData', name: 'PlantData Centre' },
  ],
  categories: ['Tools', 'Data'],
  services: [
    service('GeneFlow', { category: 'Tools' }),
    service('LeafDB', { category: 'Data', provider: 'PlantData' }),
    service('OldTool', { category: 'Tools' }),
  ],
  indicatorsByCategory: {
    Tools: [
      kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }]),
      kpi('Papers', [{ name: 'Tools', necessity: 'optional' }]),
    ],
    Data: [kpi('Records', [{ name: 'Data', necessity: 'mandatory' }])],
  },
  indicatorsByService: { GeneFlow: [kpi('Citations')] },
  users: [
    {
      user_name: 'alice',
      email: 'alice@example.org',
      is_admin: true,
      providers: ['BioNet', 'PlantData'],
    },
    { user_name: 'bob', email: 'bob@example.org', is_admin: false, providers: ['BioNet'] },
  ],
  measurements: {
    GeneFlow: [
      { kpi: 'Users', date: at(2024, 1), value: 5 },
      { kpi: 'Users', date: at(2024, 4), value: 8 }, // two months between: filled with 0
      { kpi: 'Papers', date: at(2024, 2, 3), value: 1 },
      { kpi: 'Papers', date: at(2024, 2, 20), value: 2 }, // the same month: the later one wins
      { kpi: 'Papers', date: at(2999, 1), value: 9 }, // a future month
      { kpi: 'Users', date: at(1899, 12), value: 9 }, // before 1900
      { kpi: 'Orphan', date: at(2024, 1), value: 7 }, // not in the set: added as an extra (decision 9)
      { kpi: 'Retired', date: at(2024, 1), value: 4 }, // dropped by the mapping
    ],
    LeafDB: [{ kpi: 'Records', date: at(2025, 5), value: 11 }],
    OldTool: [{ kpi: 'Users', date: at(2024, 1), value: 3 }], // the service is dropped by the mapping
  },
};
const MAPPING = {
  format: MAPPING_FORMAT,
  oidcProvider: 'ls-login',
  services: { OldTool: { drop: true } },
  indicators: {
    Users: { thematic: 'Usage' },
    Papers: { thematic: 'Bibliographic' },
    Records: { thematic: 'Usage' },
    Citations: { thematic: 'Bibliographic' },
    Orphan: { thematic: 'Usage' },
    Retired: { drop: true },
  },
};

beforeAll(async () => {
  pg = await startPostgres();
  work = await mkdtemp(join(tmpdir(), 'migrate-legacy-compare-'));
  snapshotDir = join(work, 'snapshot');
  await writeSnapshot(snapshotDir, SNAPSHOT);
  mappingFile = join(work, 'mapping.json');
  await writeFile(mappingFile, JSON.stringify(MAPPING));
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
  return { DATABASE_URL: url, SECRETS_KEY, PROFILE: profileName, LEGACY_API_KEY: KEY };
}

async function cli(env: Record<string, string>, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = { env, io: { out: (t) => void out.push(t), err: (t) => void err.push(t) } };
  const code = await runCli(argv, deps);
  return { code, out, err };
}

/** A database with the snapshot run into it (the account kept, so the tests can write as it). */
async function migrated(flags: string[] = []) {
  const env = await migratedDatabase();
  const run = await cli(env, [
    'run',
    snapshotDir,
    '--mapping',
    mappingFile,
    '--report',
    join(work, `run-${n++}`),
    '--yes',
    '--keep-account',
    ...flags,
  ]);
  expect(run.code).toBe(0);
  return env;
}

async function compare(env: Record<string, string>, snapshot = snapshotDir) {
  const dir = join(work, `compare-${n++}`);
  const result = await cli(env, ['compare', snapshot, '--mapping', mappingFile, '--report', dir]);
  const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as CompareReport;
  return { ...result, dir, report };
}

/** Writes values as the migration account through `upsertBatch`, with a source. */
async function write(
  env: Record<string, string>,
  slug: string,
  rows: { kpi: string; period: string; value: number }[],
  source: string,
) {
  const target = await openTarget(env);
  try {
    const { actor } = await migrationAccount(target, { create: false });
    const found = (await target.services.findBySlugAsSystem(slug))!;
    const ids = new Map(
      (await target.kpi.effectiveIndicatorsAsSystem(found.id)).map((r) => [r.name, r.indicatorId]),
    );
    await target.ingestion.measurements.upsertBatch(
      actor!,
      found.id,
      rows.map((row) => ({ indicator: ids.get(row.kpi)!, period: row.period, value: row.value })),
      { source },
    );
  } finally {
    await target.stop();
  }
}

const values = (report: CompareReport, cls: string) =>
  report.measurements.services
    .flatMap((s) =>
      s.differences.filter((d) => d.class === cls).map((d) => ({ s: s.legacy, ...d })),
    )
    .map(
      (d) =>
        `${d.s} ${d.kpi} ${d.period}: ${d.reason} (${d.expected ?? '-'} → ${d.found ?? '-'}, ${d.source ?? '-'})`,
    )
    .sort();

describe('compare', () => {
  it('a clean run compares clean: every value found, each expected difference with its reason, nothing written', async () => {
    const env = await migrated();
    const target = await openTarget(env);
    const before = await tableCounts(target.kernel.pool);
    await target.stop();

    const { code, out, err, dir, report } = await compare(env);
    expect(code).toBe(0);
    expect(report.result).toBe('clean');
    expect(report.unexplained).toBe(0);
    expect(report.reported).toBe(0);
    // 10 points: 5 equal to a value, 1 merged, 2 dropped by a rule, 1 of a dropped service, 1 of a dropped KPI; 2 zeros filled.
    expect(report.measurements.totals).toMatchObject({
      points: 10,
      expected: 7,
      matched: 5,
      'filled-zero': 2,
      'merged-in-month': 1,
      'dropped-by-rule': 2,
      'service-not-migrated': 1,
      'indicator-not-migrated': 1,
      missing: 0,
      'different-value': 0,
      extra: 0,
      'changed-after-run': 0,
      'entered-after-run': 0,
    });
    const geneFlow = report.measurements.services.find((s) => s.legacy === 'GeneFlow')!;
    expect(
      geneFlow.differences.map((d) => `${d.reason}:${d.kpi}:${d.rule ?? ''}:${d.count}`).sort(),
    ).toEqual([
      'dropped-by-rule:Papers:measurement.future-month:1',
      'dropped-by-rule:Users:measurement.before-1900:1',
      'filled-zero:Users::2',
      'indicator-not-migrated:Retired::1',
      'merged-in-month:Papers::1',
    ]);
    expect(report.measurements.services.find((s) => s.legacy === 'OldTool')).toMatchObject({
      state: 'not-migrated',
      slug: null,
    });
    expect(
      Object.fromEntries(
        report.records.map((r) => [
          r.kind,
          [r.expected, r.found, r.unchecked, r.differences.length],
        ]),
      ),
    ).toEqual({
      provider: [2, 2, 0, 0],
      consortium: [0, 0, 0, 0],
      service: [2, 2, 0, 0],
      indicator: [5, 5, 0, 0],
      'kpi-set': [2, 2, 0, 0],
      'service-kpis': [2, 2, 0, 0],
      user: [2, 2, 0, 0],
      membership: [3, 3, 0, 0],
    });
    expect(report.claims).toEqual({ open: 2, claimed: 0, expired: 0 });

    // Reads only; the report is private; the output has counts, never a person.
    const after = await openTarget(env);
    expect(await tableCounts(after.kernel.pool)).toEqual(before);
    await after.stop();
    for (const file of ['report.json', 'report.md'])
      expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600);
    expect([...out, ...err].join('\n')).not.toMatch(/alice|bob|example\.org/);
    expect(out.join('\n')).toMatch(/Result: clean/);
  });

  it('a value changed after the run with its source, a value of that source the snapshot lacks, and a value missing from the target are unexplained', async () => {
    const env = await migrated();
    await write(
      env,
      'GeneFlow',
      [
        { kpi: 'Users', period: '2024-01', value: 6 },
        { kpi: 'Users', period: '2023-06', value: 1 },
      ],
      'legacy-migration',
    );
    // A snapshot with one point more than the run wrote: the value is missing from the target.
    const later = join(work, `snapshot-${n++}`);
    await writeSnapshot(later, {
      ...SNAPSHOT,
      measurements: {
        ...SNAPSHOT.measurements,
        LeafDB: [
          ...SNAPSHOT.measurements!.LeafDB!,
          { kpi: 'Records', date: at(2025, 6), value: 12 },
        ],
      },
    });

    const { code, err, report } = await compare(env, later);
    expect(code).toBe(1);
    expect(report.result).toBe('unexplained');
    expect(report.unexplained).toBe(3);
    expect(values(report, 'unexplained')).toEqual([
      'GeneFlow Users 2023-06: extra (- → 1, legacy-migration)',
      'GeneFlow Users 2024-01: different-value (5 → 6, legacy-migration)',
      'LeafDB Records 2025-06: missing (12 → -, -)',
    ]);
    expect(err.join('\n')).toMatch(/3 unexplained difference/);
    const md = await readFile(join(work, `compare-${n - 1}`, 'report.md'), 'utf8');
    expect(md).toMatch(/## Unexplained/);
  });

  it('values a person entered or changed after the run (another source) are reported, not failed', async () => {
    const env = await migrated();
    await write(
      env,
      'GeneFlow',
      [
        { kpi: 'Papers', period: '2024-02', value: 9 },
        { kpi: 'Users', period: '2024-06', value: 4 },
        { kpi: 'Users', period: '2024-02', value: 3 }, // a filled 0 a person corrected
      ],
      'form',
    );
    const { code, report } = await compare(env);
    expect(code).toBe(0);
    expect(report.result).toBe('clean');
    expect(report.reported).toBe(3);
    expect(values(report, 'reported')).toEqual([
      'GeneFlow Papers 2024-02: changed-after-run (2 → 9, form)',
      'GeneFlow Users 2024-02: changed-after-run (0 → 3, form)',
      'GeneFlow Users 2024-06: entered-after-run (- → 4, form)',
    ]);
    expect(report.measurements.totals['filled-zero']).toBe(1);
  });

  it('records the run did not write are unexplained: the users of a run with --skip-users, their memberships unchecked', async () => {
    const env = await migrated(['--skip-users']);
    const { code, report } = await compare(env);
    expect(code).toBe(1);
    const users = report.records.find((r) => r.kind === 'user')!;
    expect(users).toMatchObject({ expected: 2, found: 0 });
    expect(users.differences.map((d) => `${d.class}:${d.legacy}:${d.reason}`)).toEqual([
      'unexplained:alice:missing',
      'unexplained:bob:missing',
    ]);
    expect(report.records.find((r) => r.kind === 'membership')).toMatchObject({
      expected: 3,
      found: 0,
      unchecked: 3,
    });
    expect(report.unexplained).toBe(2);
  });

  it('never has a key value in the report, the output or the database', async () => {
    const env = await migrated();
    const { out, err, dir } = await compare(env);
    for (const file of ['report.json', 'report.md'])
      expect(await readFile(join(dir, file), 'utf8')).not.toContain(KEY);
    expect([...out, ...err].join('\n')).not.toContain(KEY);
    const target = await openTarget(env);
    try {
      expect(await tablesContaining(target.kernel.pool, KEY)).toEqual([]);
    } finally {
      await target.stop();
    }
  });

  it('refuses a report directory inside the repository, before reading the target', async () => {
    const { code, err } = await cli({ LEGACY_API_KEY: KEY }, [
      'compare',
      snapshotDir,
      '--mapping',
      mappingFile,
      '--report',
      join(REPOSITORY_ROOT, 'compare-report'),
    ]);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/inside the repository/);
  });
});
