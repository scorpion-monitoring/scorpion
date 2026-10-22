// The calculation library, table-driven (M11 sprint 3): each function over an empty series, one value, two values, a zero, negative
// values, gaps, a window that starts mid-series, the end of a leap-year month and a duration in seconds. The properties are in
// `calc.properties.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  alignToMonths,
  avg,
  band,
  changePercent,
  cumulative,
  durationParts,
  durationSeconds,
  mape,
  max,
  min,
  monthEnd,
  monthsBack,
  sum,
} from './index.ts';

const GAP = null;

describe('sum, avg, min, max', () => {
  const rows: [
    string,
    (number | null)[],
    number | null,
    number | null,
    number | null,
    number | null,
  ][] = [
    // name, series, sum, avg, min, max
    ['empty', [], null, null, null, null],
    ['only gaps', [GAP, GAP], null, null, null, null],
    ['one value', [5], 5, 5, 5, 5],
    ['two values', [2, 4], 6, 3, 2, 4],
    ['a zero is a value', [0, 4], 4, 2, 0, 4],
    ['only zeros', [0, 0, 0], 0, 0, 0, 0],
    ['negative values', [-3, -1, -2], -6, -2, -3, -1],
    ['gaps are skipped, not zeros', [GAP, 4, GAP, 8], 12, 6, 4, 8],
    ['a window that starts mid-series', [GAP, GAP, 10, 20, 30], 60, 20, 10, 30],
    ['a duration in seconds', [3661, 7200], 10861, 5430.5, 3661, 7200],
    ['decimals', [0.1, 0.2], 0.30000000000000004, 0.15000000000000002, 0.1, 0.2],
  ];
  it.each(rows)('%s', (_name, series, total, mean, low, high) => {
    expect(sum(series)).toBe(total);
    expect(avg(series)).toBeCloseTo(mean ?? 0, 9);
    if (mean === null) expect(avg(series)).toBeNull();
    expect(min(series)).toBe(low);
    expect(max(series)).toBe(high);
  });

  it('answers null and never NaN or an infinity when a sum overflows or the input is not a number', () => {
    expect(sum([Number.MAX_VALUE, Number.MAX_VALUE])).toBeNull();
    expect(avg([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(Number.MAX_VALUE);
    expect(sum([Number.NaN, Infinity, -Infinity, 3])).toBe(3);
    expect(sum([undefined, 2])).toBe(2);
    expect(sum('nope' as never)).toBeNull();
  });

  it('never prints a negative zero', () => {
    expect(Object.is(sum([-0, -0]), 0)).toBe(true);
    expect(Object.is(min([-0]), 0)).toBe(true);
  });
});

describe('changePercent', () => {
  const rows: [string, (number | null)[], number | null][] = [
    ['empty', [], null],
    ['one value', [10], null],
    ['two values up', [10, 15], 50],
    ['two values down', [10, 5], -50],
    ['no change', [7, 7], 0],
    ['the oldest is zero: undefined', [0, 5], null],
    ['the newest is zero: minus a hundred', [5, 0], -100],
    ['negative values: less negative is up', [-10, -5], 50],
    ['negative values: more negative is down', [-10, -20], -100],
    ['gaps at both ends are not the oldest or the newest', [GAP, 10, 12, 20, GAP], 100],
    ['a gap in the middle changes nothing', [10, GAP, GAP, 20], 100],
    ['one value among gaps', [GAP, 4, GAP], null],
    ['a window that starts mid-series', [GAP, GAP, 8, 10], 25],
    ['a duration in seconds', [3600, 7200], 100],
  ];
  it.each(rows)('%s', (_name, series, expected) => {
    expect(changePercent(series)).toBe(expected);
  });
});

describe('cumulative', () => {
  const rows: [string, (number | null)[], (number | null)[]][] = [
    ['empty', [], []],
    ['one value', [4], [4]],
    ['two values', [4, 6], [4, 10]],
    ['a zero', [0, 3, 0], [0, 3, 3]],
    ['negative values', [5, -2, -4], [5, 3, -1]],
    ['a gap stays a gap and the total carries across it', [1, GAP, 2], [1, GAP, 3]],
    ['gaps first', [GAP, GAP, 3, 4], [GAP, GAP, 3, 7]],
    ['only gaps', [GAP, GAP], [GAP, GAP]],
  ];
  it.each(rows)('%s', (_name, series, expected) => {
    expect(cumulative(series)).toEqual(expected);
  });

  it('is null from an overflow on, never an infinity', () => {
    expect(cumulative([Number.MAX_VALUE, Number.MAX_VALUE, 1])).toEqual([
      Number.MAX_VALUE,
      null,
      null,
    ]);
  });
});

describe('mape: the mean absolute percentage deviation from the mean', () => {
  const rows: [string, (number | null)[], number | null][] = [
    ['empty', [], null],
    ['one value', [10], null],
    ['two values', [8, 12], 0.2],
    ['a constant series is exactly zero', [5, 5, 5], 0],
    ['a constant 0.1 series is exactly zero', [0.1, 0.1, 0.1], 0],
    ['all zeros: the mean is zero, undefined', [0, 0, 0], null],
    ['the mean is zero: undefined', [-5, 5], null],
    ['negative values use the size of the mean', [-8, -12], 0.2],
    ['a zero among values', [0, 10], 1],
    ['gaps are skipped', [GAP, 8, GAP, 12], 0.2],
    ['a window that starts mid-series', [GAP, GAP, 8, 12], 0.2],
    ['a duration in seconds', [3600, 7200], 1 / 3],
  ];
  it.each(rows)('%s', (_name, series, expected) => {
    const got = mape(series);
    if (expected === null) expect(got).toBeNull();
    else expect(got).toBeCloseTo(expected, 12);
  });
});

describe('band', () => {
  const thresholds = { low: 0.4, high: 0.8 };
  it.each([
    [null, null],
    [0, 'low'],
    [0.39, 'low'],
    [0.4, 'medium'],
    [0.79, 'medium'],
    [0.8, 'high'],
    [5, 'high'],
    [-1, null],
    [Number.NaN, null],
  ] as const)('%s is %s', (score, expected) => {
    expect(band(score, thresholds)).toBe(expected);
  });

  it('follows the thresholds it is given and refuses bad ones with null, never a throw', () => {
    expect(band(0.5, { low: 0.6, high: 0.9 })).toBe('low');
    expect(band(0.5, { low: 0.2, high: 0.3 })).toBe('high');
    for (const bad of [
      { low: 0, high: 1 },
      { low: 0.8, high: 0.4 },
      { low: 0.4, high: 0.4 },
      { low: Number.NaN, high: 1 },
      undefined as never,
    ])
      expect(band(0.5, bad)).toBeNull();
  });
});

describe('the months', () => {
  it.each([
    [2024, 2, '2024-02-29'],
    [2023, 2, '2023-02-28'],
    [1900, 2, '1900-02-28'],
    [2000, 2, '2000-02-29'],
    [2026, 4, '2026-04-30'],
    [2026, 12, '2026-12-31'],
  ])('the month end of %s-%s is %s', (year, month, expected) => {
    expect(monthEnd(year, month)).toBe(expected);
  });

  it.each([
    [2026, 0],
    [2026, 13],
    [2026, 1.5],
    [0, 1],
    [10000, 1],
    [Number.NaN, 1],
  ])('%s-%s is no month', (year, month) => {
    expect(monthEnd(year, month)).toBeNull();
  });

  it('counts back from the month of the clock, oldest first, across a year end and a leap year', () => {
    expect(monthsBack(new Date('2026-01-15T00:00:00Z'), 3)).toEqual([
      '2025-11-30',
      '2025-12-31',
      '2026-01-31',
    ]);
    expect(monthsBack(new Date('2024-03-01T00:00:00Z'), 2)).toEqual(['2024-02-29', '2024-03-31']);
    expect(monthsBack(new Date('2026-06-30T23:59:59Z'), 1)).toEqual(['2026-06-30']);
    expect(monthsBack(new Date('2026-06-15T00:00:00Z'), 12)).toHaveLength(12);
    expect(monthsBack(new Date('2026-06-15T00:00:00Z'), 0)).toEqual([]);
    expect(monthsBack(new Date('nonsense'), 3)).toEqual([]);
  });

  it('lays points on the months of a window: gaps are null, months outside are left out, a later point wins', () => {
    const months = ['2026-01-31', '2026-02-28', '2026-03-31'];
    expect(
      alignToMonths(months, [
        { period: '2025-12-31', value: 99 },
        { period: '2026-01-31', value: 1 },
        { period: '2026-03-31', value: 3 },
        { period: '2026-03-31', value: 4 },
        { period: '2026-04-30', value: 99 },
      ]),
    ).toEqual([1, null, 4]);
    expect(alignToMonths(months, [])).toEqual([null, null, null]);
    expect(alignToMonths(months, [{ period: '2026-02-28', value: Number.NaN }])).toEqual([
      null,
      null,
      null,
    ]);
    expect(alignToMonths([], [{ period: '2026-02-28', value: 1 }])).toEqual([]);
  });
});

describe('duration', () => {
  it.each([
    [0, 0, 0, 0],
    [0, 0, 59, 59],
    [1, 1, 1, 3661],
    [2, 0, 0, 7200],
    [9999, 59, 59, 35999999],
  ])('%s h %s min %s s is %s seconds', (hours, minutes, seconds, expected) => {
    expect(durationSeconds(hours, minutes, seconds)).toBe(expected);
    expect(durationParts(expected)).toEqual({ hours, minutes, seconds });
  });

  it.each([
    [0, 60, 0],
    [0, 0, 60],
    [-1, 0, 0],
    [10000, 0, 0],
    [1.5, 0, 0],
    [Number.NaN, 0, 0],
    [0, Infinity, 0],
  ])('%s h %s min %s s is no duration', (hours, minutes, seconds) => {
    expect(durationSeconds(hours, minutes, seconds)).toBeNull();
  });

  it('refuses seconds that are no duration', () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity, 10_000 * 3600])
      expect(durationParts(bad)).toBeNull();
  });
});
