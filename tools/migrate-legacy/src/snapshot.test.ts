// The snapshot reader: the manifest check (a changed, missing or added file is refused), the shapes, and the reader of
// the S3 backups (the same shape as the fetched measurement files).
import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeSnapshot } from '../test/snapshot-factory.ts';
import { readBackups, readSnapshot, serviceOfFile, SnapshotError } from './snapshot.ts';

let work: string;
let n = 0;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'migrate-legacy-snapshot-'));
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});
const fresh = () => join(work, `s${n++}`);

const points = [
  { kpi: 'users', date: '2023-01-01 00:00:00+00:00', value: 3 },
  { kpi: 'users', date: '2023-02-15 00:00:00+00:00', value: 4 },
  { kpi: 'users', date: 'soon', value: 5 },
];

describe('readSnapshot', () => {
  it('reads every file into plain records and parses the dates', async () => {
    const dir = fresh();
    await writeSnapshot(dir, { measurements: { 'Root Atlas': points } });
    const snapshot = await readSnapshot(dir);
    expect(snapshot.providers).toEqual([{ abbreviation: 'BioNet', name: 'BioNet Services' }]);
    const list = snapshot.measurements.get('Root Atlas')!;
    expect(list.map((p) => [p.parsed?.month, p.parsed?.firstOfMonth])).toEqual([
      ['2023-01', true],
      ['2023-02', false],
      [undefined, undefined],
    ]);
    expect(snapshot.backups).toBeUndefined();
  });

  it.each([
    [
      'a changed file',
      (dir: string) => appendFile(join(dir, 'services.json'), ' '),
      /was changed after the fetch/,
    ],
    [
      'a missing file',
      (dir: string) => unlink(join(dir, 'users.json')),
      /listed in the manifest but missing/,
    ],
    [
      'an added file',
      (dir: string) => writeFile(join(dir, 'measurements', 'Extra.json'), '[]'),
      /does not list: measurements\/Extra\.json/,
    ],
    ['no manifest', (dir: string) => unlink(join(dir, 'manifest.json')), /no manifest\.json/],
  ])('refuses %s', async (_name, change, message) => {
    const dir = fresh();
    await writeSnapshot(dir, { measurements: { GeneFlow: points } });
    await change(dir);
    await expect(readSnapshot(dir)).rejects.toThrow(message);
    await expect(readSnapshot(dir)).rejects.toBeInstanceOf(SnapshotError);
  });

  it('refuses a file of the wrong shape, naming the file and the place', async () => {
    const dir = fresh();
    await writeSnapshot(dir, {
      measurements: { GeneFlow: [{ kpi: 'users', date: '2023-01-01', value: 1.5 }] },
    });
    await expect(readSnapshot(dir)).rejects.toThrow(/measurements\/GeneFlow\.json .*0\.value/);
  });
});

describe('the S3 backups', () => {
  it('reads one array per service from <service>.json, in the same shape, through the same reader', async () => {
    const dir = fresh();
    const backups = join(dir, 'backups');
    await mkdir(backups, { recursive: true });
    await writeFile(join(backups, 'GeneFlow.json'), JSON.stringify(points));
    await writeFile(join(backups, 'Root%20Atlas.json'), JSON.stringify(points.slice(0, 1)));
    await writeFile(join(backups, 'notes.txt'), 'ignored');
    const read = await readBackups(backups);
    expect([...read.keys()]).toEqual(['GeneFlow', 'Root Atlas']);
    expect(read.get('GeneFlow')!.map((p) => p.parsed?.day)).toEqual([1, 15, undefined]);

    const snap = fresh();
    await writeSnapshot(snap);
    expect((await readSnapshot(snap, { measurements: backups })).backups?.size).toBe(2);
  });

  it('refuses a backup file of the wrong shape', async () => {
    const backups = fresh();
    await mkdir(backups, { recursive: true });
    await writeFile(
      join(backups, 'GeneFlow.json'),
      JSON.stringify([{ kpi: 'users', date: '2023-01-01' }]),
    );
    await expect(readBackups(backups)).rejects.toThrow(
      /GeneFlow\.json does not have the expected shape/,
    );
  });

  it.each([
    ['GeneFlow.json', 'GeneFlow'],
    ['Root%20Atlas.json', 'Root Atlas'],
    ['A%2FB.json', 'A/B'],
    ['notes.txt', undefined],
    ['%E0.json', undefined],
  ])('the file %j is the service %j', (name, service) => {
    expect(serviceOfFile(name)).toBe(service);
  });
});
