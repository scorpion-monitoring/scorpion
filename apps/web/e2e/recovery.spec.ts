import {
  createUser,
  expect,
  person,
  signInThroughPage,
  test,
  type Credentials,
} from './support/fixtures.ts';
import { linkIn, mailTo } from './support/db.ts';

// The pages the mails link to: a reset link and a verification link carry their token in the address
// fragment; the page reads it once, posts it and replaces the address. A reset link works once.

const NEW_PASSWORD = 'a different long passphrase 7';

/** Opens a mailed link as a person does from a mail program: a page load, never a change of the fragment alone. */
async function openLink(page: import('@playwright/test').Page, address: string) {
  await page.goto('about:blank');
  await page.goto(address);
}

async function ask(
  page: import('@playwright/test').Page,
  at: (p: string) => string,
  email: string,
) {
  await page.goto(at('/login'));
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send the link' }).click();
}

test.describe('forgotten passwords', () => {
  test('say the same for a known and an unknown address', async ({ page, at }) => {
    const fay: Credentials = person('fay');
    await createUser(page.request, at, fay);
    const answers: string[] = [];
    for (const email of ['fay@example.org', 'nobody@example.org']) {
      await ask(page, at, email);
      await expect(page.getByRole('status')).toContainText('If an account uses that address');
      answers.push(await page.getByRole('main').innerText());
    }
    expect(answers[1]).toBe(answers[0]);
  });

  test('a reset link sets a new password once, and its token is in no address afterwards', async ({
    page,
    at,
    basePath,
  }) => {
    const gus = person('gus');
    await createUser(page.request, at, gus);
    await ask(page, at, 'gus@example.org');
    await expect(page.getByRole('status')).toBeVisible();

    const link = linkIn(await mailTo(basePath, 'gus@example.org', 'identity.password-reset'));
    expect(link.path).toBe(at('/reset-password'));

    const visited: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(frame.url());
    });
    await openLink(page, `${at('/reset-password')}#token=${encodeURIComponent(link.token)}`);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    // The page has read the token and replaced the address: it is not in the bar, nor in the history.
    await expect(page).toHaveURL(new RegExp(`${at('/reset-password')}$`));
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(page.url()).not.toContain(link.token);

    // The server judges the new password; the page shows its words and the form stays usable.
    await page.getByLabel('New password').fill('short');
    await page.getByRole('button', { name: 'Set the password' }).click();
    const field = page.getByLabel('New password');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue('');

    await field.fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set the password' }).click();
    await expect(page.getByRole('status')).toContainText('Your password was changed');

    // The same link again is spent: the page says to ask for a new one.
    await openLink(page, `${at('/reset-password')}#token=${encodeURIComponent(link.token)}`);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set the password' }).click();
    await expect(page.getByRole('alert')).toContainText('has expired');
    await expect(page.getByRole('link', { name: 'Ask for a new link' })).toBeVisible();

    // Nothing the person typed or was sent is in an address the page was ever at.
    for (const address of visited) {
      expect(address).not.toContain(NEW_PASSWORD);
      expect(decodeURIComponent(address)).not.toContain(NEW_PASSWORD);
    }

    // The old password is gone, the new one works.
    await page.goto(at('/login'));
    await page.getByLabel('Username').fill(gus.username);
    await page.getByLabel('Password', { exact: true }).fill(gus.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('The username or password is wrong.');
    await signInThroughPage(page, at, { username: gus.username, password: NEW_PASSWORD });
  });

  test('a reset page without a token says to ask for a link', async ({ page, at }) => {
    await page.goto(at('/reset-password'));
    await expect(page.getByRole('alert')).toContainText('not valid');
    await expect(page.getByRole('link', { name: 'Ask for a new link' })).toBeVisible();
  });
});

test.describe('the mail of an email address', () => {
  test('confirms the new address once, and a page without a valid token says so', async ({
    page,
    at,
    basePath,
  }) => {
    const hal = person('hal');
    await createUser(page.request, at, hal);
    await signInThroughPage(page, at, hal);
    await page.goto(at('/profile'));
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
    await page.getByLabel('Email address').fill('hal.new@example.org');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('A confirmation was mailed to hal.new@example.org.')).toBeVisible();

    const link = linkIn(
      await mailTo(basePath, 'hal.new@example.org', 'identity.email-verification'),
    );
    expect(link.path).toBe(at('/verify-email'));
    await openLink(page, `${at('/verify-email')}#token=${encodeURIComponent(link.token)}`);
    await expect(page.getByRole('status')).toContainText('Your email address is confirmed.');
    await expect(page).toHaveURL(new RegExp(`${at('/verify-email')}$`));
    expect(page.url()).not.toContain(link.token);

    // A second visit with the same token is refused, and so is a visit with none.
    await openLink(page, `${at('/verify-email')}#token=${encodeURIComponent(link.token)}`);
    await expect(page.getByRole('alert')).toContainText('not valid');
    await openLink(page, at('/verify-email'));
    await expect(page.getByRole('alert')).toContainText('not valid');

    await page.goto(at('/profile'));
    await expect(page.getByLabel('Email address')).toHaveValue('hal.new@example.org');
  });
});
