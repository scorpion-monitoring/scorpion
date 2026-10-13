import type { Locator, Page } from '@playwright/test';
import { makePng } from '@scorpion/testing';
import { violations } from './support/a11y.ts';
import { activeUser, adminApi, newPerson } from './support/admin.ts';
import { pageAs } from './support/members.ts';
import { seedCatalogue } from './support/services.ts';
import { expect, test } from './support/fixtures.ts';

// M7 sprint 4: no serious or critical axe violation on the catalogue (unfiltered, with chosen filters and
// their badges, and empty), in both themes, with an icon whose `alt` text comes from the name; and a path
// through search and filter with the keyboard alone. The service icon is an image of the service's own.

test.use({ reducedMotion: 'reduce' });

const rows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('rowheader') });

/** Presses Tab until the element has the focus; fails when the keyboard cannot reach it. */
async function tabTo(page: Page, target: Locator, presses = 150) {
  for (let i = 0; i < presses; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`the keyboard cannot reach ${String(target)}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the catalogue, ${scheme} theme`, () => {
    test('has no serious violation, with and without filters, with an icon and when empty', async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const c = await seedCatalogue(api);
      const icon = await api.request.put(at(`/api/internal/services/${c.zeta.id}/icon`), {
        headers: { 'x-csrf-token': api.csrf, 'content-type': 'application/octet-stream' },
        data: makePng(32),
      });
      expect(icon.status(), await icon.text()).toBe(200);
      const reader = newPerson('axcat');
      await activeUser(api, at, reader);
      const opened = await pageAs(browser, baseURL, at, reader);
      const page = opened.page;
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const clean = async (what: string) => expect(await violations(page), what).toEqual([]);

      await page.goto(at(`/services?q=${c.tag}`));
      await expect(rows(page)).toHaveCount(20);
      await clean('the catalogue');
      await page.goto(at(`/services?q=${c.tag}&sort=name&dir=desc&pageSize=10`));
      // The icon has an alt text from the name of the service.
      await expect(page.getByRole('img', { name: `Icon of ${c.zeta.name}` })).toBeVisible();
      await clean('the catalogue with an icon, sorted, ten to a page');

      await page.goto(
        at(`/services?q=${c.tag}&f.stage=DEV&f.stage=PROD&f.consortium=${c.consortia[0].id}`),
      );
      await expect(page.getByRole('button', { name: /^Remove the filter/ })).toHaveCount(3);
      await clean('the catalogue with chosen filters and their badges');

      await page.goto(at(`/services?q=${c.tag}&f.stage=DEV&f.consortium=:none`));
      await expect(page.getByText('No service matches.')).toBeVisible();
      await clean('the empty catalogue');
      await opened.close();
      await api.dispose();
    });
  });
}

test.describe('the catalogue by keyboard', () => {
  test('search, choose a filter, remove its badge and page without a mouse', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const api = await adminApi(playwright, baseURL, at);
    const c = await seedCatalogue(api);
    const reader = newPerson('kbcat');
    await activeUser(api, at, reader);
    const opened = await pageAs(browser, baseURL, at, reader);
    const page = opened.page;

    await page.goto(at('/services'));
    // The search: reached by Tab from the top of the page, typed into and submitted with Enter.
    const search = page.getByLabel('Search by name or short name');
    await tabTo(page, search);
    await page.keyboard.type(c.tag);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`q=${c.tag}`));
    await expect(rows(page)).toHaveCount(20);

    // A filter: Tab to the checkbox, Space chooses it, and a badge with its name appears.
    const production = page.getByRole('checkbox', { name: /^Production/ });
    await tabTo(page, production);
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/f\.stage=PROD/);
    const badge = page.getByRole('button', { name: 'Remove the filter Stage: Production' });
    await expect(badge).toBeVisible();

    // The badge comes off with Enter.
    await tabTo(page, badge);
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/f\.stage/);
    await expect(badge).toHaveCount(0);

    // The pages: the next page by keyboard, and the sorted column by keyboard.
    const next = page.getByRole('button', { name: 'Next' });
    await tabTo(page, next);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/page=1/);
    await expect(rows(page)).toHaveCount(4);
    const sort = page.getByRole('button', { name: /^Service/ });
    await tabTo(page, sort);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/dir=desc/);
    await expect(page).not.toHaveURL(/page=/);
    await opened.close();
    await api.dispose();
  });
});
