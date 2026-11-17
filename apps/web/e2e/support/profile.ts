import type { Locator, Page } from '@playwright/test';
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

/**
 * Opens the groups of the permission tree on the way to a permission (`registry.services.v1.read` opens `registry`,
 * `registry.services` and `registry.services.v1`) and returns its checkbox. The tree starts closed.
 */
export async function permissionBox(region: Locator, id: string): Promise<Locator> {
  const segments = id.split('.');
  for (let length = 1; length < segments.length; length++) {
    const group = segments.slice(0, length).join('.');
    const button = region.getByRole('button', {
      name: `Show the permissions of ${group}`,
      exact: true,
    });
    if (await button.count()) await button.click();
  }
  return region.getByRole('checkbox', { name: id, exact: true });
}
