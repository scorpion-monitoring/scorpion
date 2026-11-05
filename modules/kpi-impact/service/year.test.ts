// The yearly figure: table-driven cases for every aggregate and properties over generated years. The function is the library's, named by the case
// as the registry names it; the module has no function of its own.
import { avg, max, min, sum } from '@scorpion/kpi-analytics/public';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { monthEnds, yearFigure, type AggregateFn } from './year.ts';

const FUNCTIONS: Record<string, AggregateFn> = { sum, avg, min, max };
const gap = null;
const twelve = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const none = Array.from({ length: 12 }, () => gap);
const one = [gap, gap, gap, 7, gap, gap, gap, gap, gap, gap, gap, gap];
const hole = [10, 20, gap, 40, gap, gap, gap, gap, gap, gap, gap, gap];
const negative = [-5, 3, gap, gap, gap, gap, gap, gap, gap, gap, gap, -1];

// [name, months, [yearly, monthsWithValue] per aggregate]
const CASES: [string, (number | null)[], Record<string, [number | null, number]>][] = [
  ['empty', none, { sum: [null, 0], avg: [null, 0], min: [null, 0], max: [null, 0] }],
  ['one value', one, { sum: [7, 1], avg: [7, 1], min: [7, 1], max: [7, 1] }],
  ['a gap in the middle', hole, { sum: [70, 3], avg: [70 / 3, 3], min: [10, 3], max: [40, 3] }],
  ['a negative value', negative, { sum: [-3, 3], avg: [-1, 3], min: [-5, 3], max: [3, 3] }],
  ['all twelve', twelve, { sum: [78, 12], avg: [6.5, 12], min: [1, 12], max: [12, 12] }],
  [
    'zero is a value',
    [0, gap, gap, gap, gap, gap, gap, gap, gap, gap, gap, 0],
    { sum: [0, 2], avg: [0, 2], min: [0, 2], max: [0, 2] },
  ],
];

describe('yearFigure', () => {
  for (const [name, months, expected] of CASES)
    for (const [aggregate, [yearly, monthsWithValue]] of Object.entries(expected))
      it(`${aggregate} of ${name} is ${yearly} over ${monthsWithValue} of 12 months`, () => {
        const figure = yearFigure(months, FUNCTIONS[aggregate]!);
        expect(figure.monthsWithValue).toBe(monthsWithValue);
        if (yearly === null) expect(figure.yearly).toBeNull();
        else expect(figure.yearly).toBeCloseTo(yearly, 10);
      });

  it('a gap is not a zero: the average of two months is over two, not twelve', () => {
    const figure = yearFigure([4, gap, gap, gap, gap, gap, gap, gap, gap, gap, gap, 8], avg);
    expect(figure).toEqual({ yearly: 6, monthsWithValue: 2 });
  });

  it('is null and not NaN when the function answers something that is no number', () => {
    expect(yearFigure(twelve, () => Number.NaN).yearly).toBeNull();
    expect(yearFigure(twelve, () => Number.POSITIVE_INFINITY).yearly).toBeNull();
    expect(yearFigure(twelve, () => null)).toEqual({ yearly: null, monthsWithValue: 12 });
  });

  it('counts a value that is no finite number as a gap', () => {
    expect(yearFigure([1, Number.NaN, undefined, 2], sum)).toEqual({
      yearly: 3,
      monthsWithValue: 2,
    });
  });
});

describe('monthEnds', () => {
  // [year, February, December]
  const YEARS: [number, string, string][] = [
    [2023, '2023-02-28', '2023-12-31'],
    [2024, '2024-02-29', '2024-12-31'], // a leap year
    [2100, '2100-02-28', '2100-12-31'], // divisible by 100, not by 400
    [2000, '2000-02-29', '2000-12-31'], // divisible by 400
  ];
  for (const [year, february, december] of YEARS)
    it(`has twelve month ends for ${year}: ${february} and ${december}`, () => {
      const ends = monthEnds(year);
      expect(ends).toHaveLength(12);
      expect(ends[1]).toBe(february);
      expect(ends[11]).toBe(december);
      expect(ends[0]).toBe(`${year}-01-31`);
      expect(ends).toEqual([...ends].sort());
    });

  it('is empty for a year that is no year', () => {
    for (const year of [0, -1, 1.5, 10000, Number.NaN]) expect(monthEnds(year)).toEqual([]);
  });
});

const value = fc.double({ min: -1e9, max: 1e9, noNaN: true });
const year = fc.array(
  fc.oneof({ weight: 3, arbitrary: value }, { weight: 1, arbitrary: fc.constant(null) }),
  {
    minLength: 12,
    maxLength: 12,
  },
);
const present = (months: (number | null)[]) => months.filter((v): v is number => v !== null);

describe('yearFigure: properties', () => {
  it('the average lies between the minimum and the maximum', () => {
    fc.assert(
      fc.property(year, (months) => {
        const mean = yearFigure(months, avg).yearly;
        const low = yearFigure(months, min).yearly;
        const high = yearFigure(months, max).yearly;
        if (mean === null) return low === null && high === null;
        return low! <= mean && mean <= high!;
      }),
    );
  });

  it('the sum of a series with gaps equals the sum of the series with the gaps removed', () => {
    fc.assert(
      fc.property(year, (months) => {
        const withGaps = yearFigure(months, sum);
        const without = yearFigure(present(months), sum);
        expect(withGaps.yearly).toBe(without.yearly);
        expect(withGaps.monthsWithValue).toBe(without.monthsWithValue);
      }),
    );
  });

  it('no function throws or returns NaN, and a year with no value is null for all of them', () => {
    fc.assert(
      fc.property(year, (months) => {
        for (const fn of Object.values(FUNCTIONS)) {
          const figure = yearFigure(months, fn);
          expect(figure.yearly === null || Number.isFinite(figure.yearly)).toBe(true);
          expect(figure.monthsWithValue).toBe(present(months).length);
          if (figure.monthsWithValue === 0) expect(figure.yearly).toBeNull();
        }
      }),
    );
  });

  it('never reorders or changes the months it is given', () => {
    fc.assert(
      fc.property(year, (months) => {
        const before = [...months];
        for (const fn of Object.values(FUNCTIONS)) yearFigure(months, fn);
        expect(months).toEqual(before);
      }),
    );
  });

  it('min and max do not depend on the order of the months, and the count is the number of values', () => {
    fc.assert(
      fc.property(year, (months) => {
        const reversed = [...months].reverse();
        expect(yearFigure(reversed, min)).toEqual(yearFigure(months, min));
        expect(yearFigure(reversed, max)).toEqual(yearFigure(months, max));
      }),
    );
  });
});
