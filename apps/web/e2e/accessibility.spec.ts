import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { admin, createUser, expect, signIn, test } from './support/fixtures.ts';

// No serious or critical violation (axe, WCAG 2.1 A and AA) on a page of the shell, in both themes, signed
// out and signed in; and the layout works with the keyboard alone (M5 plan §2, accessibility).
const SERIOUS = ['serious', 'critical'];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((violation) => SERIOUS.includes(violation.impact ?? ''))
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    );
}

test.describe('the pages of the shell have no serious accessibility violation', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`signed out, ${scheme} theme`, async ({ page, at }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ['/', '/docs', '/no/such/page']) {
        await page.goto(at(path));
        await expect(page.getByRole('banner')).toBeVisible();
        expect(await violations(page), path).toEqual([]);
      }
    });
  }

  test('signed in, with the account menu open, in the dark theme chosen by hand', async ({
    page,
    at,
  }) => {
    await signIn(page.request, at, admin);
    await page.goto(at('/'));
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('the sidebar in its icon rail has names for every link', async ({ page, at }) => {
    await page.goto(at('/'));
    await page.getByRole('button', { name: 'Collapse the sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Expand the sidebar' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    // The links keep their names (visually hidden) and show a tooltip.
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home' }),
    ).toBeVisible();
  });
});

test.describe('the keyboard', () => {
  test('a skip link is the first stop and moves focus to the main content', async ({
    page,
    at,
  }) => {
    await page.goto(at('/docs'));
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('the account menu opens with Enter and closes with Escape, returning focus', async ({
    page,
    at,
  }) => {
    await createUser(page.request, at, {
      username: 'keyboarder',
      password: 'a keyboard user password 1',
    });
    await signIn(page.request, at, {
      username: 'keyboarder',
      password: 'a keyboard user password 1',
    });
    await page.goto(at('/'));
    const trigger = page.getByRole('button', { name: 'Account menu' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('the menu button of a small screen opens the drawer, which has a way to close it', async ({
    page,
    at,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(at('/'));
    const open = page.getByRole('button', { name: 'Open the menu' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close the menu' }).first().click();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
  });
});
