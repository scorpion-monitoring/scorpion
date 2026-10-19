// What the database itself refuses, whatever the service does: the rules that must hold for every writer
// (the migration tool of M13 included). Real Postgres; rows come from the factories where a row is valid.
import { makeIndicator, makeKpiSet, makeServiceKpiHistory } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';

const h = useKpi();

/** The Postgres error a statement fails with: its constraint name, or `undefined` when it succeeds. */
async function constraintOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { constraint?: string }).constraint ?? String(error);
  }
  return undefined;
}

describe('the constraints of kpif_indicator', () => {
  it.each<[string, Parameters<typeof makeIndicator>[1], string]>([
    ['a slug with a space', { slug: 'a b' }, 'kpif_indicator_slug_check'],
    ['a slug that starts with a dot', { slug: '.a' }, 'kpif_indicator_slug_check'],
    ['a slug over 64 characters', { slug: 'a'.repeat(65) }, 'kpif_indicator_slug_check'],
    ['an empty name', { name: '' }, 'kpif_indicator_name_check'],
    ['a name over 200 characters', { name: 'a'.repeat(201) }, 'kpif_indicator_name_check'],
    [
      'a description over 4000 characters',
      { description: 'a'.repeat(4001) },
      'kpif_indicator_description_check',
    ],
    [
      'an example over 1000 characters',
      { example: 'a'.repeat(1001) },
      'kpif_indicator_example_check',
    ],
    ['min above max', { min: 5, max: 4 }, 'kpif_indicator_bounds_check'],
    [
      'a qualitative indicator of type integer',
      { qualitative: true, valueType: 'integer' },
      'kpif_indicator_qualitative_check',
    ],
    [
      'a qualitative indicator with bounds',
      { qualitative: true, min: 1 },
      'kpif_indicator_qualitative_check',
    ],
  ])('refuses %s', async (_name, overrides, constraint) => {
    const s = await h.start();
    expect(await constraintOf(makeIndicator(s.pool, overrides))).toBe(constraint);
  });

  it.each<[string, Parameters<typeof makeIndicator>[1]]>([
    ['bounds that are equal', { min: 3, max: 3 }],
    ['only a minimum', { min: 0 }],
    ['a fraction as a bound', { min: 0.5, max: 99.25, valueType: 'percentage' }],
    ['a qualitative text indicator', { qualitative: true }],
    ['a text indicator that is not qualitative', { valueType: 'text' }],
    ['a name of 200 characters', { name: 'a'.repeat(200) }],
  ])('accepts %s', async (_name, overrides) => {
    const s = await h.start();
    expect(await constraintOf(makeIndicator(s.pool, overrides))).toBeUndefined();
  });

  it('refuses a second slug or name that differs only in case', async () => {
    const s = await h.start();
    await makeIndicator(s.pool, { slug: 'Downloads', name: 'Downloads per month' });
    expect(await constraintOf(makeIndicator(s.pool, { slug: 'downloads' }))).toBe(
      'kpif_indicator_slug_idx',
    );
    expect(await constraintOf(makeIndicator(s.pool, { name: 'DOWNLOADS PER MONTH' }))).toBe(
      'kpif_indicator_name_idx',
    );
  });

  it('stores a bound as an exact decimal', async () => {
    const s = await h.start();
    const row = await makeIndicator(s.pool, { min: 0.1, max: 99.9 });
    expect([row.min_value, row.max_value]).toEqual(['0.1', '99.9']);
  });

  it('removes the means and tools with the indicator', async () => {
    const s = await h.start();
    const indicator = await makeIndicator(s.pool, {
      measuredBy: ['a', 'b'],
      canBeAutomatedBy: ['t'],
    });
    await s.pool.query('delete from kpif_indicator where id = $1', [indicator.id]);
    for (const table of ['kpif_indicator_means', 'kpif_indicator_tool'])
      expect((await s.pool.query(`select 1 from ${table}`)).rowCount).toBe(0);
  });

  it('refuses the same means twice for one indicator', async () => {
    const s = await h.start();
    const indicator = await makeIndicator(s.pool, { measuredBy: ['a'] });
    expect(
      await constraintOf(
        s.pool.query('insert into kpif_indicator_means (indicator_id, term_key) values ($1, $2)', [
          indicator.id,
          'a',
        ]),
      ),
    ).toBe('kpif_indicator_means_indicator_id_term_key_pk');
  });
});

describe('the constraints of KPI sets', () => {
  it('refuses a slug and a name that clash without case, and a bad slug', async () => {
    const s = await h.start();
    await makeKpiSet(s.pool, { slug: 'Web', name: 'Web apps' });
    expect(await constraintOf(makeKpiSet(s.pool, { slug: 'WEB' }))).toBe('kpif_kpi_set_slug_idx');
    expect(await constraintOf(makeKpiSet(s.pool, { name: 'web APPS' }))).toBe(
      'kpif_kpi_set_name_idx',
    );
    expect(await constraintOf(makeKpiSet(s.pool, { slug: 'a/b' }))).toBe('kpif_kpi_set_slug_check');
  });

  it('refuses a necessity of "" (defect 14) and the same indicator twice in a set', async () => {
    const s = await h.start();
    const indicator = await makeIndicator(s.pool);
    expect(
      await constraintOf(
        makeKpiSet(s.pool, { indicators: [{ indicatorId: indicator.id, necessity: '' }] }),
      ),
    ).toBe('kpif_kpi_set_indicator_necessity_check');
    const set = await makeKpiSet(s.pool, {
      indicators: [{ indicatorId: indicator.id, necessity: 'optional' }],
    });
    expect(
      await constraintOf(
        s.pool.query(
          "insert into kpif_kpi_set_indicator (set_id, indicator_id, necessity) values ($1, $2, 'mandatory')",
          [set.id, indicator.id],
        ),
      ),
    ).toBe('kpif_kpi_set_indicator_set_id_indicator_id_pk');
  });

  it('refuses to delete an indicator that a set uses, and deletes it once the row is gone', async () => {
    const s = await h.start();
    const indicator = await makeIndicator(s.pool);
    const set = await makeKpiSet(s.pool, {
      indicators: [{ indicatorId: indicator.id, necessity: 'optional' }],
    });
    expect(
      await constraintOf(s.pool.query('delete from kpif_indicator where id = $1', [indicator.id])),
    ).toBe('kpif_kpi_set_indicator_indicator_id_kpif_indicator_id_fk');
    await s.pool.query('delete from kpif_kpi_set_indicator where set_id = $1', [set.id]);
    expect(
      await constraintOf(s.pool.query('delete from kpif_indicator where id = $1', [indicator.id])),
    ).toBeUndefined();
  });

  it('removes the rows and the evaluation with the set, in one statement', async () => {
    const s = await h.start();
    const indicator = await makeIndicator(s.pool);
    const set = await makeKpiSet(s.pool, {
      indicators: [{ indicatorId: indicator.id, necessity: 'mandatory' }],
      evaluation: { indicatorId: indicator.id, aggregate: 'avg' },
    });
    await s.pool.query('delete from kpif_kpi_set where id = $1', [set.id]);
    for (const table of ['kpif_kpi_set_indicator', 'kpif_evaluation'])
      expect((await s.pool.query(`select 1 from ${table}`)).rowCount).toBe(0);
    // The indicator itself stays.
    expect(
      (await s.pool.query('select 1 from kpif_indicator where id = $1', [indicator.id])).rowCount,
    ).toBe(1);
  });
});

describe('the constraints of the evaluation', () => {
  it("needs the headline to be one of the set's indicators", async () => {
    const s = await h.start();
    const inSet = await makeIndicator(s.pool);
    const outside = await makeIndicator(s.pool);
    expect(
      await constraintOf(
        makeKpiSet(s.pool, {
          indicators: [{ indicatorId: inSet.id, necessity: 'mandatory' }],
          evaluation: { indicatorId: outside.id, aggregate: 'sum' },
        }),
      ),
    ).toBe('kpif_evaluation_set_indicator_fk');
  });

  it('allows one evaluation per set, and refuses to remove the headline row from under it', async () => {
    const s = await h.start();
    const a = await makeIndicator(s.pool);
    const b = await makeIndicator(s.pool);
    const set = await makeKpiSet(s.pool, {
      indicators: [
        { indicatorId: a.id, necessity: 'mandatory' },
        { indicatorId: b.id, necessity: 'optional' },
      ],
      evaluation: { indicatorId: a.id, aggregate: 'sum' },
    });
    expect(
      await constraintOf(
        s.pool.query(
          "insert into kpif_evaluation (set_id, indicator_id, aggregate) values ($1, $2, 'avg')",
          [set.id, b.id],
        ),
      ),
    ).toBe('kpif_evaluation_pkey');
    // The service of sprint 2 clears the evaluation before it removes its indicator from the set.
    expect(
      await constraintOf(
        s.pool.query('delete from kpif_kpi_set_indicator where set_id = $1 and indicator_id = $2', [
          set.id,
          a.id,
        ]),
      ),
    ).toBe('kpif_evaluation_set_indicator_fk');
    expect(
      await constraintOf(
        s.pool.query('delete from kpif_kpi_set_indicator where set_id = $1 and indicator_id = $2', [
          set.id,
          b.id,
        ]),
      ),
    ).toBeUndefined();
  });
});

describe('the constraints of the history of a service’s KPIs', () => {
  const T0 = '2026-01-10T12:00:00Z';
  const T1 = '2026-02-10T12:00:00Z';

  it('refuses a row that ends before it begins, and one that ends when it begins', async () => {
    const s = await h.start();
    const serviceId = randomUUID();
    for (const validTo of [T0, '2026-01-01T00:00:00Z'])
      expect(
        await constraintOf(makeServiceKpiHistory(s.pool, { serviceId, validFrom: T0, validTo })),
      ).toBe('kpif_service_kpi_history_range_check');
  });

  it('allows one open row per service, and a second service has its own', async () => {
    const s = await h.start();
    const serviceId = randomUUID();
    await makeServiceKpiHistory(s.pool, { serviceId, validFrom: T0 });
    expect(await constraintOf(makeServiceKpiHistory(s.pool, { serviceId, validFrom: T1 }))).toBe(
      'kpif_service_kpi_history_open_idx',
    );
    expect(
      await constraintOf(makeServiceKpiHistory(s.pool, { serviceId: randomUUID(), validFrom: T0 })),
    ).toBeUndefined();
  });

  it('refuses two rows of one service that begin at the same instant', async () => {
    const s = await h.start();
    const serviceId = randomUUID();
    await makeServiceKpiHistory(s.pool, { serviceId, validFrom: T0, validTo: T1 });
    expect(
      await constraintOf(
        makeServiceKpiHistory(s.pool, {
          serviceId,
          validFrom: T0,
          validTo: '2026-03-01T00:00:00Z',
        }),
      ),
    ).toBe('kpif_service_kpi_history_service_id_valid_from_pk');
  });

  it('refuses more extras than the service layer allows', async () => {
    const s = await h.start();
    const extras = Array.from({ length: 201 }, () => randomUUID());
    expect(
      await constraintOf(
        makeServiceKpiHistory(s.pool, { serviceId: randomUUID(), validFrom: T0, extras }),
      ),
    ).toBe('kpif_service_kpi_history_extras_check');
  });

  it('is append-only: a delete is refused, and so is every update but closing the open row once', async () => {
    const s = await h.start();
    const serviceId = randomUUID();
    await makeServiceKpiHistory(s.pool, { serviceId, validFrom: T0 });
    const run = (sql: string) => constraintOf(s.pool.query(sql, [serviceId]));
    const append = /append-only/;
    expect(await run('delete from kpif_service_kpi_history where service_id = $1')).toMatch(append);
    for (const change of [
      "set_id = '018f3b7e-0000-7000-8000-000000000001'",
      "extras = '{018f3b7e-0000-7000-8000-000000000001}'",
      "valid_from = '2026-01-11T00:00:00Z'",
      "service_id = '018f3b7e-0000-7000-8000-000000000001'",
      "changed_by = '018f3b7e-0000-7000-8000-000000000001'",
      // "closing" that also changes something else is an edit
      `valid_to = '${T1}', set_id = '018f3b7e-0000-7000-8000-000000000001'`,
      // reopening and clearing are not closings
      'valid_to = null',
    ])
      expect(
        await run(`update kpif_service_kpi_history set ${change} where service_id = $1`),
        change,
      ).toMatch(append);
    // Closing the open row, once, is the one update that works.
    expect(
      await run(`update kpif_service_kpi_history set valid_to = '${T1}' where service_id = $1`),
    ).toBeUndefined();
    expect(
      await run(
        `update kpif_service_kpi_history set valid_to = '2026-03-01T00:00:00Z' where service_id = $1`,
      ),
    ).toMatch(append);
    expect(await run('delete from kpif_service_kpi_history where service_id = $1')).toMatch(append);
    const left = await s.pool.query(
      'select valid_to from kpif_service_kpi_history where service_id = $1',
      [serviceId],
    );
    expect(left.rows).toHaveLength(1);
  });
});
