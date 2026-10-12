// The address of the administrator's list of organisations: the search, the type filter and the page live in
// the address, so a list can be bookmarked and the back button works. The server sorts (abbreviation, then id).
// A value from an address is checked; anything odd falls back to the default.
export const ORGANISATION_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export interface OrganisationsQuery {
  q: string | undefined;
  type: string | undefined;
  page: number;
  pageSize: number;
}

const MAX_Q = 100;

export function parseOrganisationsQuery(params: URLSearchParams): OrganisationsQuery {
  const q = params.get('q')?.trim().slice(0, MAX_Q);
  const type = params.get('type')?.trim();
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  return {
    q: q || undefined,
    type: type && /^[a-z][a-z0-9_-]{0,63}$/.test(type) ? type : undefined,
    page: Number.isInteger(page) && page >= 0 && page < 1_000_000 ? page : 0,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : ORGANISATION_PAGE_SIZE,
  };
}

/** The query string (with its `?`, or empty) for a query: defaults are left out. */
export function organisationsQueryString(query: OrganisationsQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.type) params.set('type', query.type);
  if (query.page > 0) params.set('page', String(query.page));
  if (query.pageSize !== ORGANISATION_PAGE_SIZE) params.set('pageSize', String(query.pageSize));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A change of the filters goes back to the first page; a change of the page keeps them. */
export function changeOrganisationsQuery(
  query: OrganisationsQuery,
  change: Partial<OrganisationsQuery>,
): OrganisationsQuery {
  const filtersChanged = 'q' in change || 'type' in change || 'pageSize' in change;
  return { ...query, ...change, ...(filtersChanged && !('page' in change) && { page: 0 }) };
}

/** The query of `GET /organisations`. */
export function organisationsApiQuery(query: OrganisationsQuery) {
  return {
    page: String(query.page),
    pageSize: String(query.pageSize),
    ...(query.q && { q: query.q }),
    ...(query.type && { type: query.type }),
  };
}
