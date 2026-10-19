import { describe, expect, it } from 'vitest';
import {
  changeQuery,
  indicatorsApiQuery,
  indicatorsQueryString,
  parseIndicatorsQuery,
  parseSetsQuery,
  setsApiQuery,
  setsQueryString,
} from './query.ts';

const params = (text: string) => new URLSearchParams(text);

describe('parseIndicatorsQuery', () => {
  it.each([
    [
      '',
      {
        q: undefined,
        thematic: undefined,
        unit: undefined,
        qualitative: undefined,
        page: 0,
        pageSize: 20,
      },
    ],
    [
      'q=views&thematic=Usage&unit=count&qualitative=true&page=2&pageSize=50',
      { q: 'views', thematic: 'Usage', unit: 'count', qualitative: true, page: 2, pageSize: 50 },
    ],
    [
      'qualitative=false',
      {
        q: undefined,
        thematic: undefined,
        unit: undefined,
        qualitative: false,
        page: 0,
        pageSize: 20,
      },
    ],
    [
      'qualitative=maybe&page=-1&pageSize=7',
      {
        q: undefined,
        thematic: undefined,
        unit: undefined,
        qualitative: undefined,
        page: 0,
        pageSize: 20,
      },
    ],
    [
      'thematic=a b&unit=%3Cx%3E&page=1.5',
      {
        q: undefined,
        thematic: undefined,
        unit: undefined,
        qualitative: undefined,
        page: 0,
        pageSize: 20,
      },
    ],
    [
      `q=${'x'.repeat(150)}`,
      {
        q: 'x'.repeat(100),
        thematic: undefined,
        unit: undefined,
        qualitative: undefined,
        page: 0,
        pageSize: 20,
      },
    ],
  ])('%j', (text, expected) => {
    expect(parseIndicatorsQuery(params(text))).toEqual(expected);
  });
});

describe('parseSetsQuery', () => {
  it('reads the search, the category and the page, and falls back for anything odd', () => {
    expect(parseSetsQuery(params('q=web&rimoCategory=Web_application&page=3'))).toEqual({
      q: 'web',
      rimoCategory: 'Web_application',
      page: 3,
      pageSize: 20,
    });
    expect(parseSetsQuery(params('rimoCategory=no way&pageSize=0'))).toEqual({
      q: undefined,
      rimoCategory: undefined,
      page: 0,
      pageSize: 20,
    });
  });
});

describe('the query strings and the API queries', () => {
  it('leave the defaults out and round-trip', () => {
    const query = parseIndicatorsQuery(params('q=a%26b&qualitative=false&page=2&pageSize=10'));
    expect(indicatorsQueryString(query)).toBe('?q=a%26b&qualitative=false&page=2&pageSize=10');
    expect(parseIndicatorsQuery(params(indicatorsQueryString(query).slice(1)))).toEqual(query);
    expect(indicatorsQueryString(parseIndicatorsQuery(params('')))).toBe('');
    expect(setsQueryString(parseSetsQuery(params('')))).toBe('');
    expect(setsQueryString(parseSetsQuery(params('rimoCategory=X&page=1')))).toBe(
      '?rimoCategory=X&page=1',
    );
  });

  it('send the page as text and only the filters that are set', () => {
    expect(
      indicatorsApiQuery(parseIndicatorsQuery(params('thematic=Usage&qualitative=true'))),
    ).toEqual({ page: '0', pageSize: '20', thematic: 'Usage', qualitative: 'true' });
    expect(setsApiQuery(parseSetsQuery(params('q=x')))).toEqual({
      page: '0',
      pageSize: '20',
      q: 'x',
    });
  });
});

describe('changeQuery', () => {
  it('goes back to the first page when a filter changes and keeps the filters when the page changes', () => {
    const query = parseIndicatorsQuery(params('q=a&page=4'));
    expect(changeQuery(query, { unit: 'count' }).page).toBe(0);
    expect(changeQuery(query, { pageSize: 50 }).page).toBe(0);
    expect(changeQuery(query, { page: 5 })).toEqual({ ...query, page: 5 });
  });
});
