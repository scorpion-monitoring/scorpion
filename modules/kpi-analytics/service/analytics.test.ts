// The reads of kpi.analytics on real Postgres (M11 sprint 3): who may read, the window by the injected clock across a year end, gaps, a dropped
// KPI's values, the category and KPI filters, the order, a service with no KPIs, a 422 per bad parameter, and the figures of the summary.
import { Forbidden, Invalid, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeIndicator, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useAnalytics } from '../test/harness.ts';
import { analyticsWorld, paths, rejection, type AnalyticsWorld } from '../test/world.ts';

const h = useAnalytics();
const anonymous: Actor = { kind: 'anonymous' };
const FIRST = { page: 0, pageSize: 50 };

/** Downloads with a gap in April and none yet for the current month; satisfaction three times; uptime in seconds; a note; a dropped KPI. */
async function seeded() {
  const w = await analyticsWorld(await h.start());
  await w.put(w.ind.downloads, '2026-01-31', 100);
  await w.put(w.ind.downloads, '2026-02-28', 110);
  await w.put(w.ind.downloads, '2026-03-31', 121);
  await w.put(w.ind.downloads, '2026-05-31', 90);
  await w.put(w.ind.satisfaction, '2026-01-31', 80);
  await w.put(w.ind.satisfaction, '2026-03-31', 82.5);
  await w.put(w.ind.uptime, '2026-02-28', 3661);
  await w.put(w.ind.uptime, '2026-03-31', 7200);
  await w.put(w.ind.note, '2026-03-31', 'all well');
  await w.put(w.ind.dropped, '2026-04-30', 7);
  return w;
}
const series = (
  w: AnalyticsWorld,
  query: Record<string, unknown> = {},
  who: Actor = w.people.plain,
  page = FIRST,
) => w.analytics.series(who, { service: w.svc.id, ...query }, page);
const summary = (
  w: AnalyticsWorld,
  query: Record<string, unknown> = {},
  who: Actor = w.people.plain,
  page = FIRST,
) => w.analytics.summary(who, { service: w.svc.id, ...query }, page);
const row = <T extends { indicatorId: string }>(rows: T[], indicator: { id: string }) =>
  rows.find((candidate) => candidate.indicatorId === indicator.id)!;

describe('who may read [ASVS-8.2.1] [ASVS-8.3.1]', () => {
  it('refuses an anonymous caller (401) and a person without the permission (403), and lets any holder read every service', async () => {
    const w = await seeded();
    for (const read of [series, summary]) {
      await expect(read(w, {}, anonymous)).rejects.toBeInstanceOf(Unauthorized);
      await expect(read(w, {}, await w.actor())).rejects.toBeInstanceOf(Forbidden);
      // the role user holds it: a member of the provider, a person with no tie to it and Admin all read
      for (const who of ['member', 'plain', 'admin'] as const)
        expect((await read(w, {}, w.people[who])).total, who).toBe(5);
    }
    await expect(w.analytics.categories(anonymous)).rejects.toBeInstanceOf(Unauthorized);
    await expect(w.analytics.categories(await w.actor())).rejects.toBeInstanceOf(Forbidden);
    await expect(w.analytics.defaults(await w.actor())).rejects.toBeInstanceOf(Forbidden);
  });

  it('needs the scope of a token: kpi.analytics.read and nothing of the modules it reads', async () => {
    const w = await seeded();
    const token = (scopes: string[]): Actor => ({ ...w.people.plain, via: 'token', scopes });
    await expect(series(w, {}, token([]))).rejects.toBeInstanceOf(Forbidden);
    await expect(series(w, {}, token(['kpi.ingestion.v1.read']))).rejects.toBeInstanceOf(Forbidden);
    expect((await series(w, {}, token(['kpi.analytics.read']))).total).toBe(5);
  });

  it('shows no person, run, source, file name or row id in an answer [ASVS-8.2.3]', async () => {
    const w = await seeded();
    const text = JSON.stringify([(await series(w)).rows, (await summary(w)).rows]);
    for (const word of [
      'createdBy',
      'updatedBy',
      'runId',
      'source',
      'fileName',
      w.people.member.userId,
      w.people.plain.userId,
    ])
      expect(text).not.toContain(word);
    const keys = new Set(Object.keys(row((await series(w)).rows, w.ind.downloads)));
    expect([...keys].sort()).toEqual(
      [
        'current',
        'indicatorId',
        'name',
        'necessity',
        'points',
        'thematic',
        'unit',
        'valueType',
      ].sort(),
    );
  });
});

describe('series: the window and the points', () => {
  it('has one point per month of the range, oldest first, ending with the current month; a gap is null, never zero', async () => {
    const w = await seeded();
    const result = await series(w);
    expect(result.range).toBe('1y');
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toBe('2025-07-31');
    expect(result.months.at(-1)).toBe('2026-06-30');
    const downloads = row(result.rows, w.ind.downloads);
    expect(downloads.points.map((p) => p.period)).toEqual(result.months);
    expect(downloads.points.slice(6).map((p) => p.value)).toEqual([100, 110, 121, null, 90, null]);
    expect(downloads.points.slice(0, 6).every((p) => p.value === null && p.text === null)).toBe(
      true,
    );
  });

  it('counts back from the current month by the injected clock, across a year end and a leap year', async () => {
    const w = await seeded();
    await w.put(w.ind.downloads, '2026-10-31', 1);
    await w.put(w.ind.downloads, '2026-12-31', 2);
    await w.put(w.ind.downloads, '2027-01-31', 3);
    w.clock.set('2027-01-10T00:00:00Z');
    const result = await series(w, { range: '3m' });
    expect(result.months).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
    expect(row(result.rows, w.ind.downloads).points.map((p) => p.value)).toEqual([null, 2, 3]);
    w.clock.set('2028-03-01T00:00:00Z');
    expect((await series(w, { range: '3m' })).months).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('applies every range, `all` being the 120 months a read serves; no range is the default, 1y', async () => {
    const w = await seeded();
    const counts = async (range?: string) =>
      (await series(w, range === undefined ? {} : { range })).months.length;
    expect([
      await counts('3m'),
      await counts('6m'),
      await counts('1y'),
      await counts('2y'),
      await counts('all'),
    ]).toEqual([3, 6, 12, 24, 120]);
    expect(await counts()).toBe(12);
    // a value older than the window is not in it
    expect((await series(w, { range: '3m' })).rows.every((r) => r.points.length === 3)).toBe(true);
    expect(
      row((await series(w, { range: '3m' })).rows, w.ind.downloads).points.map((p) => p.value),
    ).toEqual([null, 90, null]);
  });

  it('shows a text value as text and never as a number, and a duration as seconds', async () => {
    const w = await seeded();
    const result = await series(w, { range: '6m' });
    const note = row(result.rows, w.ind.note).points.find((p) => p.period === '2026-03-31')!;
    expect(note).toEqual({ period: '2026-03-31', value: null, text: 'all well' });
    const uptime = row(result.rows, w.ind.uptime).points.filter((p) => p.value !== null);
    expect(uptime.map((p) => [p.value, p.text])).toEqual([
      [3661, null],
      [7200, null],
    ]);
  });

  it('still shows the values of a KPI the service dropped, marked as not current', async () => {
    const w = await seeded();
    const result = await series(w);
    const dropped = row(result.rows, w.ind.dropped);
    expect(dropped).toMatchObject({ current: false, necessity: null });
    expect(dropped.points.find((p) => p.period === '2026-04-30')!.value).toBe(7);
    expect(row(result.rows, w.ind.downloads)).toMatchObject({
      current: true,
      necessity: 'mandatory',
    });
    // outside the window it is not listed at all
    w.clock.set('2026-09-10T00:00:00Z');
    expect(
      (await series(w, { range: '3m' })).rows.some((r) => r.indicatorId === w.ind.dropped.id),
    ).toBe(false);
  });

  it('is ordered by name without case, then id, and the pages walked in turn are the one-page list', async () => {
    const w = await seeded();
    const all = (await series(w)).rows;
    const names = all.map((r) => r.name.toLowerCase());
    expect(names).toEqual([...names].sort());
    const walked = [];
    for (let page = 0; page < 5; page++)
      walked.push(...(await series(w, {}, w.people.plain, { page, pageSize: 2 })).rows);
    expect(walked.map((r) => r.indicatorId)).toEqual(all.map((r) => r.indicatorId));
    expect((await series(w, {}, w.people.plain, { page: 0, pageSize: 2 })).total).toBe(5);
    expect((await series(w, {}, w.people.plain, { page: 9, pageSize: 2 })).rows).toEqual([]);
  });
});

describe('series: the filters', () => {
  it('keeps the KPIs of one thematic category, the dropped ones included, and `all` or none means every category', async () => {
    const w = await seeded();
    const usage = await series(w, { category: 'Usage' });
    expect(new Set(usage.rows.map((r) => r.indicatorId))).toEqual(
      new Set([w.ind.downloads.id, w.ind.note.id, w.ind.dropped.id]),
    );
    expect(usage.total).toBe(3);
    expect((await series(w, { category: 'Technical' })).rows.map((r) => r.indicatorId)).toEqual([
      w.ind.uptime.id,
    ]);
    expect((await series(w, { category: 'all' })).total).toBe(5);
    expect((await series(w, { category: 'Bibliographic' })).rows).toEqual([]);
  });

  it('keeps the KPIs asked for, by name without case or by id, and is 422 `indicators` for each it does not know', async () => {
    const w = await seeded();
    const some = await series(w, {
      indicators: [w.ind.satisfaction.name.toUpperCase(), w.ind.uptime.id],
    });
    expect(new Set(some.rows.map((r) => r.indicatorId))).toEqual(
      new Set([w.ind.satisfaction.id, w.ind.uptime.id]),
    );
    const stranger = await makeIndicator(w.pool, { name: 'Stranger KPI' });
    const error = await rejection(
      series(w, { indicators: ['No such', w.ind.downloads.name, stranger.name] }),
    );
    expect(paths(error)).toEqual(['query:indicators', 'query:indicators']);
    expect(error.errors!.map((e) => e.message).join(' ')).not.toContain('No such');
  });

  it('holds nothing of another service, and a service with no KPIs is an empty list, not an error', async () => {
    const w = await seeded();
    const bare = await makeService(w.pool, { provider: w.provider.id });
    await w.put(w.ind.downloads, '2026-05-31', 999, bare.id);
    const bareSeries = await series(w, { service: bare.id });
    // the value is of a KPI the service does not report: it is a dropped KPI of that service, shown as such, and the first service's is not shown
    expect(bareSeries.rows.map((r) => r.current)).toEqual([false]);
    expect(row((await series(w)).rows, w.ind.downloads).points.some((p) => p.value === 999)).toBe(
      false,
    );
    const empty = await makeService(w.pool, { provider: w.provider.id });
    expect(await series(w, { service: empty.id })).toMatchObject({ rows: [], total: 0 });
    expect(await summary(w, { service: empty.id })).toMatchObject({ rows: [], total: 0 });
  });
});

describe('the 422s: each bad parameter is named, never a 500', () => {
  it('names service, range, category and indicators, and reports every problem at once', async () => {
    const w = await seeded();
    const cases: [Record<string, unknown>, string[]][] = [
      [{ service: 'nope' }, ['query:service']],
      [{ service: '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10' }, ['query:service']],
      [{ range: '5y' }, ['query:range']],
      [{ range: '' }, ['query:range']],
      [{ range: '1Y' }, ['query:range']],
      [{ category: 'Nonsense' }, ['query:category']],
      [{ indicators: ['No such'] }, ['query:indicators']],
      [{ indicators: Array.from({ length: 51 }, (_, n) => `k${n}`) }, ['query:indicators']],
      [
        { service: 'x', range: 'x', category: 'x' },
        ['query:category', 'query:range', 'query:service'],
      ],
    ];
    for (const read of [series, summary])
      for (const [query, expected] of cases) {
        const error = await rejection(read(w, query));
        expect(error, JSON.stringify(query)).toBeInstanceOf(Invalid);
        expect(paths(error), JSON.stringify(query)).toEqual(expected);
      }
  });
});

describe('summary: the figures of each KPI', () => {
  it('carries the points of the series read, so one read serves a dashboard (ADR-0044)', async () => {
    const w = await seeded();
    for (const range of ['3m', '1y', 'all']) {
      const [rows, points] = [
        (await summary(w, { range })).rows,
        (await series(w, { range })).rows,
      ];
      expect(rows.map((one) => [one.indicatorId, one.points])).toEqual(
        points.map((one) => [one.indicatorId, one.points]),
      );
    }
    // a gap is null and a text value has its text, never a zero
    const note = row((await summary(w, { range: '6m' })).rows, w.ind.note);
    expect(note.points.some((point) => point.value === null && point.text === 'all well')).toBe(
      true,
    );
    expect(note.points.some((point) => point.value === 0)).toBe(false);
  });

  it('gives the latest value with its text, the change in percent, the average and the volatility', async () => {
    const w = await seeded();
    const rows = (await summary(w)).rows;
    const downloads = row(rows, w.ind.downloads);
    expect(downloads.latest).toEqual({ period: '2026-05-31', value: 90, text: '90' });
    expect(downloads.change).toBeCloseTo(-10, 9);
    expect(downloads.average).toBeCloseTo(105.25, 9);
    expect(downloads.volatility.value).toBeCloseTo(10.25 / 105.25, 9);
    expect(downloads.volatility.band).toBe('low');
    const uptime = row(rows, w.ind.uptime);
    expect(uptime.latest).toEqual({ period: '2026-03-31', value: 7200, text: '02-00-00' });
    expect(uptime.change).toBeCloseTo(((7200 - 3661) / 3661) * 100, 9);
  });

  it('is n/a (null), never zero, where it is not defined: a text value, one value, none', async () => {
    const w = await seeded();
    const rows = (await summary(w, { range: '6m' })).rows;
    expect(row(rows, w.ind.note)).toMatchObject({
      latest: { period: '2026-03-31', value: null, text: 'all well' },
      change: null,
      average: null,
      volatility: { value: null, band: null },
    });
    const dropped = row(rows, w.ind.dropped);
    expect(dropped).toMatchObject({ change: null, volatility: { value: null, band: null } });
    expect(dropped.average).toBe(7);
    const none = row((await summary(w, { range: '3m' })).rows, w.ind.satisfaction);
    expect(none).toMatchObject({
      latest: null,
      change: null,
      average: null,
      volatility: { value: null, band: null },
    });
  });

  it('is n/a for the change when the oldest value of the window is 0', async () => {
    const w = await seeded();
    await w.put(w.ind.satisfaction, '2026-04-30', 0);
    await w.put(w.ind.satisfaction, '2026-05-31', 10);
    const satisfaction = row((await summary(w, { range: '3m' })).rows, w.ind.satisfaction);
    expect(satisfaction.change).toBeNull();
    expect(satisfaction.latest!.value).toBe(10);
  });

  it('bands the volatility by the thresholds of the settings, and a change of them takes effect at once', async () => {
    const w = await seeded();
    const band = async () => row((await summary(w)).rows, w.ind.downloads).volatility.band;
    expect(await band()).toBe('low');
    const current = await w.settings.settings.get(w.people.admin, 'kpi.analytics');
    await w.settings.settings.update(w.people.admin, 'kpi.analytics', {
      version: current.version,
      values: { volatility: { thresholds: { low: 0.05, high: 0.08 } } },
    });
    expect(await band()).toBe('high');
    const next = await w.settings.settings.get(w.people.admin, 'kpi.analytics');
    await w.settings.settings.update(w.people.admin, 'kpi.analytics', {
      version: next.version,
      values: { volatility: { thresholds: { low: 0.05, high: 0.5 } } },
    });
    expect(await band()).toBe('medium');
  });
});

// ---- the export (sprint 5) --------------------------------------------------------------------------------------------------------
describe('export', () => {
  const asText = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  const exportOf = (
    w: AnalyticsWorld,
    format: string,
    query: Record<string, unknown> = {},
    who: Actor = w.people.plain,
  ) => w.analytics.export(who, { service: w.svc.id, ...query }, format);

  it('refuses an anonymous caller (401) and a person without the export permission (403), twice checked [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await seeded();
    await expect(exportOf(w, 'csv', {}, anonymous)).rejects.toBeInstanceOf(Unauthorized);
    await expect(exportOf(w, 'csv', {}, await w.actor())).rejects.toBeInstanceOf(Forbidden);
    // a token with the read scope only may not export, and one with the export scope may
    const token = (scopes: string[]): Actor => ({ ...w.people.plain, via: 'token', scopes });
    await expect(exportOf(w, 'csv', {}, token(['kpi.analytics.read']))).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(
      (await exportOf(w, 'csv', {}, token(['kpi.analytics.export']))).bytes.length,
    ).toBeGreaterThan(0);
    // a holder of the permission exports every service: a member of the provider, a person with no tie to it and Admin
    for (const who of ['member', 'plain', 'admin'] as const)
      expect((await exportOf(w, 'csv', {}, w.people[who])).fileName, who).toMatch(/\.csv$/);
  });

  it('answers a caller without the permission 403 before it says anything about the format or the service', async () => {
    const w = await seeded();
    const nobody = await w.actor();
    await expect(exportOf(w, 'nonsense', { range: 'x' }, nobody)).rejects.toBeInstanceOf(Forbidden);
  });

  it('is 422 naming `format` for an unknown one, and names every bad parameter at once', async () => {
    const w = await seeded();
    for (const format of ['pdf', '', 'CSV', 'csv ', '__proto__', 'constructor'])
      expect(paths(await rejection(exportOf(w, format))), format).toEqual(['query:format']);
    expect(paths(await rejection(exportOf(w, 'csv', { range: '5y', category: 'Nope' })))).toEqual([
      'query:category',
      'query:range',
    ]);
    await expect(
      w.analytics.export(w.people.plain, { service: 'nope' }, 'csv'),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('writes one row per KPI on the months of the window, with a dropped KPI and a text value, named by the service abbreviation', async () => {
    const w = await seeded();
    const file = await exportOf(w, 'csv', { range: '6m' });
    expect(file.fileName).toBe(`${w.svc.slug}-kpis-6m.csv`);
    expect(file.mediaType).toBe('text/csv; charset=utf-8');
    expect([...file.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = asText(file.bytes)
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(lines[0]).toBe('KPI,Unit,2026-01,2026-02,2026-03,2026-04,2026-05,2026-06');
    const byName = new Map(lines.slice(1).map((line) => [line.split(',')[0]!, line]));
    expect(byName.size).toBe(5);
    // the unit is the label of the vocabulary term, the gap in April stays empty and the current month has no value yet
    expect(byName.get(w.ind.downloads.name)).toMatch(/^[^,]+,[^,]+,100,110,121,,90,$/);
    expect(byName.get(w.ind.dropped.name)).toMatch(/,,,,,7,,$/);
    expect(byName.get(w.ind.note.name)).toMatch(/,,,all well,,,$/);
  });

  it('keeps the filters of the reads: the category, and only the KPIs of the service', async () => {
    const w = await seeded();
    const file = await exportOf(w, 'csv', { category: 'Technical' });
    const lines = asText(file.bytes)
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(w.ind.uptime.name);
    // another service's values never leak in
    const other = await makeService(w.pool, { provider: w.provider.id });
    const empty = await w.analytics.export(w.people.plain, { service: other.id }, 'csv');
    expect(asText(empty.bytes).trimEnd().split('\r\n')).toHaveLength(1);
  });

  it('is the same table in XLSX, and the name has no free text: an odd abbreviation becomes a safe stem', async () => {
    const w = await seeded();
    const odd = await makeService(w.pool, { provider: w.provider.id, slug: 'weird-slug' });
    const file = await w.analytics.export(w.people.plain, { service: odd.id }, 'xlsx');
    expect(file.fileName).toBe('weird-slug-kpis-1y.xlsx');
    expect(file.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect([...file.bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it('reads and writes nothing else: no outbox event, no row', async () => {
    const w = await seeded();
    const count = async () =>
      (await w.pool.query<{ n: number }>('select count(*)::int as n from kernel_outbox')).rows[0]!
        .n;
    const before = await count();
    await exportOf(w, 'xlsx');
    expect(await count()).toBe(before);
  });
});
