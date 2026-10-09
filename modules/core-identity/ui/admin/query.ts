// What the address of the user list says, as plain functions: which page, which status, which search text
// and which sort. A value that is not valid is dropped (the page then shows its default), so a bookmarked
// or edited address never breaks the page.
export const USER_STATUSES = ['pending', 'active', 'rejected', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_SORTS = ['username', 'email', 'status', 'createdAt'] as const;
export type UserSortKey = (typeof USER_SORTS)[number];
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export interface UsersQuery {
  page: number;
  pageSize: number;
  status: UserStatus | undefined;
  q: string | undefined;
  sort: UserSortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_QUERY: UsersQuery = {
  page: 0,
  pageSize: 20,
  status: undefined,
  q: undefined,
  sort: 'username',
  dir: 'asc',
};

/** The longest search text the API takes. */
export const SEARCH_MAX = 100;

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  list.find((entry) => entry === value);

const whole = (value: string | null): number | undefined =>
  value !== null && /^\d{1,7}$/.test(value) ? Number(value) : undefined;

export function parseUsersQuery(params: URLSearchParams): UsersQuery {
  const pageSize = whole(params.get('pageSize'));
  const text = params.get('q')?.trim();
  return {
    page: whole(params.get('page')) ?? DEFAULT_QUERY.page,
    pageSize:
      pageSize !== undefined && (PAGE_SIZES as readonly number[]).includes(pageSize)
        ? pageSize
        : DEFAULT_QUERY.pageSize,
    status: oneOf(USER_STATUSES, params.get('status')),
    q: text ? text.slice(0, SEARCH_MAX) : undefined,
    sort: oneOf(USER_SORTS, params.get('sort')) ?? DEFAULT_QUERY.sort,
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
  };
}

/** The address query for a state; what is the default is left out, so the plain list has a plain address. */
export function usersQueryString(query: UsersQuery): string {
  const params = new URLSearchParams();
  if (query.page !== DEFAULT_QUERY.page) params.set('page', String(query.page));
  if (query.pageSize !== DEFAULT_QUERY.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort);
  if (query.dir !== DEFAULT_QUERY.dir) params.set('dir', query.dir);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The query the API takes (every value a string, as the generated client types it). */
export function usersApiQuery(query: UsersQuery): Record<string, string> {
  return {
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    dir: query.dir,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { q: query.q } : {}),
  };
}

/** Any change other than the page itself starts again at the first page. */
export function changeQuery(current: UsersQuery, change: Partial<UsersQuery>): UsersQuery {
  const next = { ...current, ...change };
  const onlyPage = Object.keys(change).every((key) => key === 'page');
  return onlyPage ? next : { ...next, page: change.page ?? 0 };
}

/** The address query of a list that only pages (the accounts waiting for approval). */
export function pageQueryString(page: number, pageSize: number): string {
  const params = new URLSearchParams();
  if (page > 0) params.set('page', String(page));
  if (pageSize !== DEFAULT_QUERY.pageSize) params.set('pageSize', String(pageSize));
  const text = params.toString();
  return text ? `?${text}` : '';
}
