import { describe, expect, it } from 'vitest';
import {
  catalogueApiQuery,
  catalogueQueryString,
  changeCatalogueQuery,
  CATALOGUE_PAGE_SIZE,
  DEFAULT_QUERY,
  facetsApiQuery,
  parseCatalogueQuery,
  withoutFilter,
  type CatalogueQuery,
} from './query.ts';

const parse = (search: string) => parseCatalogueQuery(new URLSearchParams(search));

describe('parseCatalogueQuery', () => {
  it.each<[string, Partial<CatalogueQuery>]>([
    ['', {}],
    ['q=galaxy', { q: 'galaxy' }],
    ['q=%20%20galaxy%20', { q: 'galaxy' }],
    ['q=', {}],
    ['sort=provider', { sort: 'provider' }],
    ['sort=stage&dir=desc', { sort: 'stage', dir: 'desc' }],
    ['sort=colour', {}],
    ['sort=slug', {}],
    ['dir=up', {}],
    ['page=3', { page: 3 }],
    ['page=-1', {}],
    ['page=1.5', {}],
    ['page=abc', {}],
    ['page=99999999', {}],
    ['pageSize=50', { pageSize: 50 }],
    ['pageSize=100', {}],
    ['pageSize=7', {}],
    ['f.stage=DEV', { filters: { stage: ['DEV'] } }],
    ['f.stage=DEV&f.stage=PROD&f.stage=DEV', { filters: { stage: ['DEV', 'PROD'] } }],
    ['f.license=:none', { filters: { license: [':none'] } }],
    [
      'f.consortium=0190a1b2-0000-7000-8000-000000000001',
      { filters: { consortium: ['0190a1b2-0000-7000-8000-000000000001'] } },
    ],
    ['f.stage=%3Cscript%3E', {}],
    ['f.stage=', {}],
    ['f.Stage=DEV', {}],
    ['f..x=DEV', {}],
    ['stage=DEV', {}],
  ])('%j', (search, expected) => {
    expect(parse(search)).toEqual({ ...DEFAULT_QUERY, ...expected });
  });

  it('cuts a very long search at 100 characters, and keeps at most 10 facets of 50 values', () => {
    expect(parse(`q=${'a'.repeat(500)}`).q).toHaveLength(100);
    const many = Array.from({ length: 20 }, (_v, i) => `f.facet${i}=x`).join('&');
    expect(Object.keys(parse(many).filters)).toHaveLength(10);
    const values = Array.from({ length: 80 }, (_v, i) => `f.stage=v${i}`).join('&');
    expect(parse(values).filters.stage).toHaveLength(50);
  });
});

describe('catalogueQueryString', () => {
  it('leaves the defaults out and round-trips the rest', () => {
    expect(catalogueQueryString(DEFAULT_QUERY)).toBe('');
    const query: CatalogueQuery = {
      q: 'a b&c',
      sort: 'provider',
      dir: 'desc',
      page: 2,
      pageSize: 50,
      filters: { consortium: ['id-1', 'id-2'], license: [':none'] },
    };
    expect(parse(catalogueQueryString(query).slice(1))).toEqual(query);
  });
});

describe('changeCatalogueQuery', () => {
  const base: CatalogueQuery = {
    ...DEFAULT_QUERY,
    q: 'x',
    page: 4,
    filters: { stage: ['DEV'] },
  };
  it('goes back to the first page when the search, the sort, the size or the filters change, and keeps the page for a page change', () => {
    expect(changeCatalogueQuery(base, { q: 'y' }).page).toBe(0);
    expect(changeCatalogueQuery(base, { sort: 'stage', dir: 'desc' }).page).toBe(0);
    expect(changeCatalogueQuery(base, { pageSize: 50 }).page).toBe(0);
    expect(changeCatalogueQuery(base, { filters: {} }).page).toBe(0);
    expect(changeCatalogueQuery(base, { page: 5 })).toEqual({ ...base, page: 5 });
  });
});

describe('withoutFilter', () => {
  const base: CatalogueQuery = {
    ...DEFAULT_QUERY,
    page: 3,
    filters: { stage: ['DEV', 'PROD'], license: ['MIT'] },
  };
  it('takes one value out, drops the facet with its last value, and goes back to the first page', () => {
    expect(withoutFilter(base, 'stage', 'DEV')).toEqual({
      ...base,
      page: 0,
      filters: { stage: ['PROD'], license: ['MIT'] },
    });
    expect(withoutFilter(base, 'license', 'MIT').filters).toEqual({ stage: ['DEV', 'PROD'] });
    expect(withoutFilter(base, 'stage', 'absent').filters).toEqual(base.filters);
  });
});

describe('the API queries', () => {
  it('name the page and the size 0-based, the locale, and a filter by its facet id, repeated', () => {
    expect(catalogueApiQuery(DEFAULT_QUERY, 'de')).toEqual({
      page: '0',
      pageSize: String(CATALOGUE_PAGE_SIZE),
      sort: 'name',
      dir: 'asc',
      locale: 'de',
    });
    expect(
      catalogueApiQuery(
        {
          ...DEFAULT_QUERY,
          q: 'gal',
          page: 2,
          filters: { stage: ['DEV', 'PROD'], category: ['data'] },
        },
        'en',
      ),
    ).toMatchObject({ page: '2', q: 'gal', stage: ['DEV', 'PROD'], category: ['data'] });
  });

  it('give the facets the search and the filters, and neither a page nor a sort', () => {
    expect(
      facetsApiQuery({ ...DEFAULT_QUERY, q: 'gal', page: 2, filters: { stage: ['DEV'] } }, 'en'),
    ).toEqual({
      locale: 'en',
      q: 'gal',
      stage: ['DEV'],
    });
  });
});
