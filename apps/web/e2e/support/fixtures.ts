import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { url } from '@scorpion/contracts';
import { ADMIN } from './stack.ts';

export { expect };

interface Fixtures {
  /** `BASE_PATH` of the project the test runs in. */
  basePath: string;
  /** A path of the application under that base path. */
  at: (path: string) => string;
}

/**
 * Waits until the shell has hydrated the page. `goto` returns at the `load` event, which comes before
 * Svelte attaches its handlers: input typed earlier is lost to bound state and a submit finds nothing
 * changed. A page without the marker (the component harness, a JSON answer) is ready at once.
 */
export async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body?.dataset.hydrated !== 'false', undefined, {
    timeout: 15_000,
  });
}

export const test = base.extend<Fixtures>({
  // Every `page.goto` of a test returns once the page has hydrated.
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (target, options) => {
      const response = await goto(target, options);
      await hydrated(page);
      return response;
    };
    await use(page);
  },
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
  // A retry of a failed test finds the account its first attempt made (and approved).
  if (register.status() === 409 && test.info().retry > 0) return;
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

/** The product name the instance shows, as the API says it (never a literal: branding comes from settings). */
export async function productName(
  request: APIRequestContext,
  at: (path: string) => string,
): Promise<string> {
  const response = await request.get(at('/api/internal/branding'));
  expect(response.status()).toBe(200);
  return ((await response.json()) as { productName: string }).productName;
}

/** Signs in through the sign-in page, as a person does, and waits until the page shows who is signed in. */
export async function signInThroughPage(
  page: Page,
  at: (path: string) => string,
  credentials: Credentials,
): Promise<void> {
  await page.goto(at('/login'));
  await page.getByLabel('Username').fill(credentials.username);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
}

/** An account that signs in with this username and password, registered and approved through the API. */
export const person = (name: string): Credentials => ({
  username: name,
  // Not the name: the server refuses a password that contains the username.
  password: 'quiet river and tall mountains 42',
});
