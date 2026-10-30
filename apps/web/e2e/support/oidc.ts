// The provider of the OIDC specs: a stub that runs on a local port (no third party is called), registered as the only
// sign-in provider for each test. `oidc.spec.ts` and the journey `j02-sign-in-with-oidc.spec.ts` share it.
import { startStubIdp, type StubIdp } from '@scorpion/testing';
import type { Page, PlaywrightWorkerArgs } from '@playwright/test';
import { admin, expect, saveSettings, signIn, test } from './fixtures.ts';

/**
 * Call once at the top of a spec file: starts the stub for the file, makes it the only provider before each test and
 * removes it after. `idp` is the running stub (read it inside a test, not at the top of the file).
 */
export function useStubProvider() {
  let current: StubIdp | undefined;
  test.beforeAll(async () => {
    // A public client: the stub then needs no client secret, so none has to be stored.
    current = await startStubIdp({ clientSecret: '' });
  });
  test.afterAll(async () => {
    await current?.stop();
  });
  test.beforeEach(async ({ request, at }) => {
    const csrf = await signIn(request, at, admin);
    await saveSettings(request, at, csrf, 'core.identity', (values) => ({
      ...values,
      oidcProviders: [current!.provider('stub')],
    }));
  });
  test.afterEach(async ({ request, at }) => {
    const csrf = await signIn(request, at, admin);
    await saveSettings(request, at, csrf, 'core.identity', (values) => ({
      ...values,
      oidcProviders: [],
    }));
  });
  const idp = new Proxy({} as StubIdp, {
    get: (_target, key) => Reflect.get(current!, key) as unknown,
  });

  /**
   * Who the provider says is signing in. Changed in place: the provider keeps the object it was started
   * with for the browsers that reach its authorisation page.
   */
  function signInAs(login: StubIdp['login']) {
    for (const key of Object.keys(idp.login)) delete idp.login[key as keyof StubIdp['login']];
    Object.assign(idp.login, login);
  }
  return { idp, signInAs };
}

export const providerButton = (page: Page) =>
  page.getByRole('button', { name: 'Sign in with Stub provider' });

/** Approves a pending account through the API (the administration screen is sprint 3). */
export async function approve(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  at: (path: string) => string,
  username: string,
) {
  const api = await playwright.request.newContext({ baseURL });
  try {
    const csrf = await signIn(api, at, admin);
    const pending = (await (await api.get(at('/api/internal/users/pending'))).json()) as {
      result: { id: string; username: string }[];
    };
    const user = pending.result.find((entry) => entry.username === username);
    expect(user, `${username} waits for approval: ${JSON.stringify(pending)}`).toBeDefined();
    const done = await api.post(at(`/api/internal/users/${user!.id}/approve`), {
      headers: { 'x-csrf-token': csrf },
      data: {},
    });
    expect(done.status()).toBe(200);
  } finally {
    await api.dispose();
  }
}
