// The row of one service with the dependencies faked: the state rules one by one, the one series read, and the errors that real data cannot reach
// (a value type or aggregate this instance does not know) because the keys of the database refuse them.
import { avg, sum } from '@scorpion/kpi-analytics/public';
import type { EvaluationOfService, ValueTypeEntry } from '@scorpion/kpi-framework/public';
import type { SeriesPoint } from '@scorpion/kpi-ingestion/public';
import { describe, expect, it } from 'vitest';
import { computeRow, type RowDeps } from './rows.ts';

const SERVICE = { id: '0198f9c0-1234-7abc-8def-0123456789ab', name: 'Alpha', slug: 'alpha' };
const HEAD = '0198f9c0-1234-7abc-8def-0123456789ac';
const type = (numeric: boolean, aggregates: string[]) =>
  ({ numeric, aggregates }) as ValueTypeEntry;
const headline = (over: Partial<NonNullable<EvaluationOfService['headline']>> = {}) => ({
  setId: 'set',
  headline: {
    indicatorId: HEAD,
    name: 'Users',
    valueType: 'integer',
    unit: 'count',
    aggregate: 'sum',
    ...over,
  },
});

function deps(over: Partial<RowDeps> & { found?: EvaluationOfService | null } = {}) {
  const calls: { series: unknown[][] } = { series: [] };
  const base: RowDeps = {
    evaluationOf: () => Promise.resolve('found' in over ? over.found! : headline()),
    valueType: (id) =>
      id === 'integer' ? type(true, ['sum', 'avg']) : id === 'text' ? type(false, []) : undefined,
    aggregate: (id) => ({ sum, avg })[id as 'sum'],
    aggregateLabel: (id) => `label of ${id}`,
    series: (...args) => {
      calls.series.push(args);
      return Promise.resolve([] as SeriesPoint[]);
    },
  };
  const rest: Partial<RowDeps> = { ...over };
  delete (rest as { found?: unknown }).found;
  return { deps: { ...base, ...rest }, calls };
}
const point = (period: string, valueNumber: number | null): SeriesPoint => ({
  indicatorId: HEAD,
  period,
  valueNumber,
  value: String(valueNumber),
});

describe('computeRow', () => {
  // [description, found, state, reason]
  const CASES: [string, EvaluationOfService | null, string, string][] = [
    ['no set', null, 'no-evaluation', 'no-set'],
    ['a set with no headline', { setId: 's', headline: null }, 'no-evaluation', 'no-headline'],
    ['a text headline', headline({ valueType: 'text', aggregate: 'sum' }), 'error', 'not-numeric'],
    ['an unknown value type', headline({ valueType: 'martian' }), 'error', 'value-type-unknown'],
    [
      'an aggregate the type does not allow',
      headline({ aggregate: 'max' }),
      'error',
      'aggregate-not-allowed',
    ],
  ];
  for (const [name, found, state, reason] of CASES)
    it(`${name} is ${state} (${reason})`, async () => {
      const row = await computeRow(deps({ found }).deps, SERVICE, 2025);
      expect(row.state).toBe(state);
      expect(row.reason).toBe(reason);
      expect(row.advice.length).toBeGreaterThan(20);
    });

  it('says an aggregate with no function is an error and still names the headline', async () => {
    const row = await computeRow(deps({ aggregate: () => undefined }).deps, SERVICE, 2025);
    expect(row).toMatchObject({ state: 'error', reason: 'aggregate-unknown' });
    expect(row.headline).toMatchObject({
      indicatorId: HEAD,
      aggregate: 'sum',
      label: 'label of sum',
    });
    expect(row.months).toEqual(Array.from({ length: 12 }, () => null));
  });

  it('reads the series once for the whole year, for the headline only, in the months of the year', async () => {
    const { deps: d, calls } = deps();
    await computeRow(d, SERVICE, 2024);
    expect(calls.series).toEqual([[SERVICE.id, [HEAD], '2024-01', '2024-12']]);
  });

  it('puts each value in its month, leaves the others empty and aggregates what is there', async () => {
    const { deps: d } = deps({
      series: () =>
        Promise.resolve([point('2024-02-29', 5), point('2024-12-31', 7), point('2025-01-31', 99)]),
    });
    const row = await computeRow(d, SERVICE, 2024);
    expect(row.state).toBe('ok');
    expect(row.months[1]).toBe(5);
    expect(row.months[11]).toBe(7);
    expect(row.months.filter((v) => v !== null)).toHaveLength(2);
    expect(row).toMatchObject({ yearly: 12, monthsWithValue: 2 });
  });

  it('writes the figures for reading by the value type: its own display, else a number in the language, and nothing for a gap', async () => {
    const series = () =>
      Promise.resolve([point('2024-02-29', 3723), point('2024-03-31', 1234.567)]);
    const plain = await computeRow(deps({ series }).deps, SERVICE, 2024);
    expect(plain.shown.months[0]).toBeNull();
    expect(plain.shown.months.slice(1, 3)).toEqual(['3,723', '1,234.57']);
    expect(plain.shown.yearly).toBe('4,957.57');
    const german = await computeRow(deps({ series, locale: 'de' }).deps, SERVICE, 2024);
    expect(german.shown.months.slice(1, 3)).toEqual(['3.723', '1.234,57']);

    const display = (seconds: number) => `d${Math.round(seconds)}`;
    const timed = await computeRow(
      deps({
        series,
        valueType: () =>
          ({ numeric: true, aggregates: ['sum'], display }) as unknown as ValueTypeEntry,
      }).deps,
      SERVICE,
      2024,
    );
    expect(timed.shown).toEqual({
      months: [null, 'd3723', 'd1235', ...Array.from({ length: 9 }, () => null)],
      yearly: 'd4958',
    });
    expect(timed.months[1]).toBe(3723);
  });

  it('is no-data, with its headline and empty months, when the year has no value', async () => {
    const row = await computeRow(deps().deps, SERVICE, 2024);
    expect(row).toMatchObject({
      state: 'no-data',
      reason: 'no-values',
      yearly: null,
      monthsWithValue: 0,
    });
    expect(row.headline?.name).toBe('Users');
  });

  it('is an error row, with no message of the exception, when a read fails', async () => {
    const seen: unknown[] = [];
    const row = await computeRow(
      {
        ...deps().deps,
        series: () => Promise.reject(new Error('secret detail')),
        onError: (e) => seen.push(e),
      },
      SERVICE,
      2024,
    );
    expect(row).toMatchObject({ state: 'error', reason: 'read-failed' });
    expect(JSON.stringify(row)).not.toContain('secret detail');
    expect(seen).toHaveLength(1);
  });

  it('is an error row for a year that is no year', async () => {
    expect((await computeRow(deps().deps, SERVICE, 0)).reason).toBe('read-failed');
  });
});
