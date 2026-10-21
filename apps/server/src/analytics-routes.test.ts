// The internal reads of kpi.analytics through the whole pipeline (M11 sprint 3): the series and the summary of a service. Session auth, the plain
// permission `kpi.analytics.read` held by the role `user`, the same envelope as every list, the window by the injected clock, and a 4xx (never a
// 500) for every bad input.
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
let bare: { id: string };
let indicators: { id: string; name: string }[];

beforeAll(async () => {
  started = await app.start({
    kpi: true,
    ingestion: { clock: () => NOW },
    analytics: { clock: () => NOW },
  });
  const pool = started.kernel.pool;
  alice = await started.signedIn('alice-analytics');
  const provider = await makeOrganisation(pool, { type: 'provider' });
  service = await makeService(pool, { provider: provider.id });
  bare = await makeService(pool, { provider: provider.id });
  indicators = await Promise.all(
    [
      ['Analytics downloads', 'integer', 'Usage'],
      ['Analytics share', 'percentage', 'Satisfaction'],
      ['Analytics uptime', 'duration', 'Technical'],
    ].map(([name, valueType, thematic]) =>
      makeIndicator(pool, { name: name!, valueType, thematic }),
    ),
  );
  const set = await makeKpiSet(pool, {
    indicators: indicators.map((indicator) => ({
      indicatorId: indicator.id,
      necessity: 'mandatory',
    })),
  });
  await makeServiceKpis(pool, { serviceId: service.id, setId: set.id });
  for (const [month, value] of [
    ['2026-03-31', 100],
    ['2026-04-30', 150],
    ['2026-05-31', 120],
  ] as const)
    await makeMeasurement(pool, {
      serviceId: service.id,
      indicatorId: indicators[0]!.id,
      period: month,
      valueNumeric: value,
    });
  await makeMeasurement(pool, {
    serviceId: service.id,
    indicatorId: indicators[2]!.id,
    period: '2026-05-31',
    valueNumeric: 3725,
  });
}, 120_000);

const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
type Envelope<T> = {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: T[];
};
type Series = Envelope<{
  name: string;
  current: boolean;
  points: { period: string; value: number | null; text: string | null }[];
}>;
type Summary = Envelope<{
  name: string;
  latest: { period: string; value: number | null; text: string } | null;
  change: number | null;
  average: number | null;
  volatility: { value: number | null; band: string | null };
}>;
const problemPaths = (body: unknown) =>
  ((body as { errors?: { in: string; path: string }[] }).errors ?? []).map(
    (e) => `${e.in}:${e.path}`,
  );

describe('GET /kpi/analytics/series', () => {
  it('lists the KPIs with one point per month of the default window, in the envelope', async () => {
    const reply = await started.get(`/kpi/analytics/series?service=${service.id}`, as(alice));
    expect(reply.status).toBe(200);
    const body = reply.body as Series;
    expect(Object.keys(body).sort()).toEqual(['metadata', 'result']);
    expect(body.metadata).toEqual({ currentPage: 0, pageSize: 50, totalCount: 3, totalPages: 1 });
    expect(body.result.map((row) => row.name)).toEqual([
      'Analytics downloads',
      'Analytics share',
      'Analytics uptime',
    ]);
    const downloads = body.result[0]!;
    expect(downloads.points).toHaveLength(12);
    expect(downloads.points.slice(-4).map((point) => [point.period, point.value])).toEqual([
      ['2026-03-31', 100],
      ['2026-04-30', 150],
      ['2026-05-31', 120],
      ['2026-06-30', null],
    ]);
  });

  it('applies the range, the category and the KPI filter, and pages like every list', async () => {
    const q = (extra: string) =>
      started.get(`/kpi/analytics/series?service=${service.id}&${extra}`, as(alice));
    expect(
      ((await q('range=3m')).body as Series).result[0]!.points.map((point) => point.period),
    ).toEqual(['2026-04-30', '2026-05-31', '2026-06-30']);
    expect(((await q('range=all')).body as Series).result[0]!.points).toHaveLength(120);
    expect(((await q('category=Technical')).body as Series).result.map((row) => row.name)).toEqual([
      'Analytics uptime',
    ]);
    expect(
      ((await q('indicators=ANALYTICS SHARE')).body as Series).result.map((row) => row.name),
    ).toEqual(['Analytics share']);
    const first = (await q('pageSize=2&page=0')).body as Series;
    expect(first.result).toHaveLength(2);
    expect(first.metadata).toMatchObject({ totalCount: 3, totalPages: 2, pageSize: 2 });
    expect(((await q('pageSize=2&page=1')).body as Series).result.map((row) => row.name)).toEqual([
      'Analytics uptime',
    ]);
    expect(((await q('pageSize=2&page=9')).body as Series).result).toEqual([]);
  });

  it('is an empty list for a service with no KPIs', async () => {
    const reply = await started.get(`/kpi/analytics/series?service=${bare.id}`, as(alice));
    expect(reply.status).toBe(200);
    expect((reply.body as Series).result).toEqual([]);
    expect((reply.body as Series).metadata.totalCount).toBe(0);
  });
});

describe('GET /kpi/analytics/summary', () => {
  it('gives the latest value, the change, the average and the volatility of each KPI', async () => {
    const reply = await started.get(
      `/kpi/analytics/summary?service=${service.id}&range=6m`,
      as(alice),
    );
    expect(reply.status).toBe(200);
    const body = reply.body as Summary;
    const downloads = body.result.find((row) => row.name === 'Analytics downloads')!;
    expect(downloads.latest).toEqual({ period: '2026-05-31', value: 120, text: '120' });
    expect(downloads.change).toBeCloseTo(20, 9);
    expect(downloads.average).toBeCloseTo(370 / 3, 9);
    expect(downloads.volatility.band).toBe('low');
    const uptime = body.result.find((row) => row.name === 'Analytics uptime')!;
    expect(uptime.latest).toEqual({ period: '2026-05-31', value: 3725, text: '01-02-05' });
    expect(uptime.change).toBeNull();
    const share = body.result.find((row) => row.name === 'Analytics share')!;
    expect(share).toMatchObject({
      latest: null,
      change: null,
      average: null,
      volatility: { value: null, band: null },
    });
  });
});

describe('both reads', () => {
  const routes = ['series', 'summary'];

  it('are 422 naming the parameter for a bad service, range, category, indicators or page, and for an unknown parameter, never 500', async () => {
    const bad: [string, string][] = [
      ['', 'query:service'],
      ['?service=not-an-id', 'query:service'],
      [`?service=${ABSENT}`, 'query:service'],
      [`?service=${service.id}&range=5y`, 'query:range'],
      [`?service=${service.id}&range=`, 'query:range'],
      [`?service=${service.id}&category=Nonsense`, 'query:category'],
      [`?service=${service.id}&indicators=No%20such%20KPI`, 'query:indicators'],
      [`?service=${service.id}&pageSize=201`, 'query:pageSize'],
      [`?service=${service.id}&pageSize=0`, 'query:pageSize'],
      [`?service=${service.id}&page=-1`, 'query:page'],
      [`?service=${service.id}&extra=1`, 'query:'],
    ];
    for (const route of routes)
      for (const [query, path] of bad) {
        const reply = await started.get(`/kpi/analytics/${route}${query}`, as(alice));
        expect(reply.status, `${route}${query}`).toBe(422);
        expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
        expect(problemPaths(reply.body), `${route}${query}`).toContain(path);
      }
  });

  it('are 401 without a session and 403 for a user without the read permission [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const nobody = await started.signedIn('nobody-analytics', { roles: [] });
    for (const route of routes) {
      const url = `/kpi/analytics/${route}?service=${service.id}`;
      expect((await started.get(url)).status, route).toBe(401);
      expect((await started.get(url, as(nobody))).status, route).toBe(403);
    }
  });
});
