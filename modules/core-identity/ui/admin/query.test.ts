import { describe, expect, it } from 'vitest';
import {
  changeQuery,
  DEFAULT_QUERY,
  pageQueryString,
  parseUsersQuery,
  SEARCH_MAX,
  usersApiQuery,
  usersQueryString,
} from './query.ts';

const parse = (query: string) => parseUsersQuery(new URLSearchParams(query));

describe('parseUsersQuery', () => {
  it('gives the defaults for a plain address', () => {
    expect(parse('')).toEqual(DEFAULT_QUERY);
  });

  it.each([
    ['page=3', { page: 3 }],
    ['page=-1', {}],
    ['page=abc', {}],
    ['page=99999999', {}],
    ['pageSize=50', { pageSize: 50 }],
    ['pageSize=7', {}],
    ['pageSize=1000', {}],
    ['status=pending', { status: 'pending' }],
    ['status=deactivated', { status: 'deactivated' }],
    ['status=nobody', {}],
    ['q=%20ann%20', { q: 'ann' }],
    ['q=', {}],
    ['sort=createdAt&dir=desc', { sort: 'createdAt', dir: 'desc' }],
    ['sort=password', {}],
    ['dir=up', {}],
  ])('reads %s', (query, expected) => {
    expect(parse(query)).toEqual({ ...DEFAULT_QUERY, ...expected });
  });

  it('cuts a search text at the length the API takes', () => {
    expect(parse(`q=${'x'.repeat(500)}`).q).toHaveLength(SEARCH_MAX);
  });
});

describe('usersQueryString', () => {
  it('is empty for the defaults and writes only what differs', () => {
    expect(usersQueryString(DEFAULT_QUERY)).toBe('');
    expect(
      usersQueryString({
        ...DEFAULT_QUERY,
        page: 2,
        status: 'active',
        q: 'ann',
        sort: 'email',
        dir: 'desc',
      }),
    ).toBe('?page=2&status=active&q=ann&sort=email&dir=desc');
  });

  it('round-trips through parseUsersQuery', () => {
    const query = {
      ...DEFAULT_QUERY,
      page: 4,
      pageSize: 50,
      status: 'rejected' as const,
      q: 'a b&c',
      sort: 'status' as const,
    };
    expect(parse(usersQueryString(query))).toEqual(query);
  });
});

describe('usersApiQuery', () => {
  it('sends every value as a string and leaves out what is not set', () => {
    expect(usersApiQuery(DEFAULT_QUERY)).toEqual({
      page: '0',
      pageSize: '20',
      sort: 'username',
      dir: 'asc',
    });
    expect(usersApiQuery({ ...DEFAULT_QUERY, status: 'pending', q: 'x' })).toMatchObject({
      status: 'pending',
      q: 'x',
    });
  });
});

describe('changeQuery', () => {
  const current = { ...DEFAULT_QUERY, page: 3, status: 'active' as const };

  it('keeps the page when only the page changes', () => {
    expect(changeQuery(current, { page: 4 }).page).toBe(4);
  });

  it.each([
    { status: 'pending' as const },
    { q: 'x' },
    { sort: 'email' as const },
    { pageSize: 50 },
  ])('starts again at the first page when %j changes', (change) => {
    expect(changeQuery(current, change).page).toBe(0);
  });
});

describe('pageQueryString', () => {
  it.each([
    [0, 20, ''],
    [2, 20, '?page=2'],
    [0, 50, '?pageSize=50'],
    [3, 100, '?page=3&pageSize=100'],
  ])('writes page %i of size %i as "%s"', (page, size, expected) => {
    expect(pageQueryString(page, size)).toBe(expected);
  });
});
