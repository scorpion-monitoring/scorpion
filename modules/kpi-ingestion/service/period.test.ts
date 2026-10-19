// normalisePeriod and daysInMonth: pure, table-driven. "Now" is a parameter, so nothing here depends on the date it runs.
import { describe, expect, it } from 'vitest';
import { daysInMonth, MIN_YEAR, normalisePeriod, PERIOD_FORMS } from './period.ts';

const NOW = new Date('2026-06-15T12:00:00Z');

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2026, 3, 31],
    [2026, 4, 30],
    [2026, 5, 31],
    [2026, 6, 30],
    [2026, 7, 31],
    [2026, 8, 31],
    [2026, 9, 30],
    [2026, 10, 31],
    [2026, 11, 30],
    [2026, 12, 31],
    // The leap rule: divisible by 4, not by 100, unless by 400.
    [1900, 2, 28],
    [2000, 2, 29],
    [2024, 2, 29],
    [2100, 2, 28],
    [2400, 2, 29],
    [2023, 2, 28],
  ])('%i-%i has %i days', (year, month, days) => {
    expect(daysInMonth(year, month)).toBe(days);
  });
});

describe('normalisePeriod accepts', () => {
  it.each([
    // a month gives its last day, whatever the length
    ['2026-01', '2026-01-31'],
    ['2026-02', '2026-02-28'],
    ['2026-03', '2026-03-31'],
    ['2026-04', '2026-04-30'],
    ['2026-05', '2026-05-31'],
    ['2026-06', '2026-06-30'],
    ['2025-07', '2025-07-31'],
    ['2025-08', '2025-08-31'],
    ['2025-09', '2025-09-30'],
    ['2025-10', '2025-10-31'],
    ['2025-11', '2025-11-30'],
    ['2025-12', '2025-12-31'],
    // leap years
    ['1900-02', '1900-02-28'],
    ['2000-02', '2000-02-29'],
    ['2024-02', '2024-02-29'],
    ['2024-02-29', '2024-02-29'],
    ['2000-02-29', '2000-02-29'],
    ['2023-02', '2023-02-28'],
    // any day of the month names the month
    ['2026-01-01', '2026-01-31'],
    ['2026-01-15', '2026-01-31'],
    ['2026-01-31', '2026-01-31'],
    ['2026-02-28', '2026-02-28'],
    ['2026-04-30', '2026-04-30'],
    ['2026-04-01', '2026-04-30'],
    // the current month, the first and last day of the current month
    ['2026-06', '2026-06-30'],
    ['2026-06-01', '2026-06-30'],
    ['2026-06-30', '2026-06-30'],
    // the oldest year accepted
    [`${MIN_YEAR}-01`, `${MIN_YEAR}-01-31`],
    // surrounding spaces (a spreadsheet cell) are ignored
    [' 2026-03 ', '2026-03-31'],
    ['\t2026-03-10\n', '2026-03-31'],
  ])('%j as %s', (input, expected) => {
    expect(normalisePeriod(input, NOW)).toEqual({ ok: true, value: expected });
  });
});

describe('normalisePeriod refuses', () => {
  it.each<[string, unknown]>([
    ['an empty text', ''],
    ['spaces only', '   '],
    ['a tab', '\t'],
    ['a two-digit year', '26-01'],
    ['a year alone', '2026'],
    ['a one-digit month', '2026-1'],
    ['a one-digit day', '2026-01-5'],
    ['another separator', '2026/01'],
    ['another separator with a day', '2026.01.15'],
    ['a day first', '15.01.2026'],
    ['a month name', 'January 2026'],
    ['a time after the date', '2026-01-31T00:00:00Z'],
    ['a time with a space', '2026-01-31 00:00'],
    ['a time with an offset', '2026-01-31T00:00:00+02:00'],
    ['a trailing text', '2026-01x'],
    ['a sign', '+2026-01'],
    ['a fifth digit in the year', '12026-01'],
    ['an internal space', '2026- 01'],
    ['a number', 202601],
    ['a Date object', new Date('2026-01-31')],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['a list', ['2026-01']],
    ['a boolean', true],
  ])('%s', (_name, input) => {
    const result = normalisePeriod(input, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain(PERIOD_FORMS);
  });

  it.each([
    ['2026-00', 'is not a month'],
    ['2026-13', 'is not a month'],
    ['2026-99', 'is not a month'],
    ['2026-02-30', 'that month has 28 days'],
    ['2026-02-29', 'that month has 28 days'],
    ['1900-02-29', 'that month has 28 days'],
    ['2100-02-29', 'that month has 28 days'],
    ['2024-02-30', 'that month has 29 days'],
    ['2026-04-31', 'that month has 30 days'],
    ['2026-01-32', 'that month has 31 days'],
    ['2026-01-00', 'that month has 31 days'],
    ['2026-11-31', 'that month has 30 days'],
  ])('%s: %s', (input, reason) => {
    const result = normalisePeriod(input, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain(reason);
  });

  it.each(['1899-12', '1899-12-31', '1000-01', '0001-01', '0000-01'])(
    'a year before %s is too early',
    (input) => {
      const result = normalisePeriod(input, NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).toContain('too early');
    },
  );

  it('never repeats the input in its message (a cell can hold anything)', () => {
    const hostile = '<script>alert(1)</script>2026-13';
    const result = normalisePeriod(hostile, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).not.toContain('script');
  });
});

describe('normalisePeriod and the clock', () => {
  it.each([
    // the current month is allowed, whatever the day, and so is every earlier one
    ['2026-06-15T12:00:00Z', '2026-06', true],
    ['2026-06-01T00:00:00Z', '2026-06-30', true],
    ['2026-06-30T23:59:59Z', '2026-06', true],
    ['2026-06-15T12:00:00Z', '2026-05', true],
    ['2026-06-15T12:00:00Z', '2025-12', true],
    // the next month is the future, on the first and the last day of the current month
    ['2026-06-15T12:00:00Z', '2026-07', false],
    ['2026-06-30T23:59:59Z', '2026-07', false],
    ['2026-06-30T23:59:59Z', '2026-07-01', false],
    ['2026-06-01T00:00:00Z', '2026-07-31', false],
    // across a year end
    ['2026-12-31T23:59:59Z', '2026-12', true],
    ['2026-12-31T23:59:59Z', '2027-01', false],
    ['2027-01-01T00:00:00Z', '2027-01', true],
    ['2027-01-01T00:00:00Z', '2026-12', true],
    ['2026-01-10T00:00:00Z', '2026-12', false],
    ['2026-01-10T00:00:00Z', '2027-01', false],
    ['2026-01-10T00:00:00Z', '2030-06', false],
    // the clock is read in UTC, not in the offset it is written with: 1 July 01:30 at +03:00 is still 30 June in UTC,
    // and 30 June 22:30 at -03:00 is already 1 July
    ['2026-07-01T01:30:00+03:00', '2026-07', false],
    ['2026-07-01T01:30:00+03:00', '2026-06', true],
    ['2026-06-30T22:30:00-03:00', '2026-07', true],
  ])('at %s the period %s is allowed: %s', (now, period, allowed) => {
    const result = normalisePeriod(period, new Date(now));
    expect(result.ok).toBe(allowed);
    if (!result.ok) expect(result.problem).toContain('future');
  });
});
