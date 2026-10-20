import { describe, expect, it } from 'vitest';
import { chooseMonth, monthChoices, monthLabel, monthOf, offeredMonths } from './months.ts';

// The coverage is oldest first, and its last month is the current one by the server's clock.
const coverage = ['2026-03-31', '2026-04-30', '2026-05-31'].map((period) => ({ period }));

describe('the months on offer', () => {
  it('takes the month of a period and lists the months newest first', () => {
    expect(monthOf('2026-05-31')).toBe('2026-05');
    expect(offeredMonths(coverage)).toEqual(['2026-05', '2026-04', '2026-03']);
    expect(offeredMonths([])).toEqual([]);
  });

  it.each<[string | undefined, string | undefined]>([
    [undefined, '2026-05'],
    ['2026-04', '2026-04'],
    ['2026-05', '2026-05'],
    ['2026-03', '2026-03'],
    // older than everything offered: a correction of an old month is allowed
    ['2025-11', '2025-11'],
    // later than the server's current month: never offered, the current month opens instead
    ['2026-06', '2026-05'],
    ['2031-01', '2026-05'],
    // not a month at all
    ['2026-13', '2026-05'],
    ['soon', '2026-05'],
    ['', '2026-05'],
  ])('opens %s on %s', (requested, expected) => {
    expect(chooseMonth(requested, offeredMonths(coverage))).toBe(expected);
  });

  it('opens nothing when nothing is offered', () => {
    expect(chooseMonth('2026-04', [])).toBeUndefined();
  });

  it('adds a chosen month older than the list to the choices, once', () => {
    const offered = offeredMonths(coverage);
    expect(monthChoices(offered, '2025-11')).toEqual([...offered, '2025-11']);
    expect(monthChoices(offered, '2026-04')).toEqual(offered);
    expect(monthChoices(offered, undefined)).toEqual(offered);
  });
});

describe('monthLabel', () => {
  it.each<[string, string, string]>([
    ['2026-05', 'en', 'May 2026'],
    ['2026-05', 'de', 'Mai 2026'],
    ['2026-01', 'en', 'January 2026'],
    ['2026-12', 'de', 'Dezember 2026'],
  ])('writes %s in %s as %s, whatever the time zone', (month, locale, expected) => {
    expect(monthLabel(month, locale)).toBe(expected);
  });

  it('returns what is not a month as it is', () => {
    expect(monthLabel('later', 'en')).toBe('later');
  });
});
