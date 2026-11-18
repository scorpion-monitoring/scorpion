import { describe, expect, it } from 'vitest';
import { parseLegacyDate } from './dates.ts';

describe('parseLegacyDate', () => {
  it.each([
    // [input, month, day, first of month]
    ['2023-01-01 00:00:00+00:00', '2023-01', 1, true],
    ['2023-01-01T00:00:00Z', '2023-01', 1, true],
    ['2023-03-15 00:00:00+00:00', '2023-03', 15, false],
    ['2023-03-15', '2023-03', 15, false],
    ['2023-03-01', '2023-03', 1, true],
    ['2023-03-01 12:30:00+00:00', '2023-03', 1, false],
    ['2023-03-01 00:00:00.123456+00:00', '2023-03', 1, true],
    ['2024-02-29 00:00:00+00:00', '2024-02', 29, false],
    ['1899-12-01 00:00:00+00:00', '1899-12', 1, true],
    // An offset moves the instant: 00:30 at +01:00 is the last day of the month before, in UTC.
    ['2023-04-01 00:30:00+01:00', '2023-03', 31, false],
    ['2023-04-01T00:00:00+0000', '2023-04', 1, true],
  ])('%s → %s, day %d, first of month %s', (input, month, day, first) => {
    const parsed = parseLegacyDate(input);
    expect(parsed).toMatchObject({ month, day, firstOfMonth: first });
  });

  it.each([
    ['empty', ''],
    ['a month only', '2023-01'],
    ['not a date', 'yesterday'],
    ['month 13', '2023-13-01 00:00:00+00:00'],
    ['day 0', '2023-01-00'],
    ['31 April', '2023-04-31'],
    ['29 February of a common year', '2023-02-29'],
    ['hour 24', '2023-01-01 24:00:00+00:00'],
    ['a trailing word', '2023-01-01 00:00:00+00:00 UTC'],
  ])('refuses %s', (_name, input) => {
    expect(parseLegacyDate(input)).toBeUndefined();
  });

  it('orders points of one month by their instant', () => {
    const early = parseLegacyDate('2023-03-01 00:00:00+00:00')!;
    const late = parseLegacyDate('2023-03-20 00:00:00+00:00')!;
    expect(early.month).toBe(late.month);
    expect(late.time).toBeGreaterThan(early.time);
  });
});
