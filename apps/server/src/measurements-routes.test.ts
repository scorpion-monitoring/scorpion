// The internal reads of kpi.ingestion through the whole pipeline (M10 sprint 2): the grid of one month and the coverage of the last
// months, for the Data Submission page of sprint 4. Session auth, the plain permission `kpi.ingestion.measurement.read` held by the role
// `user`, the same envelope as every list, and a 4xx (never a 500) for every bad input.
import {
  makeIndicator,
  makeKpiSet,
  makeMeasurement,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const NOW = new Date('2026-06-15T12:00:00Z');
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
let alice: Awaited<ReturnType<typeof started.signedIn>>;
let service: { id: string };
let indicators: { id: string; name: string }[];

beforeAll(async () => {
  started = await app.start({ kpi: true, ingestion: { clock: () => NOW } });
  const pool = started.kernel.pool;
  alice = await started.signedIn('alice-grid');
  const provider = await makeOrganisation(pool, { type: 'provider' });
  service = await makeService(pool, { provider: provider.id });
  indicators = await Promise.all(
    [
      ['Grid downloads', 'integer'],
      ['Grid share', 'percentage'],
      ['Grid uptime', 'duration'],
    ].map(([name, valueType]) => makeIndicator(pool, { name: name!, valueType })),
  );
  const set = await makeKpiSet(pool, {
    indicators: [
      { indicatorId: indicators[0]!.id, necessity: 'mandatory' },
      { indicatorId: indicators[1]!.id, necessity: 'recommended' },
      { indicatorId: indicators[2]!.id, necessity: 'optional' },
    ],
  });
  await makeServiceKpis(pool, { serviceId: service.id, setId: set.id });
  await makeMeasurement(pool, {
    serviceId: service.id,
    indicatorId: indicators[0]!.id,
    period: '2026-05-31',
    valueNumeric: 321,
  });
  await makeMeasurement(pool, {
    serviceId: service.id,
    indicatorId: indicators[2]!.id,
    period: '2026-05-31',
    valueNumeric: 3725,
  });
}, 120_000);

const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
type Grid = {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: {
    name: string;
    necessity: string;
    valueType: string;
    measurement: { value: string; valueNumber: number | null } | null;
  }[];
};
const problemPaths = (body: unknown) =>
  ((body as { errors?: { in: string; path: string }[] }).errors ?? []).map(
    (e) => `${e.in}:${e.path}`,
  );

describe('GET /kpi/measurements', () => {
  it('lists every indicator of the effective set with the value of the month, in the envelope', async () => {
    const reply = await started.get(
      `/kpi/measurements?service=${service.id}&period=2026-05`,
      as(alice),
    );
    expect(reply.status).toBe(200);
    const body = reply.body as Grid;
    expect(Object.keys(body).sort()).toEqual(['metadata', 'result']);
    expect(body.metadata).toEqual({ currentPage: 0, pageSize: 200, totalCount: 3, totalPages: 1 });
    expect(
      body.result.map((row) => [row.name, row.necessity, row.measurement?.value ?? null]),
    ).toEqual([
      ['Grid downloads', 'mandatory', '321'],
      ['Grid share', 'recommended', null],
      ['Grid uptime', 'optional', '01-02-05'],
    ]);
    expect(body.result[2]!.measurement).toMatchObject({ valueNumber: 3725 });
  });

  it('pages like every list: pageSize, a page past the end, totalCount of the whole set', async () => {
    const q = (extra: string) =>
      started.get(`/kpi/measurements?service=${service.id}&period=2026-05&${extra}`, as(alice));
    const first = (await q('pageSize=2&page=0')).body as Grid;
    expect(first.result).toHaveLength(2);
    expect(first.metadata).toMatchObject({ totalCount: 3, totalPages: 2, pageSize: 2 });
    expect(((await q('pageSize=2&page=1')).body as Grid).result.map((row) => row.name)).toEqual([
      'Grid uptime',
    ]);
    expect(((await q('pageSize=2&page=9')).body as Grid).result).toEqual([]);
  });

  it('is empty for a month with no values and 404 for a service that does not exist', async () => {
    const empty = await started.get(
      `/kpi/measurements?service=${service.id}&period=2025-01`,
      as(alice),
    );
    expect((empty.body as Grid).result.every((row) => row.measurement === null)).toBe(true);
    const missing = await started.get(
      `/kpi/measurements?service=${ABSENT}&period=2026-05`,
      as(alice),
    );
    expect(missing.status).toBe(404);
    expect(missing.res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('is 422 naming the parameter for a bad service, period or page, and for an unknown parameter, never 500', async () => {
    const bad: [string, string][] = [
      ['', 'query:service'],
      [`?service=not-an-id&period=2026-05`, 'query:service'],
      [`?service=${service.id}`, 'query:period'],
      [`?service=${service.id}&period=2026-13`, 'query:period'],
      [`?service=${service.id}&period=June`, 'query:period'],
      [`?service=${service.id}&period=2026-05&pageSize=501`, 'query:pageSize'],
      [`?service=${service.id}&period=2026-05&page=-1`, 'query:page'],
      [`?service=${service.id}&period=2026-05&extra=1`, 'query:'],
    ];
    for (const [query, path] of bad) {
      const reply = await started.get(`/kpi/measurements${query}`, as(alice));
      expect(reply.status, query).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
      expect(problemPaths(reply.body), query).toContain(path);
    }
  });

  it('is 401 without a session and 403 for a user without the read permission [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const url = `/kpi/measurements?service=${service.id}&period=2026-05`;
    expect((await started.get(url)).status).toBe(401);
    const nobody = await started.signedIn('nobody-grid', { roles: [] });
    expect((await started.get(url, as(nobody))).status).toBe(403);
    expect((await started.get('/kpi/measurements/coverage?service=' + service.id)).status).toBe(
      401,
    );
    expect(
      (await started.get('/kpi/measurements/coverage?service=' + service.id, as(nobody))).status,
    ).toBe(403);
  });
});

describe('GET /kpi/measurements/coverage', () => {
  type Coverage = {
    metadata: { totalCount: number; pageSize: number };
    result: {
      period: string;
      reported: number;
      mandatory: number;
      mandatoryReported: number;
      complete: boolean;
    }[];
  };

  it('has the last twelve months, oldest first, and which of them have every mandatory value', async () => {
    const reply = await started.get(`/kpi/measurements/coverage?service=${service.id}`, as(alice));
    expect(reply.status).toBe(200);
    const body = reply.body as Coverage;
    expect(body.metadata).toMatchObject({
      totalCount: 12,
      pageSize: 12,
      currentPage: 0,
      totalPages: 1,
    });
    expect(body.result).toHaveLength(12);
    expect(body.result[0]!.period).toBe('2025-07-31');
    expect(body.result[11]!.period).toBe('2026-06-30');
    expect(body.result.find((month) => month.period === '2026-05-31')).toEqual({
      period: '2026-05-31',
      reported: 2,
      mandatory: 1,
      mandatoryReported: 1,
      complete: true,
    });
    expect(body.result.filter((month) => month.complete).map((month) => month.period)).toEqual([
      '2026-05-31',
    ]);
  });

  it('takes a number of months, 1 to 36, and is 422 for anything else and 404 for a service that does not exist', async () => {
    const q = (extra: string, id = service.id) =>
      started.get(`/kpi/measurements/coverage?service=${id}${extra}`, as(alice));
    expect(((await q('&months=3')).body as Coverage).result.map((month) => month.period)).toEqual([
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
    expect(((await q('&months=36')).body as Coverage).result).toHaveLength(36);
    for (const months of ['0', '37', 'x', '-1', '1.5', '100'])
      expect((await q(`&months=${months}`)).status, months).toBe(422);
    expect((await q('&extra=1')).status).toBe(422);
    expect((await q('', ABSENT)).status).toBe(404);
    expect((await q('', 'nope')).status).toBe(422);
  });
});
