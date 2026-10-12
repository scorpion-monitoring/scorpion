import { describe, expect, it } from 'vitest';
import {
  changeMembershipsQuery,
  changeSearchQuery,
  membershipsApiQuery,
  membershipsQueryString,
  parseMembershipsQuery,
  parseSearchQuery,
  searchApiQuery,
  searchQueryString,
  SEARCH_PAGE_SIZE,
} from './member-query.ts';

const params = (text: string) => new URLSearchParams(text);
const ID = '0b9a4f0e-5f2e-4d63-9f43-0a1b2c3d4e5f';

describe('the search of the profile page', () => {
  it.each([
    ['', { q: undefined, type: undefined, page: 0 }],
    ['q=%20IPK%20&type=provider&page=2', { q: 'IPK', type: 'provider', page: 2 }],
    ['type=Not%20A%20Type&page=-1', { q: undefined, type: undefined, page: 0 }],
    ['page=1.5', { q: undefined, type: undefined, page: 0 }],
    ['pageSize=100', { q: undefined, type: undefined, page: 0 }], // the page size is not an input
  ])('reads %j', (text, expected) => {
    expect(parseSearchQuery(params(text))).toEqual(expected);
  });

  it('always asks for 5 per page, and leaves the page size out of the address', () => {
    expect(SEARCH_PAGE_SIZE).toBe(5);
    expect(searchApiQuery({ q: 'a', type: undefined, page: 3 })).toEqual({
      page: '3',
      pageSize: '5',
      q: 'a',
    });
    expect(searchQueryString({ q: 'a', type: 'provider', page: 1 })).toBe(
      '?q=a&type=provider&page=1',
    );
    expect(searchQueryString({ q: undefined, type: undefined, page: 0 })).toBe('');
  });

  it('goes back to the first page when the search or the type changes, and keeps the filters when the page does', () => {
    const query = { q: 'a', type: 'provider', page: 4 };
    expect(changeSearchQuery(query, { q: 'b' })).toEqual({ q: 'b', type: 'provider', page: 0 });
    expect(changeSearchQuery(query, { type: undefined })).toEqual({
      q: 'a',
      type: undefined,
      page: 0,
    });
    expect(changeSearchQuery(query, { page: 5 })).toEqual({ q: 'a', type: 'provider', page: 5 });
  });
});

describe('the list of membership requests', () => {
  it.each([
    ['', { state: 'requested', organisationId: undefined, type: undefined, page: 0, pageSize: 20 }],
    [
      `state=approved&organisation=${ID}&type=provider&page=3&pageSize=50`,
      { state: 'approved', organisationId: ID, type: 'provider', page: 3, pageSize: 50 },
    ],
    [
      'state=banana&organisation=not-a-uuid&pageSize=7',
      { state: 'requested', organisationId: undefined, type: undefined, page: 0, pageSize: 20 },
    ],
  ])('reads %j', (text, expected) => {
    expect(parseMembershipsQuery(params(text))).toEqual(expected);
  });

  it('writes the address without the defaults and the API query with them', () => {
    const query = parseMembershipsQuery(params(`state=left&organisation=${ID}`));
    expect(membershipsQueryString(query)).toBe(`?state=left&organisation=${ID}`);
    expect(membershipsApiQuery(query)).toEqual({
      page: '0',
      pageSize: '20',
      state: 'left',
      organisationId: ID,
    });
    expect(membershipsQueryString(parseMembershipsQuery(params('')))).toBe('');
  });

  it('goes back to the first page when a filter changes', () => {
    const query = parseMembershipsQuery(params('page=3'));
    expect(changeMembershipsQuery(query, { state: 'approved' }).page).toBe(0);
    expect(changeMembershipsQuery(query, { organisationId: ID }).page).toBe(0);
    expect(changeMembershipsQuery(query, { page: 4 }).page).toBe(4);
  });
});
