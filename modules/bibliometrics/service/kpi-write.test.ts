// The two Bibliographic KPIs (M16 sprint 3, ADR-0056 decisions 5 and 7 as amended, ADR-0057) over real Postgres with the real
// kpi.framework and kpi.ingestion. Citations: the month's new citations, the total minus what earlier months hold (the whole total the
// first time), negative when the total fell, and only when every publication was found in this refresh. Publications: the count per
// month from the first publication to now, by the provider's date or the agency's month, skipped while a month is unknown. Both only
// for a service whose KPI set holds the indicator; the settings refuse an indicator that is not numeric or not Bibliographic, and the
// same indicator for both, with a 422; and only the refresh calls the trusted write.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DomainError, type UserActor } from '@scorpion/contracts';
import { createStubOpenAlex, type DoiResolver } from '@scorpion/integrations';
import { makeIndicator, makeKpiSet, makePublication, makeServiceKpis } from '@scorpion/testing';
import { describe, expect, it, vi } from 'vitest';
import { uniqueDoi, useBibliometrics, world } from '../test/harness.ts';
import { KPI_SOURCE, publicationMonths } from './kpi-write.ts';

const h = useBibliometrics();
const NOW = new Date('2026-06-15T12:00:00Z');
const okResolver: DoiResolver = {
  resolve: () =>
    Promise.resolve({
      status: 'ok',
      metadata: {
        title: 'A paper',
        authors: [],
        issued: null,
        container: null,
        type: 'journal-article',
      },
    } as never),
};

let n = 0;
const uniq = (label: string) => `${label} ${++n} ${Math.random().toString(36).slice(2, 7)}`;

type Kpi = { citationsIndicatorId?: string; publicationsIndicatorId?: string };
type Dated = { issued: string; precision: 'year' | 'month' | 'day' } | { given: string } | null;

/**
 * A started module whose OpenAlex answers from `counts` (changed between runs), a service whose KPI set holds a citations and a
 * publications indicator, a service with no KPIs, and indicators the settings must refuse.
 */
async function kpiWorld(options: { clock?: () => Date } = {}) {
  const counts: Record<string, number> = {};
  const s = await h.start({
    openAlex: () => createStubOpenAlex({ ...counts }),
    resolver: okResolver,
    clock: options.clock ?? (() => NOW),
  });
  const w = await world(s);
  const indicator = (name: string, valueType: string, thematic: string, qualitative = false) =>
    makeIndicator(w.pool, { name: uniq(name), valueType, thematic, qualitative });
  const citations = await indicator('Citations', 'integer', 'Bibliographic');
  const publications = await indicator('Publications', 'integer', 'Bibliographic');
  const usage = await indicator('Visits', 'integer', 'Usage');
  const note = await indicator('Remark', 'text', 'Bibliographic', true);
  const set = await makeKpiSet(w.pool, {
    name: uniq('Set'),
    indicators: [
      { indicatorId: citations.id, necessity: 'optional' },
      { indicatorId: publications.id, necessity: 'optional' },
    ],
  });
  await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id, extras: [] });
  const settings = w.settingsAdmin();
  const save = async (kpi: Kpi | undefined, who: UserActor = w.people.admin) => {
    const current = await settings.get(w.people.admin, 'bibliometrics');
    return settings.update(who, 'bibliometrics', {
      version: current.version,
      values: kpi ? { kpi } : {},
    });
  };
  /** A publication with a count (or none), dated by the agency (`issued`), by a provider (`given`), or not at all. */
  const add = async (serviceId: string, count: number | undefined, dated: Dated = null) => {
    const doi = uniqueDoi('kpi');
    await makePublication(w.pool, {
      serviceId,
      doi,
      ...(dated && 'given' in dated
        ? { issued: `${dated.given}-01`, issuedPrecision: 'month' as const }
        : {}),
      metadata:
        dated && 'issued' in dated
          ? { issued: dated.issued, issuedPrecision: dated.precision }
          : { issued: null, issuedPrecision: null },
    });
    if (count !== undefined) counts[doi] = count;
    return doi;
  };
  const stored = async (serviceId: string, indicatorId: string) =>
    (
      await w.pool.query<{ period: string; value: string; source: string; updated_by: string }>(
        `select to_char(period, 'YYYY-MM') as period, value_numeric::text as value, source, updated_by
           from kpii_measurement where service_id = $1 and indicator_id = $2 order by period`,
        [serviceId, indicatorId],
      )
    ).rows;
  const values = async (serviceId: string, indicatorId: string) =>
    Object.fromEntries(
      (await stored(serviceId, indicatorId)).map((row) => [row.period, Number(row.value)]),
    );
  const refresh = (serviceIds?: string[]) =>
    w.biblio.citations.refresh(serviceIds ? 'manual' : 'schedule', { serviceIds });
  return {
    ...w,
    counts,
    ind: { citations, publications, usage, note },
    save,
    add,
    stored,
    values,
    refresh,
  };
}

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('publicationMonths', () => {
  const now = new Date('2026-06-15T00:00:00Z');
  it.each([
    [[], undefined, []],
    [['2026-06'], undefined, [['2026-06', 1]]],
    [
      ['2026-03', '2026-05', '2026-05'],
      undefined,
      [
        ['2026-03', 1],
        ['2026-04', 0],
        ['2026-05', 2],
        ['2026-06', 0],
      ],
    ],
    // A month after this one counts in this one; a month before 1900 in January 1900.
    [['2027-01'], undefined, [['2026-06', 1]]],
    // An earlier month the indicator holds starts the range, so a month whose publication was removed goes back to 0.
    [
      ['2026-05'],
      '2026-03',
      [
        ['2026-03', 0],
        ['2026-04', 0],
        ['2026-05', 1],
        ['2026-06', 0],
      ],
    ],
    [
      [],
      '2026-05',
      [
        ['2026-05', 0],
        ['2026-06', 0],
      ],
    ],
  ] as const)('%j (stored from %s)', (months, first, expected) => {
    expect(publicationMonths(months, first, now)).toEqual(
      expected.map(([period, value]) => ({ period, value })),
    );
  });
  it('starts no earlier than January 1900', () => {
    expect(publicationMonths(['1899-07'], undefined, new Date('1900-02-01T00:00:00Z'))).toEqual([
      { period: '1900-01', value: 1 },
      { period: '1900-02', value: 0 },
    ]);
  });
});

describe('the citations KPI', () => {
  it('writes the whole total the first time, for a service with the indicator in its set and every publication found', async () => {
    const w = await kpiWorld();
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    await w.add(w.svc.id, 300);
    await w.add(w.svc.id, 12);
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({
      citationsKpi: 'on',
      citationsWritten: 1,
      citationsSkippedNotInSet: 0,
      citationsSkippedIncomplete: 0,
      publicationsKpi: 'off',
      kpiFailed: 0,
    });
    expect(await w.stored(w.svc.id, w.ind.citations.id)).toEqual([
      { period: '2026-06', value: '312', source: KPI_SOURCE, updated_by: null },
    ]);
  });

  it('writes the new citations of the next month, so the months add up to the total, negative when the total fell', async () => {
    let now = new Date('2026-04-10T12:00:00Z');
    const w = await kpiWorld({ clock: () => now });
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    const doi = await w.add(w.svc.id, 100);
    await w.refresh([w.svc.id]);
    now = new Date('2026-05-10T12:00:00Z');
    w.counts[doi] = 130;
    await w.refresh([w.svc.id]);
    now = new Date('2026-06-10T12:00:00Z');
    w.counts[doi] = 125;
    await w.refresh([w.svc.id]);
    expect(await w.values(w.svc.id, w.ind.citations.id)).toEqual({
      '2026-04': 100,
      '2026-05': 30,
      '2026-06': -5,
    });
  });

  it('replaces the month on a second run in it: one row, measured against the earlier months only', async () => {
    let now = new Date('2026-05-10T12:00:00Z');
    const w = await kpiWorld({ clock: () => now });
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    const doi = await w.add(w.svc.id, 10);
    await w.refresh([w.svc.id]);
    now = new Date('2026-06-02T12:00:00Z');
    w.counts[doi] = 14;
    await w.refresh([w.svc.id]);
    now = new Date('2026-06-09T12:00:00Z');
    w.counts[doi] = 15;
    await w.refresh([w.svc.id]);
    expect(await w.values(w.svc.id, w.ind.citations.id)).toEqual({ '2026-05': 10, '2026-06': 5 });
  });

  it('counts a value a person entered in an earlier month, so the sum still equals the total', async () => {
    const w = await kpiWorld();
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    await w.biblio.publications.list(w.people.admin, w.svc.id, { page: 0, pageSize: 5 });
    const ingestion = w.kernel.services.get('kpi.ingestion') as {
      measurements: {
        upsertBatch: (...args: unknown[]) => Promise<unknown>;
      };
    };
    await ingestion.measurements.upsertBatch(
      w.people.member,
      w.svc.id,
      [{ indicator: w.ind.citations.id, period: '2026-02', value: 40 }],
      { source: 'form' },
    );
    await w.add(w.svc.id, 50);
    await w.refresh([w.svc.id]);
    expect(await w.values(w.svc.id, w.ind.citations.id)).toEqual({ '2026-02': 40, '2026-06': 10 });
  });

  it('skips and counts a service with one publication the source does not know, and never writes a partial total', async () => {
    const w = await kpiWorld();
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    await w.add(w.svc.id, 300);
    await w.add(w.svc.id, undefined);
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({ citationsWritten: 0, citationsSkippedIncomplete: 1 });
    expect(await w.stored(w.svc.id, w.ind.citations.id)).toEqual([]);
  });

  it('counts only this refresh: an old count of a DOI not found now does not complete the total', async () => {
    let now = new Date('2026-06-01T12:00:00Z');
    const w = await kpiWorld({ clock: () => now });
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    const doi = await w.add(w.svc.id, 5);
    await w.add(w.svc.id, 7);
    await w.refresh([w.svc.id]);
    delete w.counts[doi];
    now = new Date('2026-06-08T12:00:00Z');
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({ citationsWritten: 0, citationsSkippedIncomplete: 1 });
    expect(await w.values(w.svc.id, w.ind.citations.id)).toEqual({ '2026-06': 12 });
  });

  it('skips and counts a service whose KPI set does not hold the indicator', async () => {
    const w = await kpiWorld();
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    await w.add(w.elsewhereSvc.id, 4);
    await w.add(w.svc.id, 6);
    const report = await w.refresh();
    expect(report).toMatchObject({ citationsWritten: 1, citationsSkippedNotInSet: 1 });
    expect(await w.stored(w.elsewhereSvc.id, w.ind.citations.id)).toEqual([]);
  });

  it('writes nothing with the settings empty, and says so in the report', async () => {
    const w = await kpiWorld();
    await w.add(w.svc.id, 9, { given: '2026-01' });
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({
      citationsKpi: 'off',
      citationsWritten: 0,
      publicationsKpi: 'off',
      publicationsWritten: 0,
    });
    expect(await w.stored(w.svc.id, w.ind.citations.id)).toEqual([]);
    expect(await w.stored(w.svc.id, w.ind.publications.id)).toEqual([]);
  });

  it('writes nothing when the indicator was moved out of Bibliographic after it was chosen', async () => {
    const w = await kpiWorld();
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    await w.pool.query(`update kpif_indicator set thematic = 'Usage' where id = $1`, [
      w.ind.citations.id,
    ]);
    await w.add(w.svc.id, 9);
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({ citationsKpi: 'unusable', citationsWritten: 0 });
    expect(await w.stored(w.svc.id, w.ind.citations.id)).toEqual([]);
  });
});

describe('the publications KPI', () => {
  it('writes every month from the first publication to now, by the provider date, else the agency month or day', async () => {
    const w = await kpiWorld();
    await w.save({ publicationsIndicatorId: w.ind.publications.id });
    await w.add(w.svc.id, undefined, { issued: '2026-02-17', precision: 'day' });
    await w.add(w.svc.id, undefined, { issued: '2026-04-01', precision: 'month' });
    await w.add(w.svc.id, undefined, { given: '2026-04' });
    // The provider's month wins over the agency's year.
    const both = await w.add(w.svc.id, undefined, { issued: '2020-01-01', precision: 'year' });
    await w.pool.query(
      `update biblio_publication set issued = '2026-06-01', issued_precision = 'month' where doi = $1`,
      [both],
    );
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({
      publicationsKpi: 'on',
      publicationsWritten: 1,
      publicationsSkippedUndated: 0,
      // Citations are off, and a publication without a count does not stop the publications KPI.
      citationsKpi: 'off',
    });
    expect(await w.values(w.svc.id, w.ind.publications.id)).toEqual({
      '2026-02': 1,
      '2026-03': 0,
      '2026-04': 2,
      '2026-05': 0,
      '2026-06': 1,
    });
  });

  it('skips and counts a service with a publication of no known month (a year, or no date), until the provider gives it', async () => {
    const w = await kpiWorld();
    await w.save({ publicationsIndicatorId: w.ind.publications.id });
    await w.add(w.svc.id, undefined, { given: '2026-03' });
    const yearOnly = await w.add(w.svc.id, undefined, { issued: '2025-01-01', precision: 'year' });
    expect(await w.refresh([w.svc.id])).toMatchObject({
      publicationsWritten: 0,
      publicationsSkippedUndated: 1,
    });
    expect(await w.stored(w.svc.id, w.ind.publications.id)).toEqual([]);
    const listed = await w.biblio.publications.list(w.people.member, w.svc.id, {
      page: 0,
      pageSize: 5,
    });
    expect(listed.undated).toBe(1);
    const row = listed.items.find((item) => item.doi === yearOnly)!;
    expect(row.monthKnown).toBe(false);
    await w.biblio.publications.setIssued(w.people.member, w.svc.id, row.id, '2025-11');
    expect(await w.refresh([w.svc.id])).toMatchObject({ publicationsWritten: 1 });
    expect(Object.keys(await w.values(w.svc.id, w.ind.publications.id))).toHaveLength(8);
  });

  it('sets a month back to 0 when its publication is removed, and writes a long history in batches', async () => {
    const w = await kpiWorld();
    await w.save({ publicationsIndicatorId: w.ind.publications.id });
    // 1995-03 to 2026-06 is 376 months: four batches of at most 120.
    const old = await w.add(w.svc.id, undefined, { given: '1995-03' });
    await w.add(w.svc.id, undefined, { given: '2026-05' });
    await w.refresh([w.svc.id]);
    let values = await w.values(w.svc.id, w.ind.publications.id);
    expect(Object.keys(values)).toHaveLength(376);
    expect(values['1995-03']).toBe(1);
    const [row] = (
      await w.pool.query<{ id: string }>('select id from biblio_publication where doi = $1', [old])
    ).rows;
    await w.biblio.publications.remove(w.people.member, w.svc.id, row!.id);
    await w.refresh([w.svc.id]);
    values = await w.values(w.svc.id, w.ind.publications.id);
    expect(values['1995-03']).toBe(0);
    expect(Object.values(values).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('skips and counts a service whose KPI set does not hold the indicator', async () => {
    const w = await kpiWorld();
    await w.save({ publicationsIndicatorId: w.ind.publications.id });
    await w.add(w.elsewhereSvc.id, undefined, { given: '2026-01' });
    expect(await w.refresh([w.elsewhereSvc.id])).toMatchObject({
      publicationsWritten: 0,
      publicationsSkippedNotInSet: 1,
    });
  });

  it('puts both into the report of the job', async () => {
    const w = await kpiWorld();
    await w.save({
      citationsIndicatorId: w.ind.citations.id,
      publicationsIndicatorId: w.ind.publications.id,
    });
    await w.add(w.svc.id, 1, { given: '2026-06' });
    const def = w.manifest.jobs!.find((job) => job.name === 'bibliometrics.citations.refresh')!;
    const report = await def.handler(
      {
        id: crypto.randomUUID(),
        name: def.name,
        data: { trigger: 'manual', serviceIds: [w.svc.id] },
        attempt: 1,
        signal: new AbortController().signal,
      },
      { jobs: { enqueue: () => Promise.resolve('job') } } as never,
    );
    expect(report).toMatchObject({
      citationsKpi: 'on',
      citationsWritten: 1,
      citationsSkippedNotInSet: 0,
      citationsSkippedIncomplete: 0,
      publicationsKpi: 'on',
      publicationsWritten: 1,
      publicationsSkippedNotInSet: 0,
      publicationsSkippedUndated: 0,
      kpiFailed: 0,
    });
  });
});

describe('the KPI settings', () => {
  it('take a numeric indicator in the category Bibliographic for each', async () => {
    const w = await kpiWorld();
    const saved = await w.save({
      citationsIndicatorId: w.ind.citations.id,
      publicationsIndicatorId: w.ind.publications.id,
    });
    expect(saved.values).toMatchObject({
      kpi: {
        citationsIndicatorId: w.ind.citations.id,
        publicationsIndicatorId: w.ind.publications.id,
      },
    });
  });

  it('are a 422 on the field for an indicator outside Bibliographic, a text indicator, an unknown id, and one indicator for both', async () => {
    const w = await kpiWorld();
    const cases: [Kpi, string, string][] = [
      [
        { citationsIndicatorId: w.ind.usage.id },
        'values.kpi.citationsIndicatorId',
        'must be an indicator in the thematic category Bibliographic',
      ],
      [
        { publicationsIndicatorId: w.ind.note.id },
        'values.kpi.publicationsIndicatorId',
        'must be an indicator with a numeric value type',
      ],
      [
        { citationsIndicatorId: crypto.randomUUID() },
        'values.kpi.citationsIndicatorId',
        'is not an indicator',
      ],
      [
        { citationsIndicatorId: w.ind.citations.id, publicationsIndicatorId: w.ind.citations.id },
        'values.kpi.publicationsIndicatorId',
        'must be another indicator than the citations KPI',
      ],
    ];
    for (const [kpi, path, message] of cases) {
      const error = await rejection(w.save(kpi));
      expect(error.status).toBe(422);
      expect(error.errors).toEqual([{ in: 'body', path, message }]);
    }
    expect((await w.settingsAdmin().get(w.people.admin, 'bibliometrics')).version).toBe(0);
  });

  it('still let an administrator save another setting after the chosen indicator changed category', async () => {
    const w = await kpiWorld();
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    await w.pool.query(`update kpif_indicator set thematic = 'Usage' where id = $1`, [
      w.ind.citations.id,
    ]);
    const settings = w.settingsAdmin();
    const current = await settings.get(w.people.admin, 'bibliometrics');
    const saved = await settings.update(w.people.admin, 'bibliometrics', {
      version: current.version,
      values: { enabled: false, kpi: { citationsIndicatorId: w.ind.citations.id } },
    });
    expect(saved.values).toMatchObject({ enabled: false });
  });

  it('are saved by an administrator only', async () => {
    const w = await kpiWorld();
    expect(
      (await rejection(w.save({ citationsIndicatorId: w.ind.citations.id }, w.people.member)))
        .status,
    ).toBe(403);
  });
});

describe('the trusted write', () => {
  it('is called by the refresh only: add, list, remove, check now and the history never write a KPI', async () => {
    const w = await kpiWorld();
    await w.save({ citationsIndicatorId: w.ind.citations.id });
    const ingestion = w.kernel.services.get('kpi.ingestion') as {
      measurements: { upsertBatchAsSystem: (...args: unknown[]) => Promise<unknown> };
    };
    const spy = vi.spyOn(ingestion.measurements, 'upsertBatchAsSystem');
    try {
      const added = await w.biblio.publications.add(w.people.member, w.svc.id, uniqueDoi('only'));
      await w.biblio.publications.list(w.people.member, w.svc.id, { page: 0, pageSize: 5 });
      await w.biblio.citations.history(w.people.member, w.svc.id, added.id);
      await w.biblio.citations.requestRefresh(w.people.member, w.svc.id);
      await w.biblio.publications.setIssued(w.people.member, w.svc.id, added.id, '2024-03');
      await w.biblio.publications.remove(w.people.member, w.svc.id, added.id);
      expect(spy).not.toHaveBeenCalled();
      await w.add(w.svc.id, 3);
      await w.refresh([w.svc.id]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![2]).toEqual({ source: KPI_SOURCE });
    } finally {
      spy.mockRestore();
    }
  });

  it('is named in the source by the kpi write only, in the whole repository outside kpi.ingestion [ASVS-8.2.1]', () => {
    const repo = new URL('../../../', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|svelte|js)$/.test(name) && !/\.test\.ts$|\.d\.ts$/.test(name))
          files.push(path);
      }
    };
    for (const top of ['apps', 'modules', 'packages', 'tools']) walk(join(repo, top));
    const callers = files
      .filter((file) => readFileSync(file, 'utf8').includes('upsertBatchAsSystem'))
      .map((file) => relative(repo, file))
      .filter((file) => !file.startsWith('modules/kpi-ingestion/'))
      .sort();
    expect(callers).toEqual(['modules/bibliometrics/service/kpi-write.ts']);
    // In the module, `writeKpi` is called from `refresh` only.
    const citations = readFileSync(
      join(repo, 'modules/bibliometrics/service/citations.ts'),
      'utf8',
    );
    expect(citations.match(/writeKpi\(/g)).toHaveLength(1);
    const refreshBody = citations.slice(
      citations.indexOf('async refresh(trigger'),
      citations.indexOf('async requestRefresh('),
    );
    expect(refreshBody).toContain('writeKpi(');
  });
});
