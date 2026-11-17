// `migrate-legacy discover` over a snapshot fetched from the stub: the findings, and no person named in the output.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, type CliDeps } from '../src/cli.ts';
import { discover, missingMonths, seriesIn } from '../src/discover.ts';
import { parseLegacyDate } from '../src/dates.ts';
import { readSnapshot } from '../src/snapshot.ts';
import { pythonTime, startLegacyStub, type StubServer } from './legacy-stub.ts';

let stub: StubServer;
let work: string;
let snapshotDir: string;
let backupDir: string;
const now = () => new Date('2026-11-17T10:00:00Z');

function cli(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    env,
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    sleep: () => Promise.resolve(),
    now,
  };
  return { out, err, deps };
}

beforeAll(async () => {
  stub = await startLegacyStub();
  work = await mkdtemp(join(tmpdir(), 'migrate-legacy-discover-'));
  snapshotDir = join(work, 'snapshot');
  const { deps } = cli({ LEGACY_API_KEY: 'stub-admin-key-6f1c9a2e' });
  expect(await runCli(['fetch', '--from', stub.url, '--out', snapshotDir], deps)).toBe(0);
  // The S3 backups of the same data: they hold the value 0 the API leaves out, and one value differs.
  backupDir = join(work, 'backups');
  await mkdir(backupDir);
  for (const service of ['GeneFlow', 'LeafDB']) {
    const points = stub.data.series
      .filter((s) => s.service === service)
      .flatMap((s) =>
        s.points.flatMap((p) =>
          Object.entries(p.fields).map(([kpi, value]) => ({
            kpi,
            date: pythonTime(p.time),
            value,
          })),
        ),
      )
      .map((p) =>
        p.kpi === 'downloads' && p.date.startsWith('2020-02') ? { ...p, value: 999 } : p,
      );
    await writeFile(join(backupDir, `${service}.json`), JSON.stringify(points.reverse()));
  }
});
afterAll(async () => {
  await stub?.stop();
  await rm(work, { recursive: true, force: true });
});

describe('discover', () => {
  it('finds what the new rules refuse in the stub snapshot', async () => {
    const d = discover(await readSnapshot(snapshotDir, { measurements: backupDir }), now());
    expect(d.counts).toMatchObject({ providers: 3, services: 4, consortia: 2, users: 2 });
    expect(d.stages).toEqual([
      { spelling: 'DEV', services: 1 },
      { spelling: 'PROD', services: 1 },
      { spelling: 'TERM', services: 1 },
      { spelling: 'prod', services: 1 },
    ]);
    expect(d.licences).toContainEqual({ spelling: 'apache-2.0', services: 1, spdx: 'other case' });
    expect(d.licences).toContainEqual({ spelling: 'Proprietary', services: 1, spdx: 'no' });
    expect(d.providers.invalidAbbreviations.map((p) => p.abbreviation)).toEqual(['Seed Lab']);
    expect(d.services.invalidSlugs).toEqual([
      { abbreviation: 'Root Atlas', derived: 'Root-Atlas' },
    ]);
    expect(d.services.twoProviders).toEqual([
      { abbreviation: 'Root Atlas', providers: ['BioNet', 'PlantData'] },
    ]);
    expect(d.consortia).toEqual({ byAbbreviation: ['IMC'], byName: ['Imaginary Consortium'] });
    expect(d.measurements).toMatchObject({
      notFirstOfMonth: 1,
      servicesNotFirstOfMonth: 1,
      monthsWithSeveralPoints: 1,
      // GeneFlow users 2019-11 → 2022-01 (24 missing), jobs 2019-11 → 2022-01 (25, the 0 of 2021-12 among them),
      // LeafDB users 2020-01 → 2023-05 (36); downloads has none.
      gapMonths: 85,
      kpiHistoriesWithGaps: 3,
      servicesWithSeveralSeries: [{ abbreviation: 'LeafDB', series: 2 }],
      unknownKpis: [],
    });
    expect(d.users).toMatchObject({
      administrators: 1,
      'usernames that break the rule (after lower-casing)': 1,
      'pending membership requests': 1,
    });
    expect(d.backups).toEqual({
      services: { both: 2, onlyApi: 0, onlyBackup: 0 },
      points: { same: 12, otherValue: 1, onlyApi: 0, onlyBackup: 1, zeroInBackupOnly: 1 },
    });
  });

  it('names no person: no username, no address, no source URL', async () => {
    const { out, deps } = cli();
    expect(await runCli(['discover', snapshotDir, '--measurements', backupDir], deps)).toBe(0);
    const { out: json, deps: jsonDeps } = cli();
    expect(await runCli(['discover', snapshotDir, '--json'], jsonDeps)).toBe(0);
    const text = [...out, ...json].join('\n');
    for (const user of stub.data.users) {
      expect(text).not.toContain(user.user_name);
      expect(text).not.toContain(user.email);
    }
    expect(text).not.toContain(stub.url);
    expect(text).toContain('# Discovery of a legacy snapshot');
  });

  it.each([
    [[], 0],
    [['2023-01'], 0],
    [['2023-01', '2023-02', '2023-03'], 0],
    [['2023-01', '2023-03'], 1],
    [['2022-11', '2023-02'], 2],
    [['2023-05', '2020-01'], 39],
  ])('missingMonths(%j) is %d', (months, missing) => {
    expect(missingMonths(new Set(months))).toBe(missing);
  });

  it('counts series by the API order: time steps back once per InfluxDB table', () => {
    const at = (date: string) => ({ kpi: 'users', value: 1, date, parsed: parseLegacyDate(date) });
    expect(seriesIn([])).toBe(0);
    expect(seriesIn([at('2020-01-01'), at('2020-02-01')])).toBe(1);
    expect(seriesIn([at('2020-01-01'), at('2020-02-01'), at('2019-01-01'), at('2019-05-01')])).toBe(
      2,
    );
  });
});
