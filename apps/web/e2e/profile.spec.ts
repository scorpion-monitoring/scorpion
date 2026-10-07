import { makePng } from '@scorpion/testing';
import {
  createUser,
  expect,
  person,
  signInThroughPage,
  test,
  type Credentials,
} from './support/fixtures.ts';

// The profile page: details, the picture, the password, access tokens, sessions and preferences.

async function profileOf(
  page: import('@playwright/test').Page,
  at: (path: string) => string,
  name: string,
): Promise<Credentials> {
  const who = person(name);
  await createUser(page.request, at, who);
  await signInThroughPage(page, at, who);
  await page.goto(at('/profile'));
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  return who;
}

test.describe('the details', () => {
  test('are saved, shown as text and kept after a reload', async ({ page, at }) => {
    await profileOf(page, at, 'ivy');
    await expect(page.getByRole('term').filter({ hasText: 'Roles' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: /^user$/ })).toBeVisible();

    await page.getByLabel('Display name').fill('Ivy Example');
    // Markup in a bio is text, never HTML.
    await page.getByLabel('About you').fill('Hello <b>world</b> <img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue('Ivy Example');
    await expect(page.getByLabel('About you')).toHaveValue(
      'Hello <b>world</b> <img src=x onerror=alert(1)>',
    );
    expect(await page.locator('main b').count()).toBe(0);
  });

  test('show the problems of the server under the field', async ({ page, at }) => {
    await profileOf(page, at, 'jon');
    // The browser takes this for an address; the server does not.
    await page.getByLabel('Email address').fill('x@y');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('the picture', () => {
  test('is uploaded, shown from the stored copy, and removed', async ({ page, at }) => {
    await profileOf(page, at, 'kai');
    await expect(page.getByText('You have not set a picture.')).toBeVisible();
    await page.getByLabel('Choose a picture').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: makePng(16),
    });
    const image = page.getByRole('img', { name: 'Picture of kai' });
    await expect(image).toBeVisible();
    // The page shows the server's own copy, by the hash of its content.
    await expect(image).toHaveAttribute(
      'src',
      new RegExp(`${at('/api/internal/files/')}[0-9a-f]{64}$`),
    );
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Remove the picture' }).click();
    await expect(page.getByText('You have not set a picture.')).toBeVisible();
  });

  test('is refused by the server when it is no image, and the page says so', async ({
    page,
    at,
  }) => {
    await profileOf(page, at, 'lou');
    await page.getByLabel('Choose a picture').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not an image'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('You have not set a picture.')).toBeVisible();
  });

  test('is checked for size before it is sent', async ({ page, at }) => {
    await profileOf(page, at, 'max');
    let uploads = 0;
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('/account/avatar')) uploads += 1;
    });
    await page.getByLabel('Choose a picture').setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
    });
    await expect(page.getByRole('alert')).toContainText('at most 8 megabytes');
    expect(uploads).toBe(0);
  });
});

test.describe('the password', () => {
  test('is changed with the current one, which ends every session', async ({ page, at }) => {
    const who = await profileOf(page, at, 'nia');
    const next = 'brand new long passphrase 9';
    await page.getByLabel('Current password').fill('not my current password');
    await page.getByLabel('New password').fill(next);
    await page.getByRole('button', { name: 'Change the password' }).click();
    await expect(page.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel('Current password').fill(who.password);
    await page.getByLabel('New password').fill(next);
    await page.getByRole('button', { name: 'Change the password' }).click();
    // Signed out, at the sign-in page, with the notice.
    await expect(page.getByRole('status').first()).toContainText('Your password was changed');
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    await signInThroughPage(page, at, { username: who.username, password: next });
  });
});

test.describe('the access tokens', () => {
  test('are created with a scope, replaced and revoked; the secret is shown once', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    await profileOf(page, at, 'oli');
    const tokens = page.getByRole('region', { name: 'Access tokens' });

    // A token needs a name and at least one permission: the server says so.
    await tokens.getByLabel('Name').fill('first');
    await tokens.getByRole('button', { name: 'Create the token' }).click();
    await expect(tokens.getByText(/at least one permission/i)).toBeVisible();

    await tokens.getByRole('checkbox', { name: 'core.identity.me.read' }).check();
    await tokens.getByRole('button', { name: 'Create the token' }).click();
    const first = (await page.getByTestId('token-secret').textContent())!;
    await expect(page.getByText('This is the only time it is shown.')).toBeVisible();

    // Replacing it shows a new secret, and the old one stops working.
    await page.getByRole('button', { name: 'I have copied it' }).click();
    await tokens.getByRole('button', { name: 'Replace the token first' }).click();
    const second = (await page.getByTestId('token-secret').textContent())!;
    expect(second).not.toBe(first);
    const api = async (secret: string) =>
      (
        await (
          await playwright.request.newContext({
            baseURL,
            extraHTTPHeaders: { authorization: `Bearer ${secret}` },
          })
        ).get(at('/api/internal/auth/me'))
      ).status();
    expect(await api(first)).toBe(401);
    expect(await api(second)).toBe(200);

    // Revoking asks twice.
    await page.getByRole('button', { name: 'I have copied it' }).click();
    await tokens.getByRole('button', { name: 'Revoke the token first' }).click();
    await tokens.getByRole('button', { name: 'Really revoke the token first' }).click();
    await expect(tokens.getByText('You have no access tokens.')).toBeVisible();
    expect(await api(second)).toBe(401);
  });
});

test.describe('the sessions', () => {
  test('are listed, and a second browser ends the first one from the list', async ({
    browser,
    baseURL,
    at,
  }) => {
    const first = await browser.newContext({ baseURL });
    const second = await browser.newContext({ baseURL });
    try {
      const pageOne = await first.newPage();
      const who = await profileOf(pageOne, at, 'pat');
      const pageTwo = await second.newPage();
      await signInThroughPage(pageTwo, at, who);
      await pageTwo.goto(at('/profile'));

      const sessions = pageTwo.getByRole('region', { name: 'Sessions' });
      await expect(sessions.getByRole('row')).toHaveCount(3); // the header and two sessions
      await expect(sessions.getByText('This session')).toHaveCount(1);

      // The other session is the row without the marker.
      await sessions
        .getByRole('row')
        .filter({ hasNotText: 'This session' })
        .getByRole('button', { name: 'End' })
        .click();
      await expect(sessions.getByRole('row')).toHaveCount(2);

      // The first browser is signed out at its next request.
      await pageOne.reload();
      await expect(pageOne.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(pageOne.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
      // The second one is still in.
      await pageTwo.reload();
      await expect(pageTwo.getByRole('heading', { name: 'Your profile' })).toBeVisible();
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('can all be ended from one button, ours included', async ({ page, at }) => {
    await profileOf(page, at, 'quin');
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page.getByRole('status').first()).toContainText('You were signed out.');
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
  });
});

test.describe('the language', () => {
  test('follows the browser for a visitor', async ({ browser, baseURL, at }) => {
    const german = await browser.newContext({ baseURL, locale: 'de-DE' });
    try {
      const visitor = await german.newPage();
      await visitor.goto(at('/login'));
      await expect(visitor.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
      await expect(visitor.locator('html')).toHaveAttribute('lang', 'de');
      // A browser language that is not shipped gets English.
      const french = await browser.newContext({ baseURL, locale: 'fr-FR' });
      const other = await french.newPage();
      await other.goto(at('/login'));
      await expect(other.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(other.locator('html')).toHaveAttribute('lang', 'en');
      await french.close();
    } finally {
      await german.close();
    }
  });

  test('follows the preference of a person over the browser, and is kept for the next sign-in', async ({
    page,
    at,
  }) => {
    const who = await profileOf(page, at, 'ria');
    await page.getByLabel('Language').selectOption('de');
    await page.getByRole('button', { name: 'Save' }).last().click();
    await expect(page.getByRole('heading', { name: 'Ihr Profil' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    // Signed out, nobody is known and the English browser decides; signed in again, it is German.
    await page.getByRole('button', { name: 'Kontomenü' }).click();
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await page.goto(at('/login'));
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Username').fill(who.username);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Kontomenü' })).toBeVisible();

    // Back to "as my browser says".
    await page.goto(at('/profile'));
    await page.getByLabel('Sprache').selectOption('');
    await page.getByRole('button', { name: 'Speichern' }).last().click();
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  });
});
