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

// The sign-in page: a person signs in, a refusal does not say which part was wrong, a throttled account is
// told how long to wait, the way back goes only to a page of this instance, and the buttons of the
// providers come from the API.

test.describe('the sign-in page', () => {
  test('signs a person in and shows who is signed in', async ({ page, at }) => {
    const ada = person('ada');
    await createUser(page.request, at, ada);
    await signInThroughPage(page, at, ada);
    await expect(page).toHaveURL(new RegExp(`${at('/')}$`));
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.locator('#account-menu').getByText('Signed in as ada')).toBeVisible();
  });

  test('refuses a wrong password and an unknown name with one and the same message', async ({
    page,
    at,
  }) => {
    const bob = person('bob');
    await createUser(page.request, at, bob);
    const refusals: string[] = [];
    for (const credentials of [
      { username: 'bob', password: 'not the password at all' },
      { username: 'nobody-here', password: 'not the password at all' },
    ]) {
      await page.goto(at('/login'));
      await page.getByLabel('Username').fill(credentials.username);
      await page.getByLabel('Password', { exact: true }).fill(credentials.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible();
      refusals.push((await alert.textContent()) ?? '');
      // Nobody is signed in, and the password is not left in the field.
      await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    }
    expect(refusals[0]).toBe('The username or password is wrong.');
    expect(refusals[1]).toBe(refusals[0]);
  });

  test('tells a throttled caller how long to wait, the same for an unknown name', async ({
    page,
    at,
  }) => {
    // The throttle counts failures per account and, past a higher limit, per account from anywhere. The
    // name need not exist: an unknown name is counted and answered exactly like a known one.
    const target = { username: 'no-such-account', password: 'a wrong password' };
    let answer = 0;
    for (let attempt = 0; attempt < 40 && answer !== 429; attempt += 1) {
      answer = (await page.request.post(at('/api/internal/auth/login'), { data: target })).status();
    }
    expect(answer, 'the throttle answers 429 after enough failures').toBe(429);

    await page.goto(at('/login'));
    await page.getByLabel('Username').fill(target.username);
    await page.getByLabel('Password', { exact: true }).fill(target.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      /Too many failed attempts\. Try again in \d+ seconds?\./,
    );
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  });

  test('goes back to the page that asked for a sign-in, under the base path', async ({
    page,
    at,
  }) => {
    const cleo = person('cleo');
    await createUser(page.request, at, cleo);
    await page.goto(at('/profile'));
    // Signed out, the profile page is the sign-in page with a way back.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(at('/profile'));
    await page.getByLabel('Username').fill(cleo.username);
    await page.getByLabel('Password', { exact: true }).fill(cleo.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${at('/profile')}$`));
  });

  for (const target of ['https://evil.example/steal', '//evil.example/steal', '/\\evil.example']) {
    test(`does not follow a returnTo of ${target}`, async ({ page, at }) => {
      const dora = person(`dora${Math.abs(hash(target))}`);
      await createUser(page.request, at, dora);
      await page.goto(`${at('/login')}?returnTo=${encodeURIComponent(target)}`);
      await page.getByLabel('Username').fill(dora.username);
      await page.getByLabel('Password', { exact: true }).fill(dora.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
      // On this instance, at its start page: never on the other origin.
      await expect(page).toHaveURL(new RegExp(`${at('/')}$`));
      expect(page.url()).not.toContain('evil.example');
    });
  }

  test('says a signed-in visitor is signed in', async ({ page, at }) => {
    await signIn(page.request, at, admin);
    await page.goto(at('/login'));
    await expect(page.getByText('You are signed in as root.')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  });

  test('shows the notice of a provider sign-in that sent a mail instead of signing in', async ({
    page,
    at,
  }) => {
    await page.goto(`${at('/login')}?notice=check-mail`);
    await expect(page.getByRole('status').first()).toContainText(
      'If an account already uses the address your provider gave us',
    );
    // Whatever is in the address, only the known notices are shown.
    await page.goto(`${at('/login')}?notice=<b>nope</b>`);
    await expect(page.getByText('nope')).toHaveCount(0);
  });
});

test.describe('the sign-in providers', () => {
  test('are the buttons of the providers the API lists, and a click starts the sign-in at the provider', async ({
    page,
    request,
    at,
  }) => {
    const csrf = await signIn(request, at, admin);
    const provider = {
      id: 'campus',
      displayName: 'Campus Login',
      issuer: 'https://idp.example.invalid',
      clientId: 'scorpion',
    };
    await saveSettings(request, at, csrf, 'core.identity', (values) => ({
      ...values,
      oidcProviders: [provider],
    }));
    await request.post(at('/api/internal/auth/logout'), { headers: { 'x-csrf-token': csrf } });
    try {
      // The provider is not called: the start route is answered here, as it would be by a reachable one.
      await page.route('**/auth/oidc/campus/start', (route) =>
        route.fulfill({
          json: { authorizationUrl: `${new URL(page.url()).origin}${at('/docs')}?from=provider` },
        }),
      );
      await page.goto(at('/login'));
      const button = page.getByRole('button', { name: 'Sign in with Campus Login' });
      await expect(button).toBeVisible();
      // Nothing of the provider's configuration is in the page.
      expect(await page.content()).not.toContain('idp.example.invalid');
      await button.click();
      await expect(page).toHaveURL(/\/docs\?from=provider$/);
    } finally {
      const again = await signIn(request, at, admin);
      await saveSettings(request, at, again, 'core.identity', (values) => ({
        ...values,
        oidcProviders: [],
      }));
    }
  });
});

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0;
  return value;
}
