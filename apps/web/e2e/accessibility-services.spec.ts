import type { Locator, Page } from '@playwright/test';
import { makePng } from '@scorpion/testing';
import { violations } from './support/a11y.ts';
import { activeUser, adminApi, newPerson } from './support/admin.ts';
import { pageAs } from './support/members.ts';
import {
  expectChosen,
  expectChosenFacets,
  LOOKS,
  sharedCatalogue,
  setLook,
  type Look,
} from './support/services.ts';
import { expect, test } from './support/fixtures.ts';

// M7 sprint 4: no serious or critical axe violation on the catalogue (unfiltered, with chosen filters, and empty),
// in both themes, with an icon whose `alt` text comes from the name; and a path through search and filter with
// the keyboard alone. The service icon is an image of the service's own. Sprint 3 of M12a: both run in each look of
// the filters (`catalogueFilters`), and in `bar` and `combined` axe also looks at an open panel of values.

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

/** Presses a key until the element named `name` is the active option of the combobox or listbox `owner`. */
async function arrowTo(page: Page, owner: Locator, name: RegExp, key = 'ArrowDown', presses = 40) {
  for (let i = 0; i < presses; i += 1) {
    const id = await owner.getAttribute('aria-activedescendant');
    if (id) {
      // The text without the drawn check mark and the space around it.
      const text = ((await page.locator(`[id="${id}"]`).textContent()) ?? '').replace(
        /^[\s✓]+/,
        '',
      );
      if (name.test(text)) return;
    }
    await page.keyboard.press(key);
  }
  throw new Error(`no active option ${String(name)} in ${String(owner)}`);
}

/** The look a test replaced, put back after it: the stack is shared by the specs that follow. */
let replaced: Look | undefined;
async function restoreLook(...args: Parameters<typeof adminApi>) {
  if (!replaced) return;
  const admin = await adminApi(...args);
  await setLook(admin, replaced);
  await admin.dispose();
}

for (const look of LOOKS) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`the catalogue, look ${look}, ${scheme} theme`, () => {
      test.afterEach(({ playwright, baseURL, at }) => restoreLook(playwright, baseURL, at));
      test('has no serious violation, with and without filters, with an icon and when empty', async ({
        browser,
        playwright,
        baseURL,
        at,
      }) => {
        test.slow();
        const api = await adminApi(playwright, baseURL, at);
        const c = await sharedCatalogue(api, baseURL!, 'a11y');
        replaced = await setLook(api, look);
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
        await expect(page.locator(`[data-facet-look="${look}"]`)).toBeVisible();
        await clean('the catalogue');
        await page.goto(at(`/services?q=${c.tag}&sort=name&dir=desc&pageSize=10`));
        // The icon has an alt text from the name of the service.
        await expect(page.getByRole('img', { name: `Icon of ${c.zeta.name}` })).toBeVisible();
        await clean('the catalogue with an icon, sorted, ten to a page');

        await page.goto(
          at(`/services?q=${c.tag}&f.stage=DEV&f.stage=PROD&f.consortium=${c.consortia[0].id}`),
        );
        // Sprint 3 of M12a: the copied badges are gone; the look draws each chosen value once (a checked box, a chip).
        await expectChosenFacets(page, 2);
        await expect(page.locator('[data-facet-count]')).toContainText(/\d+ services? match/);
        await clean('the catalogue with chosen filters');
        if (look !== 'sidebar') {
          await expectChosen(page, 'Stage', /^Production/);
          await clean('the catalogue with the values of a facet open');
        }

        await page.goto(at(`/services?q=${c.tag}&f.stage=DEV&f.consortium=:none`));
        await expect(page.getByText('No service matches.')).toBeVisible();
        await clean('the empty catalogue');
        await opened.close();
        await api.dispose();
      });
    });
  }
}

/** Chooses Production in the stage facet with the keyboard alone, in the look's own way. */
async function chooseProductionByKeyboard(page: Page, look: Look) {
  if (look === 'sidebar') {
    const production = page.getByRole('checkbox', { name: /^Production/ });
    await tabTo(page, production);
    await page.keyboard.press('Space');
    await expect(production).toBeChecked();
  } else if (look === 'bar') {
    const stage = page
      .getByRole('group', { name: 'Filter by' })
      .getByRole('button', { name: /^Stage/ });
    await tabTo(page, stage);
    await page.keyboard.press('Enter');
    const list = page.getByRole('listbox', { name: 'Stage' });
    await expect(list).toBeFocused();
    await arrowTo(page, list, /^Production/);
    await page.keyboard.press('Space');
    await expect(list.getByRole('option', { name: /^Production/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(stage).toBeFocused();
  } else {
    const box = page.getByRole('combobox', { name: 'Search by name or short name' });
    await expect(box).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await arrowTo(page, box, /^Stage/);
    await page.keyboard.press('Enter');
    const list = page.getByRole('listbox', { name: 'Stage' });
    await expect(box).toBeFocused();
    await arrowTo(page, box, /^Production/);
    await page.keyboard.press('Space');
    await expect(list.getByRole('option', { name: /^Production/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
  }
}

/** Takes the stage filter off with the keyboard alone, and returns what must be gone afterwards. */
async function removeStageByKeyboard(page: Page, look: Look): Promise<Locator> {
  if (look === 'sidebar') {
    const clear = page.getByRole('button', { name: 'Clear Stage' });
    await expect(clear).toBeVisible();
    await tabTo(page, clear);
    await page.keyboard.press('Enter');
    return clear;
  }
  const chip = page.getByRole('button', { name: 'Remove Stage: Production' });
  await expect(chip).toBeVisible();
  if (look === 'bar') {
    await tabTo(page, chip);
  } else {
    // In `combined` the chips are reached with Shift+Tab from the box.
    await page.getByRole('combobox', { name: 'Search by name or short name' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(chip).toBeFocused();
  }
  await page.keyboard.press('Enter');
  return chip;
}

for (const look of LOOKS) {
  test.describe(`the catalogue by keyboard, look ${look}`, () => {
    test.afterEach(({ playwright, baseURL, at }) => restoreLook(playwright, baseURL, at));
    test('search, choose a filter, remove it and page without a mouse', async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const api = await adminApi(playwright, baseURL, at);
      const c = await sharedCatalogue(api, baseURL!, 'a11y');
      replaced = await setLook(api, look);
      const reader = newPerson('kbcat');
      await activeUser(api, at, reader);
      const opened = await pageAs(browser, baseURL, at, reader);
      const page = opened.page;

      await page.goto(at('/services'));
      await expect(page.locator(`[data-facet-look="${look}"]`)).toBeVisible();
      // The search: reached by Tab from the top of the page, typed into and sent with Enter (it also searches as
      // one types, sprint 3 of M12a).
      const search = page.getByLabel('Search by name or short name');
      await tabTo(page, search);
      await page.keyboard.type(c.tag);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`q=${c.tag}`));
      await expect(rows(page)).toHaveCount(20);

      // A filter: chosen with the keyboard, and the count line says what is left.
      await chooseProductionByKeyboard(page, look);
      await expect(page).toHaveURL(/f\.stage=PROD/);
      await expect(page.locator('[data-facet-count]')).toContainText(
        `${c.total - 1} services match`,
      );

      // The filter comes off with Enter.
      const gone = await removeStageByKeyboard(page, look);
      await expect(page).not.toHaveURL(/f\.stage/);
      await expect(gone).toHaveCount(0);
      if (look === 'sidebar') {
        await expect(page.getByRole('checkbox', { name: /^Production/ })).not.toBeChecked();
      }

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
}
