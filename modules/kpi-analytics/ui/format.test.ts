import { describe, expect, it } from 'vitest';
import {
  barFill,
  changeView,
  formatLatest,
  formatNumber,
  formatPercent,
  monthLabel,
} from './format.ts';

describe('formatLatest', () => {
  it.each<[string, { value: number | null; text: string }, string, string]>([
    ['a whole number', { value: 1234, text: '1234' }, 'en', '1,234'],
    ['a decimal in German', { value: 1234.5, text: '1234.5' }, 'de', '1.234,5'],
    ['a long decimal is cut at two places', { value: 3.14159, text: '3.14159' }, 'en', '3.14'],
    ['a negative number', { value: -3.5, text: '-3.5' }, 'en', '-3.5'],
    [
      'a duration stays as the server wrote it',
      { value: 3725, text: '01-02-05' },
      'en',
      '01-02-05',
    ],
    ['a text stays as it is', { value: null, text: 'all well' }, 'en', 'all well'],
    ['a text that looks like a number is still a text', { value: null, text: '42' }, 'en', '42'],
    ['a number whose text is not a plain decimal', { value: 1000, text: '1e3' }, 'en', '1e3'],
  ])('%s', (_name, latest, locale, expected) => {
    expect(formatLatest(latest, locale)).toBe(expected);
  });
});

describe('changeView', () => {
  it.each<[number | null, string, string, string]>([
    [12.5, 'up', '▲', '12.5 %'],
    [-3.04, 'down', '▼', '3 %'],
    [0, 'flat', '=', '0 %'],
    [0.04, 'flat', '=', '0 %'],
    [-0.04, 'flat', '=', '0 %'],
    [0.05, 'up', '▲', '0.1 %'],
    [1000, 'up', '▲', '1,000 %'],
    [null, 'none', '–', ''],
    [Number.NaN, 'none', '–', ''],
    [Number.POSITIVE_INFINITY, 'none', '–', ''],
  ])('%s is %s with %s and "%s"', (change, direction, arrow, amount) => {
    expect(changeView(change, 'en')).toEqual({ direction, arrow, amount });
  });

  it('writes the amount in the language of the person', () => {
    expect(changeView(12.5, 'de').amount).toBe('12,5 %');
  });
});

describe('monthLabel, formatNumber, formatPercent, barFill', () => {
  it('writes a month in the language, and leaves a string that is not a date alone', () => {
    expect(monthLabel('2026-03-31', 'en')).toBe('Mar 2026');
    expect(monthLabel('2026-03-31', 'de')).toContain('2026');
    for (const bad of ['', 'March', '2026-13-01', '2026-00-10', '2026-3-1'])
      expect(monthLabel(bad, 'en')).toBe(bad);
  });
  it('writes numbers and fractions', () => {
    expect(formatNumber(0.1 + 0.2, 'en')).toBe('0.3');
    expect(formatPercent(0.1234, 'en')).toBe('12.3 %');
    expect(formatPercent(0.1234, 'de')).toBe('12,3 %');
  });
  it.each([
    [null, 0],
    [0, 0],
    [0.25, 0.25],
    [1, 1],
    [7, 1],
    [-1, 0],
    [Number.NaN, 0],
  ])('fills a bar of %s by %s', (fraction, fill) => {
    expect(barFill(fraction)).toBe(fill);
  });
});
