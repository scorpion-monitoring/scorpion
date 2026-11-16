import { expect, inBothThemes, test } from './support.ts';
import type { Page } from '@playwright/test';

// FacetSearch (harness/scenes/facet-search.svelte, sprint 3 of M12a): the shared state behind the three looks.
// The scene counts like the catalogue's API. These tests hold for every look; the look's own keyboard path,
// ARIA snapshots and axe states are in the describe blocks per look.

const live = (page: Page) => page.locator('[data-facet-status]');
const address = async (page: Page) =>
  new URLSearchParams(await page.getByTestId('search').innerText());
/** The count in a checkbox's name, "de.NBI (7)" → 7. */
const countOf = async (page: Page, name: RegExp) => {
  const label = await page
    .getByRole('checkbox', { name })
    .getAttribute('aria-label')
    .catch(() => null);
  const text = label ?? (await page.getByRole('checkbox', { name }).locator('..').innerText());
  return Number(/\((\d+)\)/.exec(text)?.[1]);
};

test.describe('FacetSearch, look sidebar', () => {
  const open = (page: Page, scene: (n: string, o?: object) => Promise<void>, query = '') =>
    scene('facet-search', { query: `look=sidebar${query ? `&${query}` : ''}` });

  test('searches as one types, without a button, and says how many match', async ({
    page,
    scene,
  }) => {
    await open(page, scene, 'page=3&sort=stage');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search services' }).fill('galaxy');
    await expect(page.getByTestId('rows').getByRole('listitem')).toHaveText(['Service D Galaxy']);
    await expect(page.getByText('1 service matches', { exact: true })).toBeVisible();
    await expect(live(page)).toHaveText('1 service matches');
    const search = await address(page);
    expect(search.get('q')).toBe('galaxy');
    expect(search.get('sort')).toBe('stage');
    expect(search.get('page')).toBeNull(); // a change returns to the first page
    // The box keeps the focus while the list changes under it.
    await expect(page.getByRole('searchbox', { name: 'Search services' })).toBeFocused();
  });

  test('a filter counts over the other facets, returns to page 0 and is announced', async ({
    page,
    scene,
  }) => {
    await open(page, scene, 'page=2');
    const denbi = await countOf(page, /^de\.NBI/);
    await page.getByRole('checkbox', { name: /^de\.NBI/ }).check();
    await expect(live(page)).toHaveText(`${denbi} services match`);
    expect((await address(page)).getAll('f.consortium')).toEqual(['denbi']);
    expect((await address(page)).get('page')).toBeNull();
    // OR within a facet: a second consortium adds services; ticking one never hides its siblings.
    const nfdi = await countOf(page, /^NFDI4Plants/);
    await page.getByRole('checkbox', { name: /^NFDI4Plants/ }).check();
    // The one service in both consortia is counted once.
    await expect(live(page)).toHaveText(`${denbi + nfdi - 1} services match`);
    await expect(page.getByRole('checkbox', { name: /^No consortium/ })).toBeVisible();
    // AND between facets.
    await page.getByRole('checkbox', { name: /^Production/ }).check();
    const shown = await page.getByTestId('rows').getByRole('listitem').count();
    await expect(live(page)).toHaveText(
      shown === 1 ? '1 service matches' : `${shown} services match`,
    );
  });

  test('a chosen value with no match keeps count 0 and stays removable', async ({
    page,
    scene,
  }) => {
    await open(page, scene, 'f.consortium=denbi&q=zzz');
    await expect(page.getByText('No services match', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'de.NBI (0)' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'de.NBI (0)' }).click();
    // Not chosen any more, and no service has it: the facet no longer lists it (the API's rule).
    await expect(page.getByRole('checkbox', { name: /^de\.NBI/ })).toHaveCount(0);
    expect((await address(page)).getAll('f.consortium')).toEqual([]);
    await expect(live(page)).toHaveText('No services match');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByTestId('state')).toHaveText('{"q":"","state":{}}');
    await expect(live(page)).toHaveText('24 services match');
  });

  test('text that matches no name but a facet value offers that value (decision Q2)', async ({
    page,
    scene,
  }) => {
    await scene('facet-search', { query: 'look=sidebar&set=zero&q=gatersleben' });
    await expect(page.getByText('No services match the name', { exact: true })).toBeVisible();
    const hint = page.getByRole('button', {
      name: /^Filter by Provider: IPK Gatersleben \(\d+\)$/,
    });
    await expect(hint).toBeVisible();
    // `q` keeps its meaning: the table shows no row.
    await expect(page.getByTestId('rows').getByRole('listitem')).toHaveCount(0);
    await hint.click();
    const search = await address(page);
    expect(search.get('q')).toBeNull();
    expect(search.getAll('f.provider')).toEqual(['ipk']);
    await expect(live(page)).toHaveText(/^\d+ services match$/);
  });

  test('speaks German when the page does', async ({ page, scene }) => {
    await scene('facet-search', { lang: 'de', query: 'look=sidebar' });
    await expect(page.getByText('24 Dienste passen', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: /^Production/ }).check();
    await expect(live(page)).toHaveText(/^\d+ Dienste? pass(t|en)$/);
  });

  test('[component:FacetSearch] keyboard (sidebar): type, Enter sends at once, Tab reaches the facets', async ({
    page,
    scene,
  }) => {
    await open(page, scene);
    const box = page.getByRole('searchbox', { name: 'Search services' });
    await box.focus();
    await page.keyboard.type('Service B');
    await page.keyboard.press('Enter');
    await expect(live(page)).toHaveText('1 service matches');
    await expect(box).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox').first()).toBeFocused();
    await page.keyboard.press('Space');
    await expect(live(page)).toHaveText(/services? match/);
  });

  inBothThemes(
    '[component:FacetSearch] axe (sidebar): nothing chosen',
    'facet-search',
    undefined,
    'look=sidebar',
  );
  inBothThemes(
    '[component:FacetSearch] axe (sidebar): 0 matches with the hint',
    'facet-search',
    undefined,
    'look=sidebar&set=zero&q=gatersleben',
  );
});
