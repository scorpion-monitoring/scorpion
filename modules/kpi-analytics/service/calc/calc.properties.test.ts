// Properties of the calculation library (M11 sprint 3). Whatever a series holds, nothing throws, nothing returns NaN or an infinity, and a gap
// never becomes a zero.
import fc from 'fast-check';
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
  monthsBack,
  sum,
} from './index.ts';

const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
const moderate = fc.double({ min: -1e9, max: 1e9, noNaN: true });
const nonNegative = fc.double({ min: 0, max: 1e9, noNaN: true });
const series = (value: fc.Arbitrary<number>) =>
  fc.array(fc.oneof({ weight: 4, arbitrary: value }, { weight: 1, arbitrary: fc.constant(null) }), {
    maxLength: 40,
  });
/** Anything a caller could hand over, including what is no number at all. */
const anything = fc.array(
  fc.oneof(
    fc.double(),
    fc.constant(null),
    fc.constant(undefined),
    fc.string(),
    fc.constant(Number.NaN),
    fc.constant(Infinity),
    fc.constant(-Infinity),
  ),
  { maxLength: 40 },
);

const isNumberOrNull = (value: unknown) =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

describe('the calculation library: properties', () => {
  it('the average lies between the minimum and the maximum', () => {
    fc.assert(
      fc.property(series(finite), (values) => {
        const mean = avg(values);
        const low = min(values);
        const high = max(values);
        if (mean === null) return low === null && high === null;
        return low !== null && high !== null && mean >= low && mean <= high;
      }),
    );
  });

  it('the cumulative series keeps the length and the gaps, and does not decrease for non-negative input', () => {
    fc.assert(
      fc.property(series(nonNegative), (values) => {
        const total = cumulative(values);
        expect(total).toHaveLength(values.length);
        values.forEach((value, index) => {
          if (value === null) expect(total[index]).toBeNull();
        });
        const numbers = total.filter((value): value is number => value !== null);
        for (let index = 1; index < numbers.length; index++)
          expect(numbers[index]!).toBeGreaterThanOrEqual(numbers[index - 1]!);
      }),
    );
  });

  it('the cumulative series ends at the sum when it fits', () => {
    fc.assert(
      fc.property(series(moderate), (values) => {
        const last = cumulative(values)
          .filter((value) => value !== null)
          .at(-1);
        const total = sum(values);
        if (total === null) expect(last).toBeUndefined();
        else expect(last).toBeCloseTo(total, 3);
      }),
    );
  });

  it('MAPE is never negative, and is zero for a constant series', () => {
    fc.assert(
      fc.property(series(moderate), (values) => {
        const score = mape(values);
        if (score !== null) expect(score).toBeGreaterThanOrEqual(0);
      }),
    );
    fc.assert(
      fc.property(
        finite.filter((value) => value !== 0),
        fc.integer({ min: 2, max: 30 }),
        (value, length) => mape(Array.from({ length }, () => value)) === 0,
      ),
    );
  });

  it('a gap is never counted as a zero: removing the gaps changes nothing, and adding a gap changes nothing', () => {
    fc.assert(
      fc.property(series(moderate), (values) => {
        const without = values.filter((value) => value !== null);
        expect(sum(values)).toBe(sum(without));
        expect(avg(values)).toBe(avg(without));
        expect(min(values)).toBe(min(without));
        expect(max(values)).toBe(max(without));
        expect(changePercent(values)).toBe(changePercent(without));
        expect(mape(values)).toBe(mape(without));
        expect(cumulative(values).filter((value) => value !== null)).toEqual(cumulative(without));
      }),
    );
  });

  it('nothing throws and nothing returns NaN or an infinity, for any input at all', () => {
    fc.assert(
      fc.property(anything, (values) => {
        for (const result of [
          sum(values as never),
          avg(values as never),
          min(values as never),
          max(values as never),
          changePercent(values as never),
          mape(values as never),
          ...cumulative(values as never),
        ])
          expect(isNumberOrNull(result)).toBe(true);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (values, thresholds) => {
        expect(() => band(values as never, thresholds as never)).not.toThrow();
        expect(() => sum(values as never)).not.toThrow();
        expect(() => cumulative(values as never)).not.toThrow();
        expect(() => alignToMonths(values as never, values as never)).not.toThrow();
      }),
    );
  });

  it('the change in percent has the sign of the move, for any non-zero oldest value', () => {
    fc.assert(
      fc.property(
        moderate.filter((value) => Math.abs(value) > 1e-3),
        moderate,
        (oldest, newest) => {
          const change = changePercent([oldest, newest]);
          expect(change).not.toBeNull();
          expect(Math.sign(change!)).toBe(Math.sign(newest - oldest));
        },
      ),
    );
  });

  it('a duration round-trips through its parts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 * 3600 + 3599 }), (seconds) => {
        const parts = durationParts(seconds)!;
        expect(durationSeconds(parts.hours, parts.minutes, parts.seconds)).toBe(seconds);
      }),
    );
  });

  it('a window of N months has N distinct months in order, the last being the clock month', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('1950-01-01'), max: new Date('2200-01-01'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 120 }),
        (now, count) => {
          const months = monthsBack(now, count);
          expect(months).toHaveLength(count);
          expect(new Set(months).size).toBe(count);
          expect([...months].sort()).toEqual(months);
          expect(months.at(-1)!.slice(0, 7)).toBe(now.toISOString().slice(0, 7));
        },
      ),
    );
  });
});
