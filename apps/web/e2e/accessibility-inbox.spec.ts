import type { Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { activeUser, adminApi, newPerson, registerPending } from './support/admin.ts';
import { admin, expect, signInThroughPage, test } from './support/fixtures.ts';

// M5 sprint 4: no serious or critical axe violation on the dashboard (with its cards), the bell with its menu
// open, the inbox page and the notification settings, in both themes; and the bell and the settings are used
// with the keyboard alone.

test.use({ reducedMotion: 'reduce' });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the inbox and the dashboard, ${scheme} theme`, () => {
    test('have no serious violation', async ({ page, playwright, baseURL, at }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      await registerPending(api, at, newPerson(`axe${scheme}`));
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await signInThroughPage(page, at, admin);
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);

      await page.goto(at('/'));
      await expect(
        page.getByRole('region', { name: 'Registrations waiting for approval' }),
      ).toContainText(/wait/);
      await expect(
        page.getByRole('region', { name: 'Mail that could not be delivered' }),
      ).toBeVisible();
      await clean('the dashboard');

      await page.getByRole('button', { name: /^Inbox/ }).click();
      await expect(page.getByRole('region', { name: 'Inbox' })).toBeVisible();
      await clean('the bell with its menu open');
      await page.keyboard.press('Escape');

      await page.goto(at('/inbox'));
      await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
      await clean('/inbox');

      await page.goto(at('/profile/notifications'));
      await expect(
        page.getByRole('heading', { name: 'Notification settings', level: 1 }),
      ).toBeVisible();
      await clean('/profile/notifications');
      await page
        .getByRole('group', { name: 'Your account' })
        .getByRole('checkbox')
        .first()
        .uncheck();
      await clean('/profile/notifications with a change');
      await api.dispose();
    });
  });
}

async function tabTo(page: Page, target: ReturnType<Page['locator']>, max = 80) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return presses;
  }
  throw new Error(`the control was not reached with ${max} presses of Tab`);
}

test.describe('the keyboard', () => {
  test('opens the bell with Enter, reads its items, closes it with Escape and gets the focus back', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('kbdbell');
    await activeUser(api, at, who);
    await signInThroughPage(page, at, who);
    const bell = page.getByRole('button', { name: /^Inbox/ });
    await tabTo(page, bell);
    await page.keyboard.press('Enter');
    const menu = page.getByRole('region', { name: 'Inbox' });
    await expect(menu).toBeVisible();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: 'See all messages' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(bell).toBeFocused();
    await api.dispose();
  });

  test('saves the notification settings with the keyboard alone', async ({
    page,
    playwright,
    baseURL,
    at,
  }) => {
    const api = await adminApi(playwright, baseURL, at);
    const who = newPerson('kbdprefs');
    await activeUser(api, at, who);
    await signInThroughPage(page, at, who);
    await page.goto(at('/profile/notifications'));
    const toggle = page
      .getByRole('group', { name: 'Your account' })
      .getByRole('checkbox', { name: 'In the inbox' });
    await tabTo(page, toggle);
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Enter'); // Enter in a form control submits it
    await expect(
      page
        .getByRole('region', { name: 'Notifications' })
        .getByText('Your notification settings were saved.'),
    ).toBeVisible();
    await api.dispose();
  });
});
