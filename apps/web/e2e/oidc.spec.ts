import { startStubIdp, type StubIdp } from '@scorpion/testing';
import type { Page } from '@playwright/test';
import { makeSessionsStale, linkIn, mailTo } from './support/db.ts';
import {
  admin,
  createUser,
  expect,
  person,
  saveSettings,
  signIn,
  signInThroughPage,
  test,
} from './support/fixtures.ts';

// Sign-in at a provider, with a provider that runs on a local port (no third party is called): a new
// account waits for approval, an address that an account holds is not signed in but mailed, the mailed
// link connects the provider, and an account without a password confirms its identity at the provider.

let idp: StubIdp;
test.beforeAll(async () => {
  // A public client: the stub then needs no client secret, so none has to be stored.
  idp = await startStubIdp({ clientSecret: '' });
});
test.afterAll(async () => {
  await idp.stop();
});

test.beforeEach(async ({ request, at }) => {
  const csrf = await signIn(request, at, admin);
  await saveSettings(request, at, csrf, 'core.identity', (values) => ({
    ...values,
    oidcProviders: [idp.provider('stub')],
  }));
});
test.afterEach(async ({ request, at }) => {
  const csrf = await signIn(request, at, admin);
  await saveSettings(request, at, csrf, 'core.identity', (values) => ({
    ...values,
    oidcProviders: [],
  }));
});

/**
 * Who the provider says is signing in. Changed in place: the provider keeps the object it was started
 * with for the browsers that reach its authorisation page.
 */
function signInAs(login: StubIdp['login']) {
  for (const key of Object.keys(idp.login)) delete idp.login[key as keyof StubIdp['login']];
  Object.assign(idp.login, login);
}

const providerButton = (page: Page) =>
  page.getByRole('button', { name: 'Sign in with Stub provider' });

/** Approves a pending account through the API (the administration screen is sprint 3). */
async function approve(
  playwright: import('@playwright/test').PlaywrightWorkerArgs['playwright'],
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

test.describe('a sign-in at a provider', () => {
  test('[ASVS-10.2.1] creates an account that waits for approval, and signs in once it is approved', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    signInAs({
      subject: 'sub-newbie',
      email: 'newbie@example.org',
      emailVerified: true,
      preferredUsername: 'newbie',
    });
    await page.goto(at('/login'));
    await providerButton(page).click();
    // The account exists but waits: nobody is signed in, and the sign-in page says so (ADR-0029: the
    // callback sent the browser here with a fixed code, not a page of JSON).
    await expect(page).toHaveURL(/\/login\?error=account-pending$/);
    await expect(
      page.getByRole('heading', { name: 'Your account is waiting for approval' }),
    ).toBeVisible();
    expect((await page.context().cookies()).some((c) => c.name === '__Host-session')).toBe(false);

    await approve(playwright, baseURL, at, 'newbie');
    await page.goto(at('/login'));
    await providerButton(page).click();
    // Back at the start page of the application, signed in, with no password anywhere.
    await expect(page).toHaveURL(new RegExp(`${at('/')}$`));
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.locator('#account-menu').getByText('Signed in as newbie')).toBeVisible();
  });

  test('[ASVS-10.2.1] says why a sign-in failed on the sign-in page, with a fixed code and none of the provider’s words', async ({
    page,
    at,
  }) => {
    signInAs({
      subject: 'sub-broken',
      email: 'broken@example.org',
      emailVerified: true,
      preferredUsername: 'broken',
    });
    await page.goto(at('/login'));
    idp.fail.token = true;
    try {
      await providerButton(page).click();
      await expect(page).toHaveURL(/\/login\?error=provider-unavailable$/);
      await expect(page.getByRole('alert')).toContainText(
        'The sign-in provider could not be reached or answered unexpectedly.',
      );
    } finally {
      idp.fail.token = false;
    }
    // A made-up code in the address shows nothing: the page takes only the codes it knows.
    await page.goto(`${at('/login')}?error=Secret+provider+text`);
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await expect(page.getByText('Secret provider text')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('does not sign in an address that an account holds: a mail goes to its holder, who connects the provider', async ({
    page,
    at,
    basePath,
    context,
  }) => {
    const wren = person('wren');
    await createUser(page.request, at, wren);
    signInAs({
      subject: 'sub-wren',
      email: 'wren@example.org',
      emailVerified: true,
      preferredUsername: 'wren',
    });

    await page.goto(at('/login'));
    await providerButton(page).click();
    await expect(page).toHaveURL(new RegExp(`${at('/login')}\\?notice=check-mail$`));
    await expect(page.getByRole('status').first()).toContainText(
      'If an account already uses the address your provider gave us',
    );
    expect((await context.cookies()).some((c) => c.name === '__Host-session')).toBe(false);

    // The holder opens the link from the mail: not signed in, so they sign in first and come back.
    const link = linkIn(await mailTo(basePath, 'wren@example.org', 'identity.oidc-link'));
    expect(link.path).toBe(at('/link-sign-in'));
    await page.goto('about:blank');
    await page.goto(`${at('/link-sign-in')}#token=${encodeURIComponent(link.token)}`);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // The token is in neither address on the way.
    expect(page.url()).not.toContain(link.token);
    await page.getByLabel('Username').fill(wren.username);
    await page.getByLabel('Password', { exact: true }).fill(wren.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect a sign-in provider' })).toBeVisible();
    expect(page.url()).not.toContain(link.token);
    await expect(page).toHaveURL(new RegExp(`${at('/link-sign-in')}$`));

    // The page cannot name the provider before it is confirmed, and says what confirming does.
    await page.getByRole('button', { name: 'Connect the provider' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Stub provider is connected to your account.',
    );

    // The link was single use.
    await page.goto('about:blank');
    await page.goto(`${at('/link-sign-in')}#token=${encodeURIComponent(link.token)}`);
    await page.getByRole('button', { name: 'Connect the provider' }).click();
    await expect(page.getByRole('alert')).toContainText('not valid');

    // From now on the provider signs wren in.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.goto(at('/login'));
    await providerButton(page).click();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.locator('#account-menu').getByText('Signed in as wren')).toBeVisible();
  });

  test('[ASVS-7.5.1] is how an account without a password confirms its identity, and the change it asked for is then made', async ({
    page,
    playwright,
    baseURL,
    at,
    basePath,
  }) => {
    signInAs({
      subject: 'sub-xan',
      email: 'xan@example.org',
      emailVerified: true,
      preferredUsername: 'xan',
    });
    await page.goto(at('/login'));
    await providerButton(page).click();
    await approve(playwright, baseURL, at, 'xan');
    await page.goto(at('/login'));
    await providerButton(page).click();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await makeSessionsStale(basePath, 'xan');

    await page.goto(at('/profile'));
    await page.getByLabel('Email address').fill('xan.new@example.org');
    await page.getByRole('button', { name: 'Save' }).first().click();

    // The account has no password: whatever is typed, the dialog turns to the provider.
    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    await dialog.getByLabel('Password').fill('there is none');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog.getByText('Your account has no password.')).toBeVisible();

    // Leaves for the provider, which asks for a login now, and returns to the start page ...
    await dialog.getByRole('button', { name: 'Sign in again with Stub provider' }).click();
    // ... where the application opens the profile again and makes the change.
    await expect(page.getByText('A confirmation was mailed to xan.new@example.org.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${at('/profile')}$`));
    const asked = idp.lastAuthorization!;
    expect(asked.get('prompt')).toBe('login');
    expect(asked.get('max_age')).toBe('0');
    expect(asked.get('code_challenge_method')).toBe('S256');
    expect(asked.get('nonce')).toBeTruthy();
    // What was kept for the way back is gone.
    expect(await page.evaluate(() => window.sessionStorage.getItem('scorpion.reauth'))).toBeNull();
  });

  test('starts linking a provider from the profile, after the identity is confirmed', async ({
    page,
    at,
    basePath,
  }) => {
    const yan = person('yan');
    await createUser(page.request, at, yan);
    await signInThroughPage(page, at, yan);
    await makeSessionsStale(basePath, yan.username);
    signInAs({ subject: 'sub-yan', email: 'yan@elsewhere.example', emailVerified: true });
    await page.goto(at('/profile'));
    await page.getByRole('button', { name: 'Connect Stub provider' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm your identity' });
    await dialog.getByLabel('Password').fill(yan.password);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    // After the password the browser goes to the provider and comes back signed in, linked.
    await expect(page).toHaveURL(new RegExp(`${at('/')}$`));
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    expect(idp.lastAuthorization!.get('state')).toBeTruthy();
  });
});
