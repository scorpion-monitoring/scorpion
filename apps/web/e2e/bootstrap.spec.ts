import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './support/fixtures.ts';
import { stackFor } from './support/db.ts';

// The first administrator of a fresh install (runs on the stacks without an administrator, see
// support/stack.ts): the start page is the form and nothing else is reachable; once it is used the form
// is gone. The one-time token is printed once on the standard error of the API, which the log of the
// stack keeps, as the operator would read it from the console.

const FIRST = {
  username: 'founder',
  email: 'founder@example.org',
  password: 'an extremely long founding passphrase',
};

function tokenOf(basePath: string): string {
  const { name } = stackFor(basePath, true);
  const log = readFileSync(
    resolve(import.meta.dirname, `../test-results/stack-${name}.log`),
    'utf8',
  );
  const found = /sfr_[A-Za-z0-9_-]{43}/.exec(log);
  if (!found) throw new Error('the API printed no first-run token');
  return found[0];
}

test('the first administrator is created on the start page, and the form is gone afterwards', async ({
  page,
  at,
  basePath,
}) => {
  // Nothing but the form is reachable.
  await page.goto(at('/'));
  await expect(page.getByRole('heading', { name: 'Set up the first administrator' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  for (const path of ['/login', '/register', '/docs', '/legal/terms', '/setup', '/no/such/page']) {
    await page.goto(at(path));
    await expect(page).toHaveURL(new RegExp(`${at('/')}$`));
    await expect(
      page.getByRole('heading', { name: 'Set up the first administrator' }),
    ).toBeVisible();
  }
  // The password of the administrator is masked and may be pasted and filled by a password manager (ASVS 6.2.6, 6.2.7).
  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.locator('form input[autocomplete="username"]')).toHaveCount(1);
  // The API stays up for the people who run it.
  expect((await page.request.get(at('/readyz'))).status()).toBe(200);
  expect(await (await page.request.get(at('/api/internal/bootstrap/status'))).json()).toEqual({
    needsFirstAdmin: true,
  });

  // A token that is not the printed one is refused, and says what to do.
  await page.goto(at('/'));
  await page.getByLabel('One-time token').fill(`sfr_${'A'.repeat(43)}`);
  await page.getByLabel('Username').fill(FIRST.username);
  await page.getByLabel('Email address').fill(FIRST.email);
  await page.getByLabel('Password', { exact: true }).fill(FIRST.password);
  await page.getByRole('button', { name: 'Create the administrator' }).click();
  await expect(page.getByRole('alert')).toContainText('The token is not valid');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');

  // The printed token works, once.
  const token = tokenOf(basePath);
  await page.getByLabel('One-time token').fill(token);
  await page.getByLabel('Password', { exact: true }).fill(FIRST.password);
  await page.getByRole('button', { name: 'Create the administrator' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${at('/login')}$`));

  // The form is gone: a page that does not exist, and the ordinary start page.
  await page.goto(at('/setup'));
  await expect(page.getByText('This page does not exist.')).toBeVisible();
  await page.goto(at('/'));
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(
    'Set up the first administrator',
  );
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(await (await page.request.get(at('/api/internal/bootstrap/status'))).json()).toEqual({
    needsFirstAdmin: false,
  });
  // The token is dead, for anybody.
  const again = await page.request.post(at('/api/internal/bootstrap/first-admin'), {
    data: { token, username: 'intruder', email: 'intruder@example.org', password: FIRST.password },
  });
  expect(again.status()).toBe(401);

  // The administrator signs in, and sees the account menu.
  await page.goto(at('/login'));
  await page.getByLabel('Username').fill(FIRST.username);
  await page.getByLabel('Password', { exact: true }).fill(FIRST.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
});
