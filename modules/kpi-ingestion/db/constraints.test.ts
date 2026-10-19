// What the database itself refuses, whatever the service does: the rules that must hold for every writer (the migration tool
// of M13 included). Real Postgres; rows come from the factory where a row is valid.
import { randomUUID } from 'node:crypto';
import { makeIndicator, makeMeasurement } from '@scorpion/testing';
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

async function setup() {
  const s = await h.start();
  const indicator = await makeIndicator(s.pool, { valueType: 'integer' });
  return { s, indicator, serviceId: randomUUID() };
}

describe('the period of a measurement', () => {
  it.each([
    ['2026-01-31'],
    ['2026-02-28'],
    ['2026-03-31'],
    ['2026-04-30'],
    ['2024-02-29'],
    ['2000-02-29'],
    ['1900-02-28'],
    ['2026-12-31'],
  ])('accepts the last day of a month: %s', async (period) => {
    const { s, indicator, serviceId } = await setup();
    expect(
      await constraintOf(makeMeasurement(s.pool, { serviceId, indicatorId: indicator.id, period })),
    ).toBeUndefined();
  });

  it.each([
    ['2026-01-30'],
    ['2026-01-01'],
    ['2026-02-27'],
    ['2026-02-01'],
    ['2026-04-29'],
    ['2023-02-27'],
    ['2024-02-28'], // 2024 is a leap year: the 29th is the last day
    ['1900-02-27'],
    ['2026-12-30'],
  ])('refuses a day that is not the last of its month: %s', async (period) => {
    const { s, indicator, serviceId } = await setup();
    expect(
      await constraintOf(makeMeasurement(s.pool, { serviceId, indicatorId: indicator.id, period })),
    ).toBe('kpii_measurement_period_check');
  });
});

describe('the value of a measurement', () => {
  const insert = (
    s: Awaited<ReturnType<typeof setup>>['s'],
    serviceId: string,
    indicatorId: string,
    numeric: string | null,
    text: string | null,
  ) =>
    s.pool.query(
      `insert into kpii_measurement (id, service_id, indicator_id, period, value_numeric, value_text, source)
       values ($1, $2, $3, '2026-01-31', $4, $5, 'test')`,
      [randomUUID(), serviceId, indicatorId, numeric, text],
    );

  it('needs exactly one of the two columns', async () => {
    const { s, indicator, serviceId } = await setup();
    const check = 'kpii_measurement_one_value_check';
    expect(await constraintOf(insert(s, serviceId, indicator.id, null, null))).toBe(check);
    expect(await constraintOf(insert(s, serviceId, indicator.id, '1', 'a'))).toBe(check);
    expect(await constraintOf(insert(s, serviceId, indicator.id, '1', null))).toBeUndefined();
    const other = await makeIndicator(s.pool, { valueType: 'text' });
    expect(await constraintOf(insert(s, serviceId, other.id, null, 'a'))).toBeUndefined();
  });

  it('refuses a number that is not finite', async () => {
    const { s, indicator, serviceId } = await setup();
    for (const bad of ['NaN', 'Infinity', '-Infinity'])
      expect(await constraintOf(insert(s, serviceId, indicator.id, bad, null)), bad).toBe(
        'kpii_measurement_numeric_check',
      );
  });

  it('stores a number as an exact decimal, a negative, a fraction and zero included', async () => {
    const { s, serviceId } = await setup();
    const values = ['0', '-7', '0.1', '99.9', '1e+21', '0.30000000000000004'];
    for (const value of values) {
      const indicator = await makeIndicator(s.pool, { valueType: 'float' });
      await insert(s, serviceId, indicator.id, value, null);
    }
    const { rows } = await s.pool.query<{ value_numeric: string }>(
      'select value_numeric::text from kpii_measurement where service_id = $1 order by id',
      [serviceId],
    );
    expect(rows.map((row) => Number(row.value_numeric)).sort()).toEqual(values.map(Number).sort());
  });

  it('bounds the text to 1 to 4000 characters', async () => {
    const { s, indicator, serviceId } = await setup();
    expect(await constraintOf(insert(s, serviceId, indicator.id, null, ''))).toBe(
      'kpii_measurement_text_check',
    );
    expect(await constraintOf(insert(s, serviceId, indicator.id, null, 'x'.repeat(4001)))).toBe(
      'kpii_measurement_text_check',
    );
    expect(
      await constraintOf(insert(s, serviceId, indicator.id, null, 'x'.repeat(4000))),
    ).toBeUndefined();
  });

  it('bounds the source to 1 to 64 characters', async () => {
    const { s, indicator, serviceId } = await setup();
    for (const source of ['', 'x'.repeat(65)])
      expect(
        await constraintOf(
          makeMeasurement(s.pool, { serviceId, indicatorId: indicator.id, source }),
        ),
        source.length.toString(),
      ).toBe('kpii_measurement_source_check');
  });
});

describe('the key of a measurement', () => {
  it('allows one row per service, indicator and month, and refuses the same month twice', async () => {
    const { s, indicator, serviceId } = await setup();
    const base = { serviceId, indicatorId: indicator.id, period: '2026-01-31' };
    await makeMeasurement(s.pool, base);
    expect(await constraintOf(makeMeasurement(s.pool, { ...base, valueNumeric: 2 }))).toBe(
      'kpii_measurement_series_idx',
    );
    // another month, another indicator and another service each have their own row
    expect(
      await constraintOf(makeMeasurement(s.pool, { ...base, period: '2026-02-28' })),
    ).toBeUndefined();
    const other = await makeIndicator(s.pool, { valueType: 'integer' });
    expect(
      await constraintOf(makeMeasurement(s.pool, { ...base, indicatorId: other.id })),
    ).toBeUndefined();
    expect(
      await constraintOf(makeMeasurement(s.pool, { ...base, serviceId: randomUUID() })),
    ).toBeUndefined();
  });

  it('has no foreign key to a service: the service id is a plain column', async () => {
    const { s, indicator } = await setup();
    expect(
      await constraintOf(
        makeMeasurement(s.pool, { serviceId: randomUUID(), indicatorId: indicator.id }),
      ),
    ).toBeUndefined();
  });
});

describe('the keys of a measurement', () => {
  it('refuses an indicator that does not exist', async () => {
    const { s, serviceId } = await setup();
    expect(
      await constraintOf(makeMeasurement(s.pool, { serviceId, indicatorId: randomUUID() })),
    ).toBe('kpii_measurement_indicator_id_fk');
  });

  it('restricts the delete of an indicator that has a measurement, and allows it once the row is gone', async () => {
    const { s, indicator, serviceId } = await setup();
    const row = await makeMeasurement(s.pool, { serviceId, indicatorId: indicator.id });
    expect(
      await constraintOf(s.pool.query('delete from kpif_indicator where id = $1', [indicator.id])),
    ).toBe('kpii_measurement_indicator_id_fk');
    await s.pool.query('delete from kpii_measurement where id = $1', [row.id]);
    expect(
      await constraintOf(s.pool.query('delete from kpif_indicator where id = $1', [indicator.id])),
    ).toBeUndefined();
  });

  it('keeps the measurements of a run that is deleted and drops only the pointer', async () => {
    const { s, indicator, serviceId } = await setup();
    const runId = randomUUID();
    await s.pool.query(
      `insert into kpii_ingestion_run (id, service_id, adapter, status) values ($1, $2, 'csv', 'committed')`,
      [runId, serviceId],
    );
    const row = await makeMeasurement(s.pool, { serviceId, indicatorId: indicator.id, runId });
    await s.pool.query('delete from kpii_ingestion_run where id = $1', [runId]);
    const { rows } = await s.pool.query<{ run_id: string | null }>(
      'select run_id from kpii_measurement where id = $1',
      [row.id],
    );
    expect(rows).toEqual([{ run_id: null }]);
  });

  it('refuses a run that does not exist', async () => {
    const { s, indicator, serviceId } = await setup();
    expect(
      await constraintOf(
        makeMeasurement(s.pool, { serviceId, indicatorId: indicator.id, runId: randomUUID() }),
      ),
    ).toBe('kpii_measurement_run_id_kpii_ingestion_run_id_fk');
  });
});

describe('the constraints of a run', () => {
  const insert = (
    s: Awaited<ReturnType<typeof setup>>['s'],
    overrides: Record<string, unknown> = {},
  ) => {
    const row = {
      id: randomUUID(),
      service_id: randomUUID(),
      adapter: 'csv',
      status: 'committed',
      file_name: null,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      problems: '[]',
      ...overrides,
    };
    return s.pool.query(
      `insert into kpii_ingestion_run (id, service_id, adapter, status, file_name, inserted, updated, unchanged, rejected, problems)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        row.id,
        row.service_id,
        row.adapter,
        row.status,
        row.file_name,
        row.inserted,
        row.updated,
        row.unchanged,
        row.rejected,
        row.problems,
      ],
    );
  };

  it.each<[string, Record<string, unknown>, string]>([
    ['an empty adapter', { adapter: '' }, 'kpii_ingestion_run_adapter_check'],
    [
      'an adapter over 64 characters',
      { adapter: 'a'.repeat(65) },
      'kpii_ingestion_run_adapter_check',
    ],
    ['a status that is no state', { status: 'done' }, 'kpii_ingestion_run_status_check'],
    ['an empty file name', { file_name: '' }, 'kpii_ingestion_run_file_name_check'],
    [
      'a file name over 120 characters',
      { file_name: 'f'.repeat(121) },
      'kpii_ingestion_run_file_name_check',
    ],
    ['a negative count', { inserted: -1 }, 'kpii_ingestion_run_counts_check'],
    ['a negative rejected count', { rejected: -1 }, 'kpii_ingestion_run_counts_check'],
    ['problems that are not a list', { problems: '{}' }, 'kpii_ingestion_run_problems_check'],
    [
      'more than 100 problems',
      {
        problems: JSON.stringify(
          Array.from({ length: 101 }, (_, row) => ({ row, column: 1, code: 'x' })),
        ),
      },
      'kpii_ingestion_run_problems_check',
    ],
  ])('refuses %s', async (_name, overrides, constraint) => {
    const { s } = await setup();
    expect(await constraintOf(insert(s, overrides))).toBe(constraint);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a committed run', {}],
    ['a rejected run', { status: 'rejected', rejected: 3 }],
    ['a file name of 120 characters', { file_name: 'f'.repeat(120) }],
    [
      '100 problems',
      {
        problems: JSON.stringify(
          Array.from({ length: 100 }, (_, row) => ({ row, column: 1, code: 'x' })),
        ),
      },
    ],
  ])('accepts %s', async (_name, overrides) => {
    const { s } = await setup();
    expect(await constraintOf(insert(s, overrides))).toBeUndefined();
  });
});
