// The addresses of the two lists of this sprint: the search on "Profile → Organisations" (5 per page, FEATURES
// §3.4) and the administrator's membership requests. The filters and the page live in the address, so a list
// can be bookmarked and the back button works. A value from an address is checked; anything odd falls back to
// the default. Pure, so it is unit tested.
import {
  organisationsApiQuery,
  parseOrganisationsQuery,
  type OrganisationsQuery,
} from './query.ts';

/** Organisations per page of the search on the profile page (FEATURES §3.4). */
export const SEARCH_PAGE_SIZE = 5;

export type SearchQuery = Pick<OrganisationsQuery, 'q' | 'type' | 'page'>;

export function parseSearchQuery(params: URLSearchParams): SearchQuery {
  const { q, type, page } = parseOrganisationsQuery(params);
  return { q, type, page };
}

/** The query string (with its `?`, or empty); the search box and the type filter are the only inputs. */
export function searchQueryString(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.type) params.set('type', query.type);
  if (query.page > 0) params.set('page', String(query.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A change of the filters goes back to the first page; a change of the page keeps them. */
export function changeSearchQuery(query: SearchQuery, change: Partial<SearchQuery>): SearchQuery {
  const filtersChanged = 'q' in change || 'type' in change;
  return { ...query, ...change, ...(filtersChanged && !('page' in change) && { page: 0 }) };
}

/** The query of `GET /organisations` for the search: always 5 per page. */
export const searchApiQuery = (query: SearchQuery) =>
  organisationsApiQuery({ ...query, pageSize: SEARCH_PAGE_SIZE });

// --- the administrator's list of memberships ---------------------------------------------------------------

export const MEMBERSHIP_STATES = ['requested', 'approved', 'rejected', 'left'] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

export const MEMBERSHIP_PAGE_SIZE = 20;
const PAGE_SIZES = [10, 20, 50, 100] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MembershipsQuery {
  /** The pending requests are the default: that is why an administrator opens the page. */
  state: MembershipState;
  organisationId: string | undefined;
  type: string | undefined;
  page: number;
  pageSize: number;
}

export function parseMembershipsQuery(params: URLSearchParams): MembershipsQuery {
  const state = params.get('state');
  const organisationId = params.get('organisation')?.trim();
  const type = params.get('type')?.trim();
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  return {
    state: (MEMBERSHIP_STATES as readonly string[]).includes(state ?? '')
      ? (state as MembershipState)
      : 'requested',
    organisationId: organisationId && UUID.test(organisationId) ? organisationId : undefined,
    type: type && /^[a-z][a-z0-9_-]{0,63}$/.test(type) ? type : undefined,
    page: Number.isInteger(page) && page >= 0 && page < 1_000_000 ? page : 0,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : MEMBERSHIP_PAGE_SIZE,
  };
}

/** The query string (with its `?`, or empty); defaults are left out. */
export function membershipsQueryString(query: MembershipsQuery): string {
  const params = new URLSearchParams();
  if (query.state !== 'requested') params.set('state', query.state);
  if (query.organisationId) params.set('organisation', query.organisationId);
  if (query.type) params.set('type', query.type);
  if (query.page > 0) params.set('page', String(query.page));
  if (query.pageSize !== MEMBERSHIP_PAGE_SIZE) params.set('pageSize', String(query.pageSize));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A change of a filter or of the page size goes back to the first page; a change of the page keeps them. */
export function changeMembershipsQuery(
  query: MembershipsQuery,
  change: Partial<MembershipsQuery>,
): MembershipsQuery {
  const filtersChanged =
    'state' in change || 'organisationId' in change || 'type' in change || 'pageSize' in change;
  return { ...query, ...change, ...(filtersChanged && !('page' in change) && { page: 0 }) };
}

/** The query of `GET /memberships`. */
export function membershipsApiQuery(query: MembershipsQuery) {
  return {
    page: String(query.page),
    pageSize: String(query.pageSize),
    state: query.state,
    ...(query.organisationId && { organisationId: query.organisationId }),
    ...(query.type && { type: query.type }),
  };
}
