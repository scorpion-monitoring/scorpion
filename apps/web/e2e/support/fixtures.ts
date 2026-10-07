import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { url } from '@scorpion/contracts';
import { ADMIN } from './stack.ts';

export { expect };

interface Fixtures {
  /** `BASE_PATH` of the project the test runs in. */
  basePath: string;
  /** A path of the application under that base path. */
  at: (path: string) => string;
}

export const test = base.extend<Fixtures>({
  basePath: ['/', { option: true }],
  at: async ({ basePath }, use) => {
    await use((path) => url(basePath, path));
  },
});

export interface Credentials {
  username: string;
  password: string;
}

export const admin: Credentials = { username: ADMIN.username, password: ADMIN.password };

/**
 * Signs in through the API (the login page arrives with sprint 2 of M5). The session cookie lands in the
 * cookie jar of `request`, which a page of the same context shares. Returns the CSRF token.
 */
export async function signIn(
  request: APIRequestContext,
  at: (path: string) => string,
  credentials: Credentials,
): Promise<string> {
  const response = await request.post(at('/api/internal/auth/login'), { data: credentials });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

/** An active account with the role `user`: registered through the API and approved by the administrator. */
export async function createUser(
  request: APIRequestContext,
  at: (path: string) => string,
  credentials: Credentials,
): Promise<void> {
  const register = await request.post(at('/api/internal/auth/register'), {
    data: { ...credentials, email: `${credentials.username}@example.org` },
  });
  expect(register.status(), await register.text()).toBe(202);
  const csrf = await signIn(request, at, admin);
  const pending = await request.get(at('/api/internal/users/pending'));
  const { result } = (await pending.json()) as { result: { id: string; username: string }[] };
  const user = result.find((entry) => entry.username === credentials.username);
  expect(user, 'the new account is pending').toBeDefined();
  const approve = await request.post(at(`/api/internal/users/${user!.id}/approve`), {
    headers: { 'x-csrf-token': csrf },
    data: {},
  });
  expect(approve.status(), await approve.text()).toBe(200);
  await request.post(at('/api/internal/auth/logout'), { headers: { 'x-csrf-token': csrf } });
}

/** Saves the settings of one module as the signed-in administrator (reads the version first). */
export async function saveSettings(
  request: APIRequestContext,
  at: (path: string) => string,
  csrf: string,
  module: string,
  change: (values: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const current = await request.get(at(`/api/internal/settings/${module}`));
  expect(current.status(), await current.text()).toBe(200);
  const { version, values } = (await current.json()) as {
    version: number;
    values: Record<string, unknown>;
  };
  const saved = await request.put(at(`/api/internal/settings/${module}`), {
    headers: { 'x-csrf-token': csrf },
    data: { version, values: change(values) },
  });
  expect(saved.status(), await saved.text()).toBe(200);
}
