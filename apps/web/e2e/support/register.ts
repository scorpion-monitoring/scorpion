import type { Page } from '@playwright/test';

/** Fills in and sends the registration form of the page `/register`. */
export async function register(
  page: Page,
  at: (path: string) => string,
  who: { username: string; email: string; password: string },
) {
  await page.goto(at('/register'));
  await page.getByLabel('Username').fill(who.username);
  await page.getByLabel('Email address').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Create the account' }).click();
}
