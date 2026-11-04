// The yearly table on real Postgres (M12 sprint 2): who may read, the 422s, each state one by one, a KPI set changed during the year, the year
// boundary, the order and the paging, the same service in two consortia, a consortium of no services and the published switch. The numbers
// here are the reference the stored model of sprint 3 must reproduce.
import { Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeIndicator, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useImpact } from '../test/harness.ts';
import { headlineSet, paths, rejection, serviceWith, uniq } from '../test/world.ts';

const h = useImpact();
const anonymous: Actor = { kind: 'anonymous' };
const ABSENT = '0198f9c0-1234-7abc-8def-0123456789ab';

async function setup() {
  const s = await h.start();
  const reviewer = await s.actor('reviewer');
  const admin = await s.actor('admin');
  const user = await s.actor('user');
  const nobody = await s.actor();
  const consortium = await makeOrganisation(s.pool, { type: 'consortium', name: uniq('Cons') });
  const provider = await makeOrganisation(s.pool, { type: 'provider', name: uniq('Prov') });
  const table = (year: number | string, query: object = {}, actor: Actor = reviewer) =>
    s.impact.table(actor, { consortium: consortium.id, year: String(year), ...query });
  return { ...s, reviewer, admin, user, nobody, consortium, provider, table };
}

const only = <T>(rows: T[]): T => {
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

describe('who may read the table', () => {
  it('refuses an anonymous caller with 401, a user and a person with no role with 403, and serves a Reviewer and Admin [ASVS-8.2.1]', async () => {
    const s = await setup();
    const query = { consortium: s.consortium.id, year: '2026' };
    expect(await rejection(s.impact.table(anonymous, query))).toBeInstanceOf(Unauthorized);
    for (const caller of [s.user, s.nobody])
      expect(await rejection(s.impact.table(caller, query))).toBeInstanceOf(Forbidden);
    for (const caller of [s.reviewer, s.admin])
      expect((await s.impact.table(caller, query)).rows).toEqual([]);
  });

  it('checks the permission before the consortium and the year, so a refused caller learns nothing [ASVS-8.2.1]', async () => {
    const s = await setup();
    for (const query of [
      { consortium: ABSENT, year: '2026' },
      { consortium: s.provider.id, year: '2026' },
      { consortium: s.consortium.id, year: 'abc' },
    ])
      expect(await rejection(s.impact.table(s.user, query))).toBeInstanceOf(Forbidden);
  });

  it('shows names, units and values and no person [ASVS-8.2.1]', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2026-01-31': 3 },
    });
    const view = await s.table(2026);
    const row = only(view.rows);
    expect(Object.keys(row).sort()).toEqual(
      [
        'advice',
        'headline',
        'months',
        'monthsWithValue',
        'name',
        'reason',
        'serviceId',
        'slug',
        'state',
        'yearly',
      ].sort(),
    );
    expect(Object.keys(row.headline!).sort()).toEqual([
      'aggregate',
      'indicatorId',
      'label',
      'name',
      'unit',
    ]);
    expect(Object.keys(view).sort()).toEqual([
      'page',
      'pageSize',
      'rows',
      'totalCount',
      'year',
      'years',
    ]);
  });
});

describe('the parameters', () => {
  it('is a 422 naming consortium for a value that is no id, an unknown id and an organisation that is no consortium', async () => {
    const s = await setup();
    for (const consortium of ['x', '', ABSENT, s.provider.id]) {
      const error = await rejection(s.impact.table(s.reviewer, { consortium, year: '2026' }));
      expect(error.status).toBe(422);
      expect(paths(error)).toEqual(['query:consortium']);
    }
  });

  it('offers the current year and the nine before it, and is a 422 naming year for any other', async () => {
    const s = await setup();
    const view = await s.table(2026);
    expect(view.years).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]);
    for (const year of [2017, 2026]) expect((await s.table(year)).year).toBe(year);
    for (const year of ['2016', '2027', 'abc', '', '2026.5', '02026', '20260', '-2026', ' 2026'])
      expect(paths(await rejection(s.table(year)))).toEqual(['query:year']);
  });

  it('follows the clock: in January the new year is offered and the oldest one is gone', async () => {
    const s = await setup();
    s.clock.set('2027-01-01T00:00:00Z');
    const view = await s.table(2027);
    expect(view.years[0]).toBe(2027);
    expect(view.years).toHaveLength(10);
    expect(paths(await rejection(s.table(2017)))).toEqual(['query:year']);
  });
});

describe('the row states', () => {
  it('ok: a headline with values gives the months, the yearly aggregate and how many months it is over', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool, { aggregate: 'sum' });
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2026-01-31': 3, '2026-02-28': 4, '2026-12-31': 5 },
    });
    const row = only((await s.table(2026)).rows);
    expect(row).toMatchObject({
      state: 'ok',
      reason: 'ok',
      advice: '',
      yearly: 12,
      monthsWithValue: 3,
    });
    expect(row.months).toEqual([3, 4, null, null, null, null, null, null, null, null, null, 5]);
    expect(row.headline).toEqual({
      indicatorId: head.id,
      name: head.name,
      unit: 'count',
      aggregate: 'sum',
      label: 'Sum',
    });
  });

  it('ok: the aggregate is the evaluation’s, from the registry: an average is over the months that have a value', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool, { aggregate: 'avg' });
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2026-03-31': 2, '2026-09-30': 6 },
    });
    expect(only((await s.table(2026)).rows)).toMatchObject({ yearly: 4, monthsWithValue: 2 });
    // the label is the vocabulary's; a language it has no label for falls back to the English one
    expect(only((await s.table(2026, { locale: 'de' })).rows).headline?.label).toBe('Average');
  });

  it('ok: a zero is a value and not a gap', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2026-05-31': 0 },
    });
    expect(only((await s.table(2026)).rows)).toMatchObject({
      state: 'ok',
      yearly: 0,
      monthsWithValue: 1,
    });
  });

  it('no-data: a headline and no value in the year, though another year has values', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2025-06-30': 9 },
    });
    const row = only((await s.table(2026)).rows);
    expect(row).toMatchObject({
      state: 'no-data',
      reason: 'no-values',
      yearly: null,
      monthsWithValue: 0,
    });
    expect(row.months).toEqual(Array.from({ length: 12 }, () => null));
    expect(row.headline).not.toBeNull();
    expect(row.advice).toMatch(/report/i);
  });

  it('no-evaluation: a service with no KPI set', async () => {
    const s = await setup();
    await serviceWith(s.pool, s.consortium.id);
    const row = only((await s.table(2026)).rows);
    expect(row).toMatchObject({
      state: 'no-evaluation',
      reason: 'no-set',
      headline: null,
      yearly: null,
    });
    expect(row.advice).toMatch(/KPI set/);
  });

  it('no-evaluation: a set with no headline', async () => {
    const s = await setup();
    const { set } = await headlineSet(s.pool, { aggregate: null });
    await serviceWith(s.pool, s.consortium.id, { set });
    const row = only((await s.table(2026)).rows);
    expect(row).toMatchObject({ state: 'no-evaluation', reason: 'no-headline', headline: null });
    expect(row.advice).toMatch(/headline/);
  });

  it('no-evaluation, not error: a headline indicator removed from the set takes the evaluation with it, though its values stay', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    const keep = await makeIndicator(s.pool, { name: uniq('Keep') });
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2026-01-31': 3 },
    });
    await s.kpi.sets.setIndicators(s.admin, set.id, {
      indicators: [{ indicatorId: keep.id, necessity: 'mandatory' }],
    });
    expect(only((await s.table(2026)).rows)).toMatchObject({
      state: 'no-evaluation',
      reason: 'no-headline',
    });
  });

  it('error: a text headline is not numeric, whatever the values', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool, {
      valueType: 'text',
      aggregate: null,
      unit: null,
    });
    await s.pool.query(
      'insert into kpif_evaluation (set_id, indicator_id, aggregate) values ($1, $2, $3)',
      [set.id, head.id, 'sum'],
    );
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2026-01-31': 'fine' },
    });
    const row = only((await s.table(2026)).rows);
    expect(row).toMatchObject({ state: 'error', reason: 'not-numeric', yearly: null });
    expect(row.headline?.name).toBe(head.name);
    expect(row.advice).toMatch(/numeric/);
  });

  it('error: an aggregate the value type does not allow, and an error of one row never fails the others', async () => {
    const s = await setup();
    const bad = await headlineSet(s.pool, { valueType: 'percentage', aggregate: null });
    await s.pool.query(
      'insert into kpif_evaluation (set_id, indicator_id, aggregate) values ($1, $2, $3)',
      [bad.set.id, bad.head.id, 'zzz'],
    );
    const good = await headlineSet(s.pool);
    await serviceWith(s.pool, s.consortium.id, { name: 'a bad one', set: bad.set });
    await serviceWith(s.pool, s.consortium.id, {
      name: 'b good one',
      set: good.set,
      headId: good.head.id,
      values: { '2026-02-28': 8 },
    });
    const [first, second] = (await s.table(2026)).rows;
    expect(first).toMatchObject({ state: 'error', reason: 'aggregate-not-allowed' });
    expect(second).toMatchObject({ state: 'ok', yearly: 8 });
  });

  it('is exactly one state per row, and each says what to do except ok', async () => {
    const s = await setup();
    const full = await headlineSet(s.pool);
    const empty = await headlineSet(s.pool);
    const noHead = await headlineSet(s.pool, { aggregate: null });
    await serviceWith(s.pool, s.consortium.id, {
      name: 'a',
      set: full.set,
      headId: full.head.id,
      values: { '2026-01-31': 1 },
    });
    await serviceWith(s.pool, s.consortium.id, { name: 'b', set: empty.set });
    await serviceWith(s.pool, s.consortium.id, { name: 'c', set: noHead.set });
    await serviceWith(s.pool, s.consortium.id, { name: 'd' });
    const { rows } = await s.table(2026);
    expect(rows.map((row) => row.state)).toEqual([
      'ok',
      'no-data',
      'no-evaluation',
      'no-evaluation',
    ]);
    expect(rows.map((row) => row.advice === '')).toEqual([true, false, false, false]);
  });
});

describe('the evaluation applies to every year', () => {
  it('reads a service whose KPI set changed during the year with today’s headline, ignoring the old one', async () => {
    const s = await setup();
    const old = await headlineSet(s.pool, { aggregate: 'sum' });
    const now = await headlineSet(s.pool, { aggregate: 'max' });
    const service = await serviceWith(s.pool, s.consortium.id, { set: old.set });
    for (const [indicatorId, period, value] of [
      [old.head.id, '2026-02-28', 100],
      [old.head.id, '2026-03-31', 100],
      [now.head.id, '2026-04-30', 7],
      [now.head.id, '2026-05-31', 9],
    ] as const)
      await s.pool.query(
        'insert into kpii_measurement (id, service_id, indicator_id, period, value_numeric, source) values (gen_random_uuid(), $1, $2, $3, $4, $5)',
        [service.id, indicatorId, period, value, 'test'],
      );
    // in the middle of the year the service moves to the other set
    await s.pool.query('update kpif_service_set set set_id = $2 where service_id = $1', [
      service.id,
      now.set.id,
    ]);
    const row = only((await s.table(2026)).rows);
    expect(row.headline).toMatchObject({ indicatorId: now.head.id, aggregate: 'max' });
    expect(row).toMatchObject({ state: 'ok', yearly: 9, monthsWithValue: 2 });
    expect(row.months[1]).toBeNull();
    expect(row.months[3]).toBe(7);
  });

  it('reads the values of a KPI the service has since dropped, if it is still the headline of its set', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    const service = await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2020-07-31': 5 },
    });
    expect(service.id).toBeDefined();
    expect(only((await s.table(2020)).rows)).toMatchObject({ state: 'ok', yearly: 5 });
  });
});

describe('the year boundary', () => {
  it('puts 31 December in the year it ends and 31 January in the next, never in both', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2024-12-31': 4, '2025-01-31': 6 },
    });
    const before = only((await s.table(2024)).rows);
    const after = only((await s.table(2025)).rows);
    expect(before.months[11]).toBe(4);
    expect(before).toMatchObject({ yearly: 4, monthsWithValue: 1 });
    expect(after.months[0]).toBe(6);
    expect(after.months[11]).toBeNull();
    expect(after).toMatchObject({ yearly: 6, monthsWithValue: 1 });
  });

  it('knows a leap February: 29 February is the month of February in 2024', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2024-02-29': 2 },
    });
    expect(only((await s.table(2024)).rows).months[1]).toBe(2);
  });
});

describe('the order, the paging and the sets of services', () => {
  it('lists services by name without case, then id', async () => {
    const s = await setup();
    const tag = Math.random().toString(36).slice(2, 8);
    const names = [`bravo ${tag}`, `Alpha ${tag}`, `alpha ${tag}`, `Charlie ${tag}`];
    const made = [];
    for (const name of names) made.push(await serviceWith(s.pool, s.consortium.id, { name }));
    const { rows } = await s.table(2026);
    const equal = made
      .filter((service) => service.name.toLowerCase().startsWith('alpha'))
      .map((service) => service.id)
      .sort();
    expect(rows.map((row) => row.name.toLowerCase())).toEqual([
      `alpha ${tag}`,
      `alpha ${tag}`,
      `bravo ${tag}`,
      `charlie ${tag}`,
    ]);
    expect(rows.slice(0, 2).map((row) => row.serviceId)).toEqual(equal);
  });

  it('pages: totalCount counts every service, a page is a slice in the same order, a page past the end is empty', async () => {
    const s = await setup();
    for (const name of ['e', 'a', 'd', 'b', 'c'])
      await serviceWith(s.pool, s.consortium.id, { name });
    const all = (await s.table(2026)).rows.map((row) => row.name);
    expect(all).toEqual(['a', 'b', 'c', 'd', 'e']);
    const pages = [];
    for (const page of [0, 1, 2, 3]) pages.push(await s.table(2026, { page, pageSize: 2 }));
    expect(pages.map((p) => p.rows.map((row) => row.name))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
      [],
    ]);
    expect(pages.map((p) => p.totalCount)).toEqual([5, 5, 5, 5]);
    expect(pages.map((p) => p.page)).toEqual([0, 1, 2, 3]);
  });

  it('has a default page of 50 and clamps the page size to 1 to 200', async () => {
    const s = await setup();
    await serviceWith(s.pool, s.consortium.id);
    expect((await s.table(2026)).pageSize).toBe(50);
    expect((await s.table(2026, { pageSize: 5000 })).pageSize).toBe(200);
    expect((await s.table(2026, { pageSize: 0 })).pageSize).toBe(1);
  });

  it('is an empty list, not an error, for a consortium of no services', async () => {
    const s = await setup();
    const view = await s.table(2026);
    expect(view).toMatchObject({ rows: [], totalCount: 0, page: 0 });
  });

  it('shows the same service, with the same figures, in each of two consortia', async () => {
    const s = await setup();
    const other = await makeOrganisation(s.pool, { type: 'consortium', name: uniq('Other') });
    const { head, set } = await headlineSet(s.pool);
    const shared = await serviceWith(s.pool, s.consortium.id, {
      set,
      headId: head.id,
      values: { '2026-06-30': 5 },
      alsoIn: [other.id],
    });
    const here = only((await s.table(2026)).rows);
    const there = only(
      (await s.impact.table(s.reviewer, { consortium: other.id, year: '2026' })).rows,
    );
    expect(there).toEqual(here);
    expect(here.yearly).toBe(5);
  });
});

describe('the published switch', () => {
  it('leaves the unpublished services out by default and brings them in, with the same figures, with includeUnpublished', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    const values = { '2026-02-28': 2 };
    await serviceWith(s.pool, s.consortium.id, { name: 'a public', set, headId: head.id, values });
    const hidden = await serviceWith(s.pool, s.consortium.id, {
      name: 'b hidden',
      set,
      headId: head.id,
      values,
      published: false,
    });
    const fewer = await s.table(2026);
    const more = await s.table(2026, { includeUnpublished: true });
    expect(fewer.rows.map((row) => row.name)).toEqual(['a public']);
    expect(more.rows.map((row) => row.name)).toEqual(['a public', 'b hidden']);
    expect([fewer.totalCount, more.totalCount]).toEqual([1, 2]);
    expect(more.rows[1]).toMatchObject({ serviceId: hidden.id, yearly: 2 });
    expect(more.rows[0]).toMatchObject({ yearly: 2 });
  });

  it('agrees with the tiles on how many services are counted', async () => {
    const s = await setup();
    await serviceWith(s.pool, s.consortium.id);
    await serviceWith(s.pool, s.consortium.id, { published: false });
    for (const includeUnpublished of [false, true])
      expect((await s.table(2026, { includeUnpublished })).totalCount).toBe(
        (await s.impact.summary(s.reviewer, { consortium: s.consortium.id, includeUnpublished }))
          .total,
      );
  });
});

describe('the cost', () => {
  it('reads the series once per service, never once per month: the statements do not grow with the months', async () => {
    const s = await setup();
    const { head, set } = await headlineSet(s.pool);
    const one = await makeOrganisation(s.pool, { type: 'consortium', name: uniq('Cost1') });
    const twelve = await makeOrganisation(s.pool, { type: 'consortium', name: uniq('Cost12') });
    const MONTH_ENDS = [
      '01-31',
      '02-28',
      '03-31',
      '04-30',
      '05-31',
      '06-30',
      '07-31',
      '08-31',
      '09-30',
      '10-31',
      '11-30',
      '12-31',
    ];
    for (let n = 0; n < 4; n++) {
      await serviceWith(s.pool, one.id, { set, headId: head.id, values: { '2026-01-31': 1 } });
      await serviceWith(s.pool, twelve.id, {
        set,
        headId: head.id,
        values: Object.fromEntries(MONTH_ENDS.map((end, at) => [`2026-${end}`, at + 1])),
      });
    }
    // the first request warms the caches of the vocabulary and the roles; the next two are the ones counted
    await s.impact.table(s.reviewer, { consortium: one.id, year: '2026' });
    const few = await countQueries(s.pool, () =>
      s.impact.table(s.reviewer, { consortium: one.id, year: '2026' }),
    );
    const many = await countQueries(s.pool, () =>
      s.impact.table(s.reviewer, { consortium: twelve.id, year: '2026' }),
    );
    expect(many.queries).toBe(few.queries);
    // a few statements for the consortium and the vocabulary, then at most three for each service: its evaluation, the indicator's
    // description and the values (the last two are the series read)
    expect(few.queries).toBeLessThanOrEqual(3 * 4 + 10);
    expect(few.queries).toBeGreaterThanOrEqual(2 * 4);
  });
});

/** The statements the pool runs while `work` runs. */
async function countQueries(
  pool: { query: (...args: never[]) => unknown },
  work: () => Promise<unknown>,
) {
  const original = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  let queries = 0;
  (pool as { query: unknown }).query = (...args: unknown[]) => {
    queries += 1;
    return original(...args);
  };
  try {
    await work();
  } finally {
    (pool as { query: unknown }).query = original;
  }
  return { queries };
}
