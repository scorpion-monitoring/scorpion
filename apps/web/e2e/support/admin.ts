// What the administration journeys need: accounts with names that cannot clash between a first try and a
// retry, an administrator's API session in a context of its own (so it does not sign the browser's page in),
// and a few calls the journeys use to set up a state or to put it back.
import { randomBytes } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { admin, expect, person, type Credentials } from './fixtures.ts';

/** A name no other test used: a prefix and six random characters, lower-case as a username must be. */
export function unique(prefix: string): string {
  return `${prefix}${randomBytes(4).toString('hex')}`;
}

/** Credentials for a fresh account; the password is the shared test one. */
export const newPerson = (prefix: string): Credentials => person(unique(prefix));

export interface AdminApi {
  request: APIRequestContext;
  csrf: string;
  /** `GET` of an internal route, parsed. */
  get<T = unknown>(path: string): Promise<T>;
  /** An unsafe call with the administrator's CSRF token; returns the response status and the parsed body. */
  send(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: unknown,
  ): Promise<{ status: number; body: unknown }>;
  dispose(): Promise<void>;
}

/** What `adminApi` needs of the `playwright` fixture. */
interface PlaywrightLike {
  request: { newContext(options?: { baseURL?: string }): Promise<APIRequestContext> };
}

/** The administrator, signed in through the API in a context of its own. */
export async function adminApi(
  playwright: PlaywrightLike,
  baseURL: string | undefined,
  at: (path: string) => string,
): Promise<AdminApi> {
  const request = await playwright.request.newContext({ baseURL });
  const login = await request.post(at('/api/internal/auth/login'), { data: admin });
  expect(login.status(), await login.text()).toBe(200);
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  return {
    request,
    csrf,
    async get<T>(path: string) {
      const response = await request.get(at(`/api/internal${path}`));
      expect(response.status(), `GET ${path}`).toBe(200);
      return (await response.json()) as T;
    },
    async send(method, path, data) {
      const response = await request.fetch(at(`/api/internal${path}`), {
        method,
        headers: { 'x-csrf-token': csrf },
        data: data === undefined ? {} : data,
      });
      const text = await response.text();
      return { status: response.status(), body: text ? (JSON.parse(text) as unknown) : undefined };
    },
    dispose: () => request.dispose(),
  };
}

/** Registers an account through the API; it waits for approval. Returns its id once the administrator can see it. */
export async function registerPending(
  api: AdminApi,
  at: (path: string) => string,
  credentials: Credentials,
): Promise<string> {
  const response = await api.request.post(at('/api/internal/auth/register'), {
    data: { ...credentials, email: `${credentials.username}@example.org` },
  });
  expect(response.status(), await response.text()).toBe(202);
  return userId(api, credentials.username, 'pending');
}

/** The id of the account with this username, as the administrator's list shows it. */
export async function userId(api: AdminApi, username: string, status?: string): Promise<string> {
  const query = new URLSearchParams({ q: username, pageSize: '100' });
  if (status) query.set('status', status);
  const list = await api.get<{ result: { id: string; username: string }[] }>(`/users?${query}`);
  const found = list.result.find((user) => user.username === username);
  expect(found, `the account ${username}`).toBeDefined();
  return found!.id;
}

/** An active account with the role `user` (registered and approved through the API). */
export async function activeUser(
  api: AdminApi,
  at: (path: string) => string,
  credentials: Credentials,
): Promise<string> {
  const id = await registerPending(api, at, credentials);
  const approved = await api.send('POST', `/users/${id}/approve`);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return id;
}

/** The permissions of a role, as the API lists them. */
export async function permissionsOf(api: AdminApi, role: string): Promise<string[]> {
  const roles = await api.get<{ result: { key: string; permissions: string[] }[] }>(
    '/roles?pageSize=100',
  );
  return roles.result.find((entry) => entry.key === role)!.permissions;
}
