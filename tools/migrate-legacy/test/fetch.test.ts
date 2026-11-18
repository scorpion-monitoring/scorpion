// `migrate-legacy fetch` against a stub of the legacy API (made-up data): the history from 1900, two series in one
// answer, a refused key, a retry after a 503, and the key never in the output, a log line or a file.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runCli, type CliDeps } from '../src/cli.ts';
import { MEASUREMENTS_START } from '../src/fetch.ts';
import { readSnapshot } from '../src/snapshot.ts';
import { startLegacyStub, type StubServer } from './legacy-stub.ts';

const ADMIN_KEY = 'stub-admin-key-6f1c9a2e';
const USER_KEY = 'stub-user-key-0b7d3e55';

let stub: StubServer;
let work: string;
beforeAll(async () => {
  stub = await startLegacyStub();
  work = await mkdtemp(join(tmpdir(), 'migrate-legacy-fetch-'));
});
afterEach(() => {
  stub.requests.length = 0;
});
afterAll(async () => {
  await stub?.stop();
  await rm(work, { recursive: true, force: true });
});

function cli(key: string | undefined) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    env: key === undefined ? {} : { LEGACY_API_KEY: key },
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    sleep: () => Promise.resolve(),
    now: () => new Date('2026-11-17T10:00:00Z'),
  };
  return { out, err, deps };
}

async function filesBelow(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

let counter = 0;
const outDir = () => join(work, `snapshot-${counter++}`);

describe('fetch', () => {
  it('writes the snapshot with a manifest, asks for the history from 1900, and keeps both series of a service', async () => {
    const { out, err, deps } = cli(ADMIN_KEY);
    const dir = outDir();
    expect(await runCli(['fetch', '--from', `${stub.url}/`, '--out', dir], deps)).toBe(0);

    const measurementCalls = stub.requests.filter((r) => r.path.endsWith('/api/v1/measurements'));
    expect(measurementCalls.length).toBeGreaterThan(0);
    for (const call of measurementCalls) {
      expect(call.query.start).toBe(MEASUREMENTS_START);
      expect(Number(call.query.pageSize)).toBeGreaterThanOrEqual(100_000);
    }
    // One page, then the check: the next page of each service must be empty.
    expect(measurementCalls.filter((c) => c.query.page === '1')).toHaveLength(
      measurementCalls.filter((c) => c.query.page === '0').length,
    );
    expect(stub.requests.every((r) => r.method === 'GET')).toBe(true);

    const snapshot = await readSnapshot(dir);
    expect(snapshot.manifest.source).toBe(stub.url);
    expect(snapshot.manifest.fetchedAt).toBe('2026-11-17T10:00:00.000Z');
    expect(snapshot.providers.map((p) => p.abbreviation)).toEqual([
      'BioNet',
      'PlantData',
      'Seed Lab',
    ]);
    // One row per service and provider; the service without a provider is not listed by the legacy route.
    expect(snapshot.services.filter((s) => s.abbreviation === 'Root Atlas')).toHaveLength(2);
    expect(snapshot.services.some((s) => s.abbreviation === 'Orphan')).toBe(false);
    // Points before 2022 are there (the default start would have cut them).
    const geneflow = snapshot.measurements.get('GeneFlow')!;
    expect(geneflow.some((p) => p.date === '2019-11-01 00:00:00+00:00')).toBe(true);
    // The value 0 is not in the API's answer.
    expect(geneflow.some((p) => p.kpi === 'jobs' && p.date.startsWith('2021-12-01'))).toBe(false);
    // Both series of LeafDB, table by table in the order InfluxDB gives them (by measurement name).
    const leaf = snapshot.measurements.get('LeafDB')!;
    expect(leaf.map((p) => p.date.slice(0, 7))).toEqual([
      '2023-03',
      '2023-04',
      '2023-05',
      '2020-01',
      '2020-01',
      '2020-02',
      '2020-02',
    ]);
    expect(snapshot.indicatorsByService.LeafDB!.find((k) => k.name === 'downloads')!.selected).toBe(
      true,
    );
    expect(snapshot.users).toHaveLength(2);
    expect(snapshot.membershipRequests).toHaveLength(1);
    expect(out.join('\n')).toMatch(/3 providers, 2 categories, 4 services \(5 rows\), 2 users/);
    expect(err.join('\n')).toContain('GET /aai/users: 200');
  });

  it('writes every file with mode 0600', async () => {
    const { deps } = cli(ADMIN_KEY);
    const dir = outDir();
    expect(await runCli(['fetch', '--from', stub.url, '--out', dir], deps)).toBe(0);
    const { stat } = await import('node:fs/promises');
    for (const file of await filesBelow(dir)) {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('retries after a 503 and goes on', async () => {
    const { err, deps } = cli(ADMIN_KEY);
    stub.failNext('/api/v1/providers', 2);
    expect(await runCli(['fetch', '--from', stub.url, '--out', outDir()], deps)).toBe(0);
    expect(
      err.filter((line) => line.includes('/api/v1/providers') && line.includes('503')),
    ).toHaveLength(2);
    expect(stub.requests.filter((r) => r.path.endsWith('/api/v1/providers')).length).toBe(3);
  });

  it('gives up after the last attempt and leaves no manifest', async () => {
    const { err, deps } = cli(ADMIN_KEY);
    const dir = outDir();
    stub.failNext('/api/v1/categories', 10);
    expect(await runCli(['fetch', '--from', stub.url, '--out', dir], deps)).toBe(1);
    expect(err.join('\n')).toMatch(/failed after 5 attempts \(503\)/);
    expect(await readdir(dir)).not.toContain('manifest.json');
    stub.failNext('/api/v1/categories', 0);
  });

  it('stops at a 401 when the key is refused, and asks for the key when it is not set', async () => {
    const wrong = cli('not-a-key-31b1');
    expect(await runCli(['fetch', '--from', stub.url, '--out', outDir()], wrong.deps)).toBe(1);
    expect(wrong.err.join('\n')).toMatch(/refused \(401\).*LEGACY_API_KEY/);
    expect(stub.requests).toHaveLength(1);

    const none = cli(undefined);
    expect(await runCli(['fetch', '--from', stub.url, '--out', outDir()], none.deps)).toBe(2);
    expect(none.err.join('\n')).toMatch(/Set LEGACY_API_KEY/);
  });

  it('refuses the key of an account that is not an administrator before it reads anything else', async () => {
    const { err, deps } = cli(USER_KEY);
    expect(await runCli(['fetch', '--from', stub.url, '--out', outDir()], deps)).toBe(1);
    expect(err.join('\n')).toMatch(/not an administrator/);
    expect(stub.requests.map((r) => r.path)).toEqual(['/legacy/aai/users']);
  });

  it('never takes the key as an argument, and never writes it to the output, a log line or a file', async () => {
    const asArgument = cli(undefined);
    expect(
      await runCli(
        ['fetch', '--from', stub.url, '--out', outDir(), '--key', ADMIN_KEY],
        asArgument.deps,
      ),
    ).toBe(2);
    expect([...asArgument.out, ...asArgument.err].join('\n')).not.toContain(ADMIN_KEY);

    const { out, err, deps } = cli(ADMIN_KEY);
    const dir = outDir();
    stub.failNext('/api/v1/services', 1);
    expect(await runCli(['fetch', '--from', stub.url, '--out', dir], deps)).toBe(0);
    // The stub saw the key in the header, so it was sent; it must be nowhere else.
    expect(stub.requests.every((r) => r.key === ADMIN_KEY)).toBe(true);
    expect(stub.requests.some((r) => JSON.stringify(r.query).includes(ADMIN_KEY))).toBe(false);
    expect([...out, ...err].join('\n')).not.toContain(ADMIN_KEY);
    for (const file of await filesBelow(dir)) {
      expect(await readFile(file, 'utf8')).not.toContain(ADMIN_KEY);
    }
  });

  it('refuses a base URL with credentials, an output inside the repository, and an output that is not empty', async () => {
    const a = cli(ADMIN_KEY);
    const withUser = stub.url.replace('http://', 'http://someone:secret@');
    expect(await runCli(['fetch', '--from', withUser, '--out', outDir()], a.deps)).toBe(1);
    expect(a.err.join('\n')).toMatch(/must not hold credentials/);

    const b = cli(ADMIN_KEY);
    expect(
      await runCli(
        ['fetch', '--from', stub.url, '--out', join(import.meta.dirname, 'snap')],
        b.deps,
      ),
    ).toBe(1);
    expect(b.err.join('\n')).toMatch(/inside the repository/);

    const c = cli(ADMIN_KEY);
    const dir = outDir();
    expect(await runCli(['fetch', '--from', stub.url, '--out', dir], c.deps)).toBe(0);
    expect(await runCli(['fetch', '--from', stub.url, '--out', dir], c.deps)).toBe(1);
    expect(c.err.join('\n')).toMatch(/is not empty/);
    expect(stub.requests.length).toBeGreaterThan(0);
  });
});
