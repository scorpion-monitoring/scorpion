// The reads of the measurements on real Postgres (M10 sprint 2): the time series of `GET /api/v1/measurements`, the grid of a month and
// the coverage of the last months. Who may read, the count per filter, the order across pages, a 422 per bad parameter naming it,
// and nothing from another service. The rows are made with the factory, so the reads are tested apart from the write.
import {
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type Actor,
  type FieldProblem,
} from '@scorpion/contracts';
import { makeIndicator, makeMeasurement, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { ingestionWorld, rejection, uniq, type IngestionWorld } from '../test/world.ts';
import { MANDATORY_NECESSITY } from './reads.ts';

const h = useKpi();
const anonymous: Actor = { kind: 'anonymous' };
const FIRST_PAGE = { page: 0, pageSize: 100 };
const paths = (error: { errors?: readonly FieldProblem[] }) =>
  (error.errors ?? []).map((e) => `${e.in}:${e.path}`);

/** The world with a series: downloads for six months, share for three, uptime for two (seconds), a note, and an outside indicator. */
async function seeded() {
  const w = await ingestionWorld(await h.start());
  const put = (
    indicator: { id: string },
    period: string,
    value: number | string,
    serviceId = w.svc.id,
  ) =>
    makeMeasurement(w.pool, {
      serviceId,
      indicatorId: indicator.id,
      period,
      ...(typeof value === 'string' ? { valueText: value } : { valueNumeric: value }),
    });
  for (const [n, month] of ['01-31', '02-28', '03-31', '04-30', '05-31', '06-30'].entries())
    await put(w.ind.downloads, `2026-${month}`, 100 + n);
  for (const [n, month] of ['01-31', '03-31', '05-31'].entries())
    await put(w.ind.share, `2026-${month}`, 10.5 + n);
  await put(w.ind.uptime, '2026-01-31', 3661);
  await put(w.ind.uptime, '2026-02-28', 7200);
  await put(w.ind.note, '2026-01-31', 'all well');
  return { ...w, put };
}
const read = (
  w: IngestionWorld,
  query: Record<string, unknown>,
  who: Actor = w.people.plain,
  page = FIRST_PAGE,
) => w.ingestion.reads.list(who, { service: w.svc.id, ...query }, page);

describe('reads.list: who may read [ASVS-8.2.1] [ASVS-8.3.1]', () => {
  it('refuses an anonymous caller (401) and a person without the read permission (403), and lets any holder read every service', async () => {
    const w = await seeded();
    await expect(read(w, {}, anonymous)).rejects.toBeInstanceOf(Unauthorized);
    await expect(read(w, {}, await w.actor())).rejects.toBeInstanceOf(Forbidden);
    // the role user holds it: a person of another provider, a person who is no member, a requested member and Admin all read
    for (const who of ['plain', 'elsewhere', 'requested', 'left', 'admin'] as const)
      expect((await read(w, {}, w.people[who])).total, who).toBe(12);
  });

  it('needs the scope of a token: kpi.ingestion.v1.read, and nothing of kpi.framework', async () => {
    const w = await seeded();
    const token = (scopes: string[]): Actor => ({ ...w.people.plain, via: 'token', scopes });
    await expect(read(w, {}, token([]))).rejects.toBeInstanceOf(Forbidden);
    await expect(read(w, {}, token(['kpi.framework.v1.read']))).rejects.toBeInstanceOf(Forbidden);
    expect((await read(w, {}, token(['kpi.ingestion.v1.read']))).total).toBe(12);
  });
});

describe('reads.list: the rows', () => {
  it('has the legacy kpi, value and date, and id, indicatorId, iri, service, period and valueNumber, and nothing else', async () => {
    const w = await seeded();
    const { rows } = await read(w, { indicators: [w.ind.uptime.name] });
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'date',
        'id',
        'indicatorId',
        'iri',
        'kpi',
        'period',
        'service',
        'value',
        'valueNumber',
      ].sort(),
    );
    expect(rows[0]).toMatchObject({
      kpi: w.ind.uptime.name,
      indicatorId: w.ind.uptime.id,
      service: w.svc.slug,
      period: '2026-01-31',
      date: '2026-01-31',
      // a duration is text in the legacy form and seconds in the number
      value: '01-01-01',
      valueNumber: 3661,
    });
    expect(rows[0]!.iri).toMatch(/\/kpi\/indicator\//);
    expect(rows[1]).toMatchObject({ value: '02-00-00', valueNumber: 7200 });
  });

  it('shows a number as a decimal string, a percentage as a number, text as written with valueNumber null', async () => {
    const w = await seeded();
    const byKpi = new Map((await read(w, { stop: '2026-01' })).rows.map((row) => [row.kpi, row]));
    expect(byKpi.get(w.ind.downloads.name)).toMatchObject({ value: '100', valueNumber: 100 });
    expect(byKpi.get(w.ind.share.name)).toMatchObject({ value: '10.5', valueNumber: 10.5 });
    expect(byKpi.get(w.ind.note.name)).toMatchObject({ value: 'all well', valueNumber: null });
  });

  it('never holds an actor id, a source, a run or a file name', async () => {
    const w = await seeded();
    const text = JSON.stringify((await read(w, {})).rows);
    expect(text).not.toContain('createdBy');
    expect(text).not.toContain('source');
    expect(text).not.toContain('runId');
    expect(text).not.toContain(w.people.member.userId);
  });
});

describe('reads.list: the service and the filters', () => {
  it('takes the service by id and by abbreviation (any case) and says 422 `service` for one that does not exist', async () => {
    const w = await seeded();
    expect((await read(w, { service: w.svc.slug })).total).toBe(12);
    expect((await read(w, { service: w.svc.slug.toUpperCase() })).total).toBe(12);
    for (const service of ['nope', '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10', ' ']) {
      const error = await rejection(read(w, { service }));
      expect(error).toBeInstanceOf(Invalid);
      expect(paths(error)).toEqual(['query:service']);
    }
  });

  it('keeps only the indicators asked for, by name without case or by id, and counts only them', async () => {
    const w = await seeded();
    const both = await read(w, {
      indicators: [w.ind.share.name.toUpperCase(), w.ind.uptime.id],
    });
    expect(both.total).toBe(5);
    expect(new Set(both.rows.map((row) => row.kpi))).toEqual(
      new Set([w.ind.share.name, w.ind.uptime.name]),
    );
    expect((await read(w, { indicators: [w.ind.downloads.name, w.ind.downloads.id] })).total).toBe(
      6,
    );
  });

  it('is 422 `indicators` for an unknown name, an indicator that is not the service’s, and a value with nothing in it; every bad value is named', async () => {
    const w = await seeded();
    const stranger = await makeIndicator(w.pool, { name: uniq('Stranger') });
    const error = await rejection(
      read(w, { indicators: ['No such', w.ind.downloads.name, stranger.name, ''] }),
    );
    expect(error).toBeInstanceOf(Invalid);
    expect(paths(error)).toEqual(['query:indicators', 'query:indicators', 'query:indicators']);
    expect(error.errors!.map((e) => e.message).join(' ')).not.toContain('No such');
  });

  it('keeps the months from start and up to stop, any day of a month meaning that month, and totalCount follows', async () => {
    const w = await seeded();
    const dated = async (query: Record<string, unknown>) =>
      (await read(w, { indicators: [w.ind.downloads.name], ...query })).rows.map(
        (row) => row.period,
      );
    expect(await dated({ start: '2026-03', stop: '2026-04' })).toEqual([
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(await dated({ start: '2026-03-15', stop: '2026-04-01' })).toEqual([
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(await dated({ start: '2026-06' })).toEqual(['2026-06-30']);
    expect(await dated({ stop: '2026-01' })).toEqual(['2026-01-31']);
    expect(await dated({ start: '2027-01' })).toEqual([]);
    expect((await read(w, { start: '2026-03', stop: '2026-04' })).total).toBe(3);
    expect((await read(w, { start: '2026-05' })).total).toBe(3);
  });

  it('is 422 naming start or stop for a bad month, a start after stop, and reports every problem at once', async () => {
    const w = await seeded();
    expect(paths(await rejection(read(w, { start: '2026-13' })))).toEqual(['query:start']);
    expect(paths(await rejection(read(w, { stop: 'soon' })))).toEqual(['query:stop']);
    expect(paths(await rejection(read(w, { start: '2026-06', stop: '2026-01' })))).toEqual([
      'query:start',
    ]);
    expect(
      paths(
        await rejection(read(w, { service: 'nope', start: 'x', stop: 'y', indicators: ['z'] })),
      ),
    ).toEqual(['query:service', 'query:start', 'query:stop']);
    expect(
      paths(await rejection(read(w, { start: '2026-01', stop: '2026-01-31', indicators: ['z'] }))),
    ).toEqual(['query:indicators']);
  });

  it('holds nothing of another service, and a service with no values is an empty page', async () => {
    const w = await seeded();
    await w.put(w.ind.downloads, '2026-01-31', 999, w.elsewhereSvc.id);
    const mine = await read(w, {});
    expect(mine.total).toBe(12);
    expect(mine.rows.some((row) => row.valueNumber === 999)).toBe(false);
    // the other service has one value of its own, and it is the only thing it shows
    const theirs = await read(w, { service: w.elsewhereSvc.slug });
    expect(theirs.total).toBe(1);
    expect(theirs.rows[0]).toMatchObject({ service: w.elsewhereSvc.slug, valueNumber: 999 });
    const empty = await makeService(w.pool, { provider: w.provider.id });
    expect(await read(w, { service: empty.id })).toEqual({ rows: [], total: 0 });
  });

  it('still lists a value of an indicator the service no longer reports, and lets the indicator be asked for by name', async () => {
    const w = await seeded();
    await w.put(w.ind.outside, '2026-02-28', 5);
    const all = await read(w, {});
    expect(all.total).toBe(13);
    expect(all.rows.find((row) => row.kpi === w.ind.outside.name)).toMatchObject({ value: '5' });
    expect((await read(w, { indicators: [w.ind.outside.name] })).total).toBe(1);
  });
});

describe('reads.list: the order holds across pages', () => {
  it('is by month, then indicator name without case, then id; the pages walked in turn are the one-page list', async () => {
    const w = await seeded();
    // names that a case-sensitive order and a case-insensitive one sort differently: `Zeta` before `alpha` in code units
    const zeta = await makeIndicator(w.pool, { name: uniq('Zeta'), valueType: 'integer' });
    const alpha = await makeIndicator(w.pool, { name: uniq('alpha'), valueType: 'integer' });
    for (const month of ['01-31', '02-28', '03-31']) {
      await w.put(zeta, `2026-${month}`, 1);
      await w.put(alpha, `2026-${month}`, 2);
    }
    const whole = await read(w, {}, w.people.plain, { page: 0, pageSize: 100 });
    expect(whole.total).toBe(18);
    const key = (row: { period: string; kpi: string; id: string }) =>
      [row.period, row.kpi.toLowerCase(), row.id] as const;
    const sorted = [...whole.rows].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return x[0] < y[0]
        ? -1
        : x[0] > y[0]
          ? 1
          : x[1] < y[1]
            ? -1
            : x[1] > y[1]
              ? 1
              : x[2] < y[2]
                ? -1
                : 1;
    });
    expect(whole.rows.map((row) => row.id)).toEqual(sorted.map((row) => row.id));
    // within the first month, alpha comes before Zeta
    const january = whole.rows.filter((row) => row.period === '2026-01-31').map((row) => row.kpi);
    expect(january.indexOf(alpha.name)).toBeLessThan(january.indexOf(zeta.name));

    for (const pageSize of [1, 2, 5, 7]) {
      const walked: string[] = [];
      for (let page = 0; page * pageSize < whole.total; page++) {
        const next = await read(w, {}, w.people.plain, { page, pageSize });
        expect(next.total).toBe(whole.total);
        walked.push(...next.rows.map((row) => row.id));
      }
      expect(walked, `pageSize ${pageSize}`).toEqual(whole.rows.map((row) => row.id));
    }
    // a page past the end is empty with the same total; a pageSize over the total holds everything
    expect(await read(w, {}, w.people.plain, { page: 50, pageSize: 5 })).toMatchObject({
      rows: [],
      total: 18,
    });
    expect((await read(w, {}, w.people.plain, { page: 0, pageSize: 100 })).rows).toHaveLength(18);
  });
});

describe('reads.grid: the effective set with the values of one month [ASVS-8.2.1]', () => {
  const grid = (
    w: IngestionWorld,
    period = '2026-01',
    who: Actor = w.people.plain,
    service = w.svc.id,
  ) => w.ingestion.reads.grid(who, service, period);

  it('is refused for an anonymous caller (401) and a person without the read permission (403), and 404 for a service that does not exist', async () => {
    const w = await seeded();
    await expect(grid(w, '2026-01', anonymous)).rejects.toBeInstanceOf(Unauthorized);
    await expect(grid(w, '2026-01', await w.actor())).rejects.toBeInstanceOf(Forbidden);
    const missing = '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10';
    await expect(grid(w, '2026-01', w.people.plain, missing)).rejects.toBeInstanceOf(NotFound);
    expect(paths(await rejection(grid(w, '2026-01', w.people.plain, 'not-an-id')))).toEqual([
      'query:service',
    ]);
  });

  it('has every indicator of the effective set, in its order, with the stored value of the month or null, bounds and necessity', async () => {
    const w = await seeded();
    const january = await grid(w, '2026-01');
    expect(january.period).toBe('2026-01-31');
    const byName = new Map(january.rows.map((row) => [row.name, row]));
    // the set's four and the extra, nothing outside the set
    expect(january.rows).toHaveLength(5);
    expect(byName.has(w.ind.outside.name)).toBe(false);
    expect(byName.get(w.ind.downloads.name)).toMatchObject({
      necessity: MANDATORY_NECESSITY,
      valueType: 'integer',
      unit: 'count',
      min: 0,
      max: 1_000_000,
      measurement: { value: '100', valueNumber: 100 },
    });
    expect(byName.get(w.ind.uptime.name)!.measurement).toMatchObject({
      value: '01-01-01',
      valueNumber: 3661,
    });
    expect(byName.get(w.ind.note.name)!.measurement).toMatchObject({
      value: 'all well',
      valueNumber: null,
    });
    expect(byName.get(w.ind.ratio.name)).toMatchObject({
      necessity: 'optional',
      measurement: null,
    });
    // a month with only some values; the others are null, not missing
    const april = await grid(w, '2026-04-17');
    expect(april.period).toBe('2026-04-30');
    expect(april.rows.filter((row) => row.measurement !== null).map((row) => row.name)).toEqual([
      w.ind.downloads.name,
    ]);
    // a month with nothing
    expect((await grid(w, '2025-01')).rows.every((row) => row.measurement === null)).toBe(true);
    // a service without KPIs has no rows
    const bare = await makeService(w.pool, { provider: w.provider.id });
    expect((await grid(w, '2026-01', w.people.plain, bare.id)).rows).toEqual([]);
  });

  it('is 422 naming `period` for a bad month, and shows nothing of another service', async () => {
    const w = await seeded();
    for (const period of ['', '2026-13', 'june', '2026-02-30'])
      expect(paths(await rejection(grid(w, period))), period).toEqual(['query:period']);
    await w.put(w.ind.downloads, '2026-01-31', 7771234, w.elsewhereSvc.id);
    const january = await grid(w, '2026-01');
    expect(january.rows.map((row) => row.measurement?.valueNumber)).not.toContain(7771234);
  });
});

describe('reads.coverage: the last months and the mandatory values [ASVS-8.2.1]', () => {
  const coverage = (
    w: IngestionWorld,
    months?: number,
    who: Actor = w.people.plain,
    service = w.svc.id,
  ) => w.ingestion.reads.coverage(who, service, months);

  it('is refused for an anonymous caller (401) and a person without the read permission (403), and 404 for a service that does not exist', async () => {
    const w = await seeded();
    await expect(coverage(w, 12, anonymous)).rejects.toBeInstanceOf(Unauthorized);
    await expect(coverage(w, 12, await w.actor())).rejects.toBeInstanceOf(Forbidden);
    await expect(
      coverage(w, 12, w.people.plain, '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10'),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('has twelve months ending at the current one, oldest first, and says which have every mandatory value', async () => {
    const w = await seeded(); // the clock stands at 2026-06-15
    const months = await coverage(w);
    expect(months).toHaveLength(12);
    expect(months[0]!.period).toBe('2025-07-31');
    expect(months[11]!.period).toBe('2026-06-30');
    const at = (period: string) => months.find((month) => month.period === period)!;
    // downloads is the one mandatory indicator and has a value for January to June
    expect(at('2026-01-31')).toEqual({
      period: '2026-01-31',
      reported: 4, // downloads, share, uptime, note
      mandatory: 1,
      mandatoryReported: 1,
      complete: true,
    });
    expect(at('2026-02-28')).toMatchObject({ reported: 2, mandatoryReported: 1, complete: true });
    expect(at('2025-12-31')).toEqual({
      period: '2025-12-31',
      reported: 0,
      mandatory: 1,
      mandatoryReported: 0,
      complete: false,
    });
    expect(months.filter((month) => month.complete).map((month) => month.period)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('counts only the indicators of the effective set, follows the clock, and takes a number of months', async () => {
    const w = await seeded();
    await w.put(w.ind.outside, '2026-06-30', 1); // not in the set: counts for nothing
    expect((await coverage(w)).at(-1)).toMatchObject({ period: '2026-06-30', reported: 1 });
    expect(await coverage(w, 1)).toHaveLength(1);
    expect((await coverage(w, 36))[0]!.period).toBe('2023-07-31');
    w.clock.set('2027-01-10T00:00:00Z');
    const later = await coverage(w, 3);
    expect(later.map((month) => month.period)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
    for (const bad of [0, 37, 1.5, -1])
      expect(paths(await rejection(coverage(w, bad))), String(bad)).toEqual(['query:months']);
  });

  it('is complete while nothing is mandatory, and empty of counts for a service without KPIs', async () => {
    const w = await seeded();
    const bare = await makeService(w.pool, { provider: w.provider.id });
    const months = await coverage(w, 2, w.people.plain, bare.id);
    expect(months).toEqual([
      { period: '2026-05-31', reported: 0, mandatory: 0, mandatoryReported: 0, complete: true },
      { period: '2026-06-30', reported: 0, mandatory: 0, mandatoryReported: 0, complete: true },
    ]);
  });
});

describe('reads.seriesAsSystem: the trusted series read of kpi.analytics', () => {
  const series = (
    w: IngestionWorld,
    ids: string[],
    from: string,
    to: string,
    serviceId = w.svc.id,
  ) => w.ingestion.reads.seriesAsSystem(serviceId, ids, from, to);

  it('returns the stored values of the months asked, both ends included, with the number and the canonical text, and nothing else', async () => {
    const w = await seeded();
    const points = await series(
      w,
      [w.ind.downloads.id, w.ind.uptime.id, w.ind.note.id],
      '2026-01',
      '2026-02-10',
    );
    expect(points).toEqual([
      { indicatorId: w.ind.downloads.id, period: '2026-01-31', valueNumber: 100, value: '100' },
      { indicatorId: w.ind.note.id, period: '2026-01-31', valueNumber: null, value: 'all well' },
      { indicatorId: w.ind.uptime.id, period: '2026-01-31', valueNumber: 3661, value: '01-01-01' },
      { indicatorId: w.ind.downloads.id, period: '2026-02-28', valueNumber: 101, value: '101' },
      { indicatorId: w.ind.uptime.id, period: '2026-02-28', valueNumber: 7200, value: '02-00-00' },
    ]);
    expect(Object.keys(points[0]!).sort()).toEqual([
      'indicatorId',
      'period',
      'value',
      'valueNumber',
    ]);
  });

  it('is in the stable order: month, then indicator name without case, then id', async () => {
    const w = await seeded();
    const ids = [w.ind.uptime.id, w.ind.downloads.id, w.ind.share.id, w.ind.note.id];
    const names = new Map(
      [w.ind.uptime, w.ind.downloads, w.ind.share, w.ind.note].map((i) => [
        i.id,
        i.name.toLowerCase(),
      ]),
    );
    const points = await series(w, ids, '2026-01', '2026-06');
    const keys = points.map((p) => `${p.period}|${names.get(p.indicatorId)}`);
    expect(keys).toEqual([...keys].sort());
    expect(await series(w, [...ids].reverse(), '2026-01', '2026-06')).toEqual(points);
  });

  it('leaves a month with no value out (the caller lays out its months), and an empty list asks nothing', async () => {
    const w = await seeded();
    const points = await series(w, [w.ind.share.id], '2026-01', '2026-06');
    expect(points.map((p) => p.period)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(await series(w, [], '2026-01', '2026-06')).toEqual([]);
    expect(await series(w, [w.ind.share.id], '2027-01', '2027-06')).toEqual([]);
  });

  it('holds nothing of another service, and still returns a value of an indicator the service dropped', async () => {
    const w = await seeded();
    await w.put(w.ind.downloads, '2026-01-31', 999, w.elsewhereSvc.id);
    await w.put(w.ind.outside, '2026-02-28', 5);
    const mine = await series(w, [w.ind.downloads.id, w.ind.outside.id], '2026-01', '2026-02');
    expect(mine.some((p) => p.valueNumber === 999)).toBe(false);
    expect(mine.find((p) => p.indicatorId === w.ind.outside.id)).toMatchObject({ value: '5' });
  });

  it('checks no permission: it takes no actor, and no route of this module calls it', async () => {
    const w = await seeded();
    expect(w.ingestion.reads.seriesAsSystem.length).toBe(4);
    expect(await series(w, [w.ind.downloads.id], '2026-06', '2026-06')).toHaveLength(1);
  });

  it('is bounded: 120 months and 200 indicators are allowed, one more of either is a 422 that names the argument', async () => {
    const w = await seeded();
    expect(await series(w, [w.ind.downloads.id], '2017-01', '2026-12')).toHaveLength(6);
    expect(paths(await rejection(series(w, [w.ind.downloads.id], '2016-12', '2026-12')))).toEqual([
      'query:toPeriod',
    ]);
    const ids = Array.from(
      { length: 200 },
      (_, n) => `0198f3a8-5b21-7d40-9c1e-${String(n).padStart(12, '0')}`,
    );
    expect(await series(w, ids, '2026-01', '2026-02')).toEqual([]);
    expect(
      paths(await rejection(series(w, [...ids, w.ind.downloads.id], '2026-01', '2026-02'))),
    ).toEqual(['query:indicatorIds']);
  });

  it('is 422 for a bad period, a start after the end, an id that is not an id and a bad service, naming each', async () => {
    const w = await seeded();
    const ok = [w.ind.downloads.id];
    expect(paths(await rejection(series(w, ok, '2026-13', '2026-06')))).toEqual([
      'query:fromPeriod',
    ]);
    expect(paths(await rejection(series(w, ok, '2026-01', 'soon')))).toEqual(['query:toPeriod']);
    expect(paths(await rejection(series(w, ok, '2026-06', '2026-01')))).toEqual([
      'query:fromPeriod',
    ]);
    expect(paths(await rejection(series(w, ['x'], '2026-01', '2026-06')))).toEqual([
      'query:indicatorIds',
    ]);
    expect(paths(await rejection(series(w, ok, '2026-01', '2026-06', 'nope')))).toEqual([
      'query:service',
    ]);
  });
});

describe('reads.measuredIndicatorsAsSystem: which indicators have values in a window', () => {
  const measured = (w: IngestionWorld, from: string, to: string, serviceId = w.svc.id) =>
    w.ingestion.reads.measuredIndicatorsAsSystem(serviceId, from, to);

  it('names each indicator with a value in the window once, sorted by id, a dropped one included, and nothing of another service', async () => {
    const w = await seeded();
    await w.put(w.ind.outside, '2026-02-28', 5);
    await w.put(w.ind.share, '2026-01-31', 1, w.elsewhereSvc.id);
    const ids = await measured(w, '2026-01', '2026-06');
    expect(ids).toEqual(
      [w.ind.downloads.id, w.ind.share.id, w.ind.uptime.id, w.ind.note.id, w.ind.outside.id].sort(),
    );
    expect(await measured(w, '2026-04', '2026-04')).toEqual([w.ind.downloads.id]);
    expect(await measured(w, '2027-01', '2027-02')).toEqual([]);
    expect(await measured(w, '2026-01', '2026-06', w.elsewhereSvc.id)).toEqual([w.ind.share.id]);
  });

  it('has the bounds and the 422 of seriesAsSystem', async () => {
    const w = await seeded();
    expect(paths(await rejection(measured(w, '2026-13', '2026-06')))).toEqual(['query:fromPeriod']);
    expect(paths(await rejection(measured(w, '2016-12', '2026-12')))).toEqual(['query:toPeriod']);
    expect(paths(await rejection(measured(w, '2026-01', '2026-06', 'nope')))).toEqual([
      'query:service',
    ]);
  });
});
