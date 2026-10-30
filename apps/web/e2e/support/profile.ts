import type { Page } from '@playwright/test';
import { createUser, expect, person, signInThroughPage, type Credentials } from './fixtures.ts';

/** A new, signed-in person on the page `/profile`. */
export async function profileOf(
  page: Page,
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
