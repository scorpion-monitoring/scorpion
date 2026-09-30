import { describe, expect, it } from 'vitest';
import { listEnvelope, pageOffset, paginate, paginationQuery } from './envelope.ts';
import { z } from './route.ts';

describe('paginationQuery', () => {
  const query = paginationQuery();

  const valid: [string, Record<string, string>, { page: number; pageSize: number }][] = [
    ['no parameters use the defaults', {}, { page: 0, pageSize: 20 }],
    ['page 0 is the first page', { page: '0' }, { page: 0, pageSize: 20 }],
    ['an explicit page and size', { page: '3', pageSize: '50' }, { page: 3, pageSize: 50 }],
    ['the largest page size', { pageSize: '100' }, { page: 0, pageSize: 100 }],
    ['size 1', { pageSize: '1' }, { page: 0, pageSize: 1 }],
    ['leading zeros are digits', { page: '007' }, { page: 7, pageSize: 20 }],
  ];
  it.each(valid)('%s', (_name, input, expected) => {
    expect(query.parse(input)).toEqual(expected);
  });

  const invalid: [string, Record<string, string>, string][] = [
    ['a negative page', { page: '-1' }, 'page'],
    ['a decimal page', { page: '1.5' }, 'page'],
    ['a text page', { page: 'abc' }, 'page'],
    ['an empty page', { page: '' }, 'page'],
    ['an exponent', { page: '1e3' }, 'page'],
    ['a hex number', { page: '0x10' }, 'page'],
    ['a padded number', { page: ' 5' }, 'page'],
    ['a page beyond the limit', { page: '1000001' }, 'page'],
    ['a page too long to be safe', { page: '99999999999' }, 'page'],
    ['size 0', { pageSize: '0' }, 'pageSize'],
    ['a size above the limit', { pageSize: '101' }, 'pageSize'],
    ['a negative size', { pageSize: '-5' }, 'pageSize'],
    ['an empty size', { pageSize: '' }, 'pageSize'],
    ['an unknown parameter', { limit: '5' }, ''],
  ];
  it.each(invalid)('rejects %s', (_name, input, field) => {
    const result = query.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success && field)
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });

  it('honours other limits', () => {
    const custom = paginationQuery({ defaultPageSize: 5, maxPageSize: 10, maxPage: 20 });
    expect(custom.parse({})).toEqual({ page: 0, pageSize: 5 });
    expect(custom.safeParse({ pageSize: '11' }).success).toBe(false);
    expect(custom.safeParse({ page: '21' }).success).toBe(false);
    expect(custom.parse({ page: '20', pageSize: '10' })).toEqual({ page: 20, pageSize: 10 });
  });

  it('can be extended with more filters, which stay strict', () => {
    const extended = query.extend({ q: z.string().max(5).optional() });
    expect(extended.parse({ q: 'abc', page: '1' })).toEqual({ q: 'abc', page: 1, pageSize: 20 });
    expect(extended.safeParse({ q: 'abcdef' }).success).toBe(false);
    expect(extended.safeParse({ other: 'x' }).success).toBe(false);
  });
});

describe('paginate', () => {
  const rows = ['a', 'b'];
  const cases: [string, { page: number; pageSize: number }, number, unknown][] = [
    [
      'an empty set has no pages',
      { page: 0, pageSize: 20 },
      0,
      { currentPage: 0, pageSize: 20, totalCount: 0, totalPages: 0 },
    ],
    [
      'one item is one page',
      { page: 0, pageSize: 20 },
      1,
      { currentPage: 0, pageSize: 20, totalCount: 1, totalPages: 1 },
    ],
    [
      'exactly one full page',
      { page: 0, pageSize: 20 },
      20,
      { currentPage: 0, pageSize: 20, totalCount: 20, totalPages: 1 },
    ],
    [
      'one more than a page',
      { page: 0, pageSize: 20 },
      21,
      { currentPage: 0, pageSize: 20, totalCount: 21, totalPages: 2 },
    ],
    [
      'the last page',
      { page: 4, pageSize: 10 },
      45,
      { currentPage: 4, pageSize: 10, totalCount: 45, totalPages: 5 },
    ],
    [
      'a page past the end still reports the totals',
      { page: 9, pageSize: 10 },
      45,
      { currentPage: 9, pageSize: 10, totalCount: 45, totalPages: 5 },
    ],
    [
      'size 1',
      { page: 2, pageSize: 1 },
      3,
      { currentPage: 2, pageSize: 1, totalCount: 3, totalPages: 3 },
    ],
  ];
  it.each(cases)('%s', (_name, query, total, metadata) => {
    expect(paginate(query, total, rows)).toEqual({ metadata, result: rows });
  });

  it('the metadata satisfies the envelope schema', () => {
    const schema = listEnvelope(z.string());
    expect(schema.safeParse(paginate({ page: 1, pageSize: 5 }, 12, rows)).success).toBe(true);
    expect(schema.safeParse({ metadata: {}, result: [] }).success).toBe(false);
  });
});

describe('pageOffset', () => {
  it.each([
    [{ page: 0, pageSize: 20 }, 0],
    [{ page: 1, pageSize: 20 }, 20],
    [{ page: 7, pageSize: 15 }, 105],
  ])('%j → %i', (query, expected) => {
    expect(pageOffset(query)).toBe(expected);
  });
});
