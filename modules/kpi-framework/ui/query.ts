// The addresses of the two lists: the search, the filters and the page live in the address, so a list can be
// bookmarked and the back button works. The server sorts (key, then name, then id). A value from an address is
// checked; anything odd falls back to the default.
export const KPI_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50, 100] as const;
const MAX_Q = 100;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface IndicatorsQuery {
  q: string | undefined;
  thematic: string | undefined;
  unit: string | undefined;
  qualitative: boolean | undefined;
  page: number;
  pageSize: number;
}

export interface SetsQuery {
  q: string | undefined;
  rimoCategory: string | undefined;
  page: number;
  pageSize: number;
}

function pageOf(params: URLSearchParams) {
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  return {
    page: Number.isInteger(page) && page >= 0 && page < 1_000_000 ? page : 0,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : KPI_PAGE_SIZE,
  };
}
const keyOf = (params: URLSearchParams, name: string) => {
  const value = params.get(name)?.trim();
  return value && KEY.test(value) ? value : undefined;
};
const qOf = (params: URLSearchParams) => params.get('q')?.trim().slice(0, MAX_Q) || undefined;

export function parseIndicatorsQuery(params: URLSearchParams): IndicatorsQuery {
  const qualitative = params.get('qualitative');
  return {
    q: qOf(params),
    thematic: keyOf(params, 'thematic'),
    unit: keyOf(params, 'unit'),
    qualitative: qualitative === 'true' ? true : qualitative === 'false' ? false : undefined,
    ...pageOf(params),
  };
}

export function parseSetsQuery(params: URLSearchParams): SetsQuery {
  return { q: qOf(params), rimoCategory: keyOf(params, 'rimoCategory'), ...pageOf(params) };
}

function queryString(entries: [string, string | undefined][], page: number, pageSize: number) {
  const params = new URLSearchParams();
  for (const [key, value] of entries) if (value) params.set(key, value);
  if (page > 0) params.set('page', String(page));
  if (pageSize !== KPI_PAGE_SIZE) params.set('pageSize', String(pageSize));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const indicatorsQueryString = (query: IndicatorsQuery) =>
  queryString(
    [
      ['q', query.q],
      ['thematic', query.thematic],
      ['unit', query.unit],
      ['qualitative', query.qualitative === undefined ? undefined : String(query.qualitative)],
    ],
    query.page,
    query.pageSize,
  );

export const setsQueryString = (query: SetsQuery) =>
  queryString(
    [
      ['q', query.q],
      ['rimoCategory', query.rimoCategory],
    ],
    query.page,
    query.pageSize,
  );

/** A change of the filters goes back to the first page; a change of the page keeps them. */
export function changeQuery<T extends { page: number; pageSize: number }>(
  query: T,
  change: Partial<T>,
): T {
  const filtersChanged = Object.keys(change).some((key) => key !== 'page');
  return { ...query, ...change, ...(filtersChanged && !('page' in change) && { page: 0 }) };
}

/** The query of `GET /kpi/indicators`. */
export const indicatorsApiQuery = (query: IndicatorsQuery) => ({
  page: String(query.page),
  pageSize: String(query.pageSize),
  ...(query.q && { q: query.q }),
  ...(query.thematic && { thematic: query.thematic }),
  ...(query.unit && { unit: query.unit }),
  ...(query.qualitative !== undefined && {
    qualitative: String(query.qualitative) as 'true' | 'false',
  }),
});

/** The query of `GET /kpi/sets`. */
export const setsApiQuery = (query: SetsQuery) => ({
  page: String(query.page),
  pageSize: String(query.pageSize),
  ...(query.q && { q: query.q }),
  ...(query.rimoCategory && { rimoCategory: query.rimoCategory }),
});
