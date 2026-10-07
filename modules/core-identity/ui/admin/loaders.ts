// What the administration pages of users need before they render. They run on the server, after the
// permission check, and **throw** when they cannot get their data (defect 12). A part of the detail page
// that the caller's role does not allow (the roles, the tokens) is left out; any other failure fails the page.
import type { UiLoadContext } from '@scorpion/contracts';
import { unwrap } from '@scorpion/contracts/client';
import { PAGE_SIZE } from '../limits.ts';
import { allowed } from '../loaders.ts';
import { parseUsersQuery, usersApiQuery, type UserStatus, type UsersQuery } from './query.ts';

export interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  status: UserStatus;
  createdAt: string;
}

export interface UsersData {
  query: UsersQuery;
  users: AdminUser[];
  total: number;
}

export async function loadUsers({ api, url }: UiLoadContext): Promise<UsersData> {
  const query = parseUsersQuery(url.searchParams);
  const answer = await unwrap(api.GET('/users', { params: { query: usersApiQuery(query) } }));
  return { query, users: answer.result, total: answer.metadata.totalCount };
}

export interface PendingUser {
  id: string;
  username: string;
  email: string | null;
  createdAt: string;
}

export interface RoleOption {
  key: string;
  label: string;
}

export interface PendingData {
  page: number;
  pageSize: number;
  users: PendingUser[];
  total: number;
  /** The roles an approval may give, or `null` when the caller may not list them (then the default role is given). */
  roles: RoleOption[] | null;
}

export async function loadPending({ api, url }: UiLoadContext): Promise<PendingData> {
  const { page, pageSize } = parseUsersQuery(url.searchParams);
  const [pending, roles] = await Promise.all([
    unwrap(
      api.GET('/users/pending', {
        params: { query: { page: String(page), pageSize: String(pageSize) } },
      }),
    ),
    allowed(unwrap(api.GET('/roles', { params: { query: { pageSize: PAGE_SIZE } } }))),
  ]);
  return {
    page,
    pageSize,
    users: pending.result,
    total: pending.metadata.totalCount,
    roles: roles?.result.map(({ key, label }) => ({ key, label })) ?? null,
  };
}

export interface UserToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface UserDetailData {
  user: AdminUser;
  /** The role keys the user holds, or `null` when the caller may not read them. */
  roles: string[] | null;
  /** Every role that exists, to offer the ones the user lacks; `null` when the caller may not list them. */
  allRoles: RoleOption[] | null;
  tokens: UserToken[] | null;
}

export async function loadUser({ api, params }: UiLoadContext): Promise<UserDetailData> {
  const id = params.id!;
  const path = { id };
  const query = { pageSize: PAGE_SIZE };
  const [user, roles, allRoles, tokens] = await Promise.all([
    unwrap(api.GET('/users/{id}', { params: { path } })),
    allowed(unwrap(api.GET('/users/{id}/roles', { params: { path, query } }))),
    allowed(unwrap(api.GET('/roles', { params: { query } }))),
    allowed(unwrap(api.GET('/users/{id}/tokens', { params: { path, query } }))),
  ]);
  return {
    user,
    roles: roles?.result.map((role) => role.key) ?? null,
    allRoles: allRoles?.result.map(({ key, label }) => ({ key, label })) ?? null,
    tokens: tokens?.result ?? null,
  };
}
