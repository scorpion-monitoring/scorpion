import { describe, expect, it } from 'vitest';
import {
  changeOrganisationsQuery,
  ORGANISATION_PAGE_SIZE,
  organisationsApiQuery,
  organisationsQueryString,
  parseOrganisationsQuery,
  type OrganisationsQuery,
} from './query.ts';

const parse = (search: string) => parseOrganisationsQuery(new URLSearchParams(search));
const DEFAULT: OrganisationsQuery = {
  q: undefined,
  type: undefined,
  page: 0,
  pageSize: ORGANISATION_PAGE_SIZE,
};

describe('parseOrganisationsQuery', () => {
  it.each<[string, Partial<OrganisationsQuery>]>([
    ['', {}],
    ['q=ipk', { q: 'ipk' }],
    ['q=%20%20ipk%20', { q: 'ipk' }],
    ['q=', {}],
    ['type=provider', { type: 'provider' }],
    ['type=Not%20A%20Type', {}],
    ['type=../x', {}],
    ['page=3', { page: 3 }],
    ['page=-1', {}],
    ['page=1.5', {}],
    ['page=abc', {}],
    ['page=99999999', {}],
    ['pageSize=50', { pageSize: 50 }],
    ['pageSize=7', {}],
    ['pageSize=1000', {}],
  ])('%j', (search, expected) => {
    expect(parse(search)).toEqual({ ...DEFAULT, ...expected });
  });

  it('cuts a very long search at 100 characters', () => {
    expect(parse(`q=${'a'.repeat(500)}`).q).toHaveLength(100);
  });
});

describe('organisationsQueryString', () => {
  it('leaves the defaults out and round-trips the rest', () => {
    expect(organisationsQueryString(DEFAULT)).toBe('');
    const query: OrganisationsQuery = { q: 'a b&c', type: 'consortium', page: 2, pageSize: 50 };
    expect(parse(organisationsQueryString(query).slice(1))).toEqual(query);
  });
});

describe('changeOrganisationsQuery', () => {
  const base: OrganisationsQuery = { q: 'x', type: 'provider', page: 4, pageSize: 20 };
  it('goes back to the first page when a filter or the page size changes, and keeps the page for a page change', () => {
    expect(changeOrganisationsQuery(base, { q: 'y' }).page).toBe(0);
    expect(changeOrganisationsQuery(base, { type: undefined }).page).toBe(0);
    expect(changeOrganisationsQuery(base, { pageSize: 50 }).page).toBe(0);
    expect(changeOrganisationsQuery(base, { page: 5 })).toEqual({ ...base, page: 5 });
  });
});

describe('organisationsApiQuery', () => {
  it('names the page and the size as the API takes them (0-based), and only the filters that are set', () => {
    expect(organisationsApiQuery(DEFAULT)).toEqual({ page: '0', pageSize: '20' });
    expect(organisationsApiQuery({ q: 'ipk', type: 'provider', page: 2, pageSize: 10 })).toEqual({
      page: '2',
      pageSize: '10',
      q: 'ipk',
      type: 'provider',
    });
  });
});
