import { describe, expect, it } from 'vitest';
import { DEMO_MONTHS, demoValue } from './demo-seed.ts';

const indicator = (valueType: string, min: number | null = null, max: number | null = null) => ({
  valueType,
  min,
  max,
});

describe('demoValue', () => {
  it.each([
    ['an integer', indicator('integer', 0), 0, 0, 40],
    ['an integer, a later service and month', indicator('integer', 0), 2, 3, 126],
    ['a percentage', indicator('percentage'), 0, 0, 97],
    ['a float inside its bounds', indicator('float', 1, 5), 0, 0, 3.4],
    ['a text', indicator('text'), 0, 0, 'demo'],
  ])('gives %s the expected value', (_name, row, service, month, expected) => {
    expect(demoValue(row, service, month)).toBe(expected);
  });

  it('keeps every value inside the bounds of its type for every service and month', () => {
    for (let service = 0; service < 10; service++) {
      for (let month = 0; month < DEMO_MONTHS.length; month++) {
        const percentage = demoValue(indicator('percentage'), service, month) as number;
        expect(percentage).toBeGreaterThanOrEqual(0);
        expect(percentage).toBeLessThanOrEqual(100);
        const float = demoValue(indicator('float', 1, 5), service, month) as number;
        expect(float).toBeGreaterThanOrEqual(1);
        expect(float).toBeLessThanOrEqual(5);
      }
    }
  });

  it('is the same on every call, so a second seed changes nothing', () => {
    expect(demoValue(indicator('integer', 0), 3, 4)).toBe(demoValue(indicator('integer', 0), 3, 4));
  });
});

describe('the demo months', () => {
  it('are six past months, in order, and not after any plausible current month', () => {
    expect(DEMO_MONTHS).toHaveLength(6);
    expect([...DEMO_MONTHS].sort()).toEqual([...DEMO_MONTHS]);
    for (const month of DEMO_MONTHS) expect(month).toMatch(/^2026-(0[1-6])$/);
  });
});
