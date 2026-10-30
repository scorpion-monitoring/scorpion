import { expect, signInThroughPage, test } from './support/fixtures.ts';
import { profileOf } from './support/profile.ts';

// The profile page: details, the picture, the password, access tokens, sessions and preferences.

test.describe('the details', () => {
  test('show the problems of the server under the field', async ({ page, at }) => {
    await profileOf(page, at, 'jon');
    // The browser takes this for an address; the server does not.
    await page.getByLabel('Email address').fill('x@y');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('the picture', () => {
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

test.describe('the sessions', () => {
  test('[ASVS-7.5.2] are listed, and a second browser ends the first one from the list', async ({
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
