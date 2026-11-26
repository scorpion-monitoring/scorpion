// The pure helpers of the section "Publications", table-driven.
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import { authorLine, doiHref, historySpec, issuedText, waitMinutes } from './format.ts';
import { messages } from './messages.ts';

describe('authorLine', () => {
  const etAl = (first: string) => `${first} et al.`;
  it.each([
    [[], null],
    [['Ada Lovelace'], 'Ada Lovelace'],
    [['A', 'B', 'C'], 'A, B, C'],
    [['A', 'B', 'C', 'D'], 'A et al.'],
    [Array.from({ length: 100 }, (_, i) => `P${i}`), 'P0 et al.'],
  ] as const)('%j → %j', (authors, line) => {
    expect(authorLine(authors, etAl)).toBe(line);
  });
});

describe('issuedText', () => {
  it.each([
    [null, 'en', null],
    ['2020', 'en', '2020'],
    ['2020-09', 'en', 'September 2020'],
    ['2020-09-16', 'en', 'September 16, 2020'],
    ['2020-09', 'de', 'September 2020'],
    ['2020-09-16', 'de', '16. September 2020'],
    // The first and last day of a year stay in their year in every time zone (UTC).
    ['2020-01-01', 'en', 'January 1, 2020'],
    ['2020-12-31', 'en', 'December 31, 2020'],
  ] as const)('%s in %s → %s', (issued, locale, text) => {
    expect(issuedText(issued, locale)).toBe(text);
  });
});

describe('waitMinutes', () => {
  it.each([
    [undefined, 10],
    [1, 1],
    [60, 1],
    [61, 2],
    [599, 10],
    [0, 1],
  ] as const)('%s s → %s min', (seconds, minutes) => {
    expect(waitMinutes(seconds)).toBe(minutes);
  });
});

describe('doiHref', () => {
  it.each([
    ['10.1234/abc', 'https://doi.org/10.1234/abc'],
    ['10.5281/zenodo.4724125', 'https://doi.org/10.5281/zenodo.4724125'],
    ['10.1002/(sici)1097-4571', 'https://doi.org/10.1002/(sici)1097-4571'],
    ['10.1234/a b#c?d', 'https://doi.org/10.1234/a%20b%23c%3Fd'],
    ['10.1234/x/y', 'https://doi.org/10.1234/x/y'],
  ] as const)('%s → %s', (doi, href) => {
    expect(doiHref(doi)).toBe(href);
  });
});

describe('historySpec', () => {
  const points = [
    { source: 'openalex', day: '2026-06-01', citedByCount: 3 },
    { source: 'other', day: '2026-06-01', citedByCount: 9 },
    { source: 'openalex', day: '2026-06-08', citedByCount: 5 },
  ];
  it('draws the points of the source the list shows, oldest first', () => {
    expect(historySpec(points, 'openalex', 'Citations', 'en')).toEqual({
      type: 'line',
      categories: ['Jun 1, 2026', 'Jun 8, 2026'],
      series: [{ name: 'Citations', values: [3, 5] }],
    });
  });
  it('draws nothing without a point', () => {
    expect(historySpec([], 'openalex', 'Citations', 'en')).toBeNull();
    expect(historySpec(points, 'none', 'Citations', 'en')).toBeNull();
  });
});

describe('the texts', () => {
  it('exist in English and German with the same placeholders and plural forms', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });
});
