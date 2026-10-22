import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sparkline, sparkSummary } from './spark.ts';

describe('sparkline', () => {
  it.each<[string, (number | null)[], string]>([
    ['a rising line', [0, 10], 'M2 38 L98 2'],
    ['a falling line', [10, 0], 'M2 2 L98 38'],
    ['three values', [0, 5, 10], 'M2 38 L50 20 L98 2'],
    ['a flat line through the middle', [4, 4, 4], 'M2 20 L50 20 L98 20'],
    ['a gap breaks the line (the lone value before it is a dot)', [0, null, 10, 5], 'M66 2 L98 20'],
  ])('%s', (_name, values, d) => {
    // a run of one value is a dot, not a path, so a path with a lone `M` is never drawn
    expect(sparkline(values, 100, 40).d).toBe(d);
  });

  it('draws a lone value as a dot in the middle, and a value after a gap as a dot', () => {
    expect(sparkline([7], 100, 40)).toEqual({ d: '', dots: [[50, 20]], count: 1 });
    const gapped = sparkline([1, null, 3, null, 5], 100, 40);
    expect(gapped.d).toBe('');
    expect(gapped.dots).toHaveLength(3);
  });

  it.each<[string, (number | null | undefined)[]]>([
    ['nothing', []],
    ['only gaps', [null, null]],
    ['values that are not numbers', [Number.NaN, Number.POSITIVE_INFINITY, undefined]],
  ])('draws nothing for %s', (_name, values) => {
    expect(sparkline(values, 100, 40)).toEqual({ d: '', dots: [], count: 0 });
  });

  it('draws nothing in a box too small for its padding', () => {
    expect(sparkline([1, 2], 3, 40, 2).count).toBe(0);
    expect(sparkline([1, 2], 100, 4, 2).count).toBe(0);
  });

  it('never turns a gap into a zero: the number of drawn values is the number of numbers', () => {
    expect(sparkline([0, null, 0], 100, 40).count).toBe(2);
  });

  it('is only digits, dots, spaces and the letters M and L, whatever the values (a property: no data string can reach the markup)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.double({ noNaN: false }), { nil: null }), { maxLength: 30 }),
        (values) => {
          const { d, dots } = sparkline(values, 100, 40);
          expect(d).toMatch(/^[ML0-9. -]*$/);
          expect(d).not.toContain('NaN');
          for (const [x, y] of dots) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        },
      ),
    );
  });

  it('keeps every point inside its box (a property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 }), {
          minLength: 2,
          maxLength: 24,
        }),
        (values) => {
          const { d } = sparkline(values, 100, 40, 2);
          for (const match of d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)) {
            const [x, y] = [Number(match[1]), Number(match[2])];
            expect(x).toBeGreaterThanOrEqual(2);
            expect(x).toBeLessThanOrEqual(98);
            expect(y).toBeGreaterThanOrEqual(2);
            expect(y).toBeLessThanOrEqual(38);
          }
        },
      ),
    );
  });
});

describe('sparkSummary', () => {
  it('names the count, the first and the last value that exist', () => {
    expect(sparkSummary([null, 3, null, 8, 5, null])).toEqual({ count: 3, first: 3, last: 5 });
    expect(sparkSummary([4])).toEqual({ count: 1, first: 4, last: 4 });
    expect(sparkSummary([null, null])).toBeNull();
    expect(sparkSummary([])).toBeNull();
  });
});
