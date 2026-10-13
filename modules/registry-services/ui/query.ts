// The address of the catalogue: the search, the sort, the page and the filters live in it, so a list can be
// bookmarked and the back button works. The filters are `f.<facet id>=<value>` (the form `Facets` of ui-kit
// writes); the server's own names (`consortium=…`) are built for the API only. A value read from an address is
// checked; anything odd falls back to the default. The ids of the facets are not listed here: they come from
// the API, and the address may name any id that has a valid shape.
export const CATALOGUE_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50] as const;
/** The columns the table can sort by (the keys the API takes as `sort`). */
export const SORT_KEYS = ['name', 'provider', 'stage'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface CatalogueQuery {
  q: string | undefined;
  sort: SortKey;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  /** The chosen values by facet id. */
  filters: Record<string, string[]>;
}

const MAX_Q = 100;
const MAX_FACETS = 10;
const MAX_VALUES = 50;
const PREFIX = 'f.';
const FACET_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** What `Facets` accepts as an option value: ids, SPDX ids, vocabulary keys and the `:none` of a facet. */
const VALUE = /^[A-Za-z0-9._:@/+-]{1,100}$/;

export const DEFAULT_QUERY: CatalogueQuery = {
  q: undefined,
  sort: 'name',
  dir: 'asc',
  page: 0,
  pageSize: CATALOGUE_PAGE_SIZE,
  filters: {},
};

export function parseCatalogueQuery(params: URLSearchParams): CatalogueQuery {
  const q = params.get('q')?.trim().slice(0, MAX_Q);
  const sort = params.get('sort');
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  const filters: Record<string, string[]> = {};
  for (const key of new Set(params.keys())) {
    if (!key.startsWith(PREFIX)) continue;
    const id = key.slice(PREFIX.length);
    if (!FACET_ID.test(id) || Object.keys(filters).length >= MAX_FACETS) continue;
    const values = [...new Set(params.getAll(key).filter((value) => VALUE.test(value)))].slice(
      0,
      MAX_VALUES,
    );
    if (values.length > 0) filters[id] = values;
  }
  return {
    q: q || undefined,
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? '') ? (sort as SortKey) : 'name',
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page >= 0 && page < 1_000_000 ? page : 0,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : CATALOGUE_PAGE_SIZE,
    filters,
  };
}

/** The query string (with its `?`, or empty) for a query: defaults are left out. */
export function catalogueQueryString(query: CatalogueQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.sort !== 'name') params.set('sort', query.sort);
  if (query.dir !== 'asc') params.set('dir', query.dir);
  if (query.page > 0) params.set('page', String(query.page));
  if (query.pageSize !== CATALOGUE_PAGE_SIZE) params.set('pageSize', String(query.pageSize));
  for (const [id, values] of Object.entries(query.filters)) {
    for (const value of values) params.append(`${PREFIX}${id}`, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A change of the search, the sort, the page size or the filters goes back to the first page; a change of the page keeps them. */
export function changeCatalogueQuery(
  query: CatalogueQuery,
  change: Partial<CatalogueQuery>,
): CatalogueQuery {
  return { ...query, ...change, ...(!('page' in change) && { page: 0 }) };
}

/** One value taken out of the filters (the facet goes with its last value). */
export function withoutFilter(query: CatalogueQuery, id: string, value: string): CatalogueQuery {
  const rest = (query.filters[id] ?? []).filter((entry) => entry !== value);
  const filters = { ...query.filters };
  if (rest.length > 0) filters[id] = rest;
  else delete filters[id];
  return changeCatalogueQuery(query, { filters });
}

/** The filters as the API takes them: the facet id is the parameter, repeated for several values. */
const filterParams = (filters: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(filters).map(([id, values]) => [id, values]));

/** The query of `GET /services`. */
export function catalogueApiQuery(query: CatalogueQuery, locale: string) {
  return {
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    dir: query.dir,
    locale,
    ...(query.q && { q: query.q }),
    ...filterParams(query.filters),
  };
}

/** The query of `GET /services/facets`: the same search and filters, no sort and no page. */
export function facetsApiQuery(query: CatalogueQuery, locale: string) {
  return {
    locale,
    ...(query.q && { q: query.q }),
    ...filterParams(query.filters),
  };
}
