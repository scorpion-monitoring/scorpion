import { expect, inBothThemes, test } from './support.ts';
import type { Page } from '@playwright/test';

// FacetSearch (harness/scenes/facet-search.svelte, sprint 3 of M12a): the shared state behind the three looks.
// The scene counts like the catalogue's API. These tests hold for every look; the look's own keyboard path,
// ARIA snapshots and axe states are in the describe blocks per look.

const live = (page: Page) => page.locator('[data-facet-status]');
const address = async (page: Page) =>
  new URLSearchParams(await page.getByTestId('search').innerText());
/** The count in a checkbox's name, "BioNet (7)" → 7. */
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
    const bionet = await countOf(page, /^BioNet/);
    await page.getByRole('checkbox', { name: /^BioNet/ }).check();
    await expect(live(page)).toHaveText(`${bionet} services match`);
    expect((await address(page)).getAll('f.consortium')).toEqual(['bionet']);
    expect((await address(page)).get('page')).toBeNull();
    // OR within a facet: a second consortium adds services; ticking one never hides its siblings.
    const plantdata = await countOf(page, /^PlantData/);
    await page.getByRole('checkbox', { name: /^PlantData/ }).check();
    // The one service in both consortia is counted once.
    await expect(live(page)).toHaveText(`${bionet + plantdata - 1} services match`);
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
    await open(page, scene, 'f.consortium=bionet&q=zzz');
    await expect(page.getByText('No services match', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'BioNet (0)' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'BioNet (0)' }).click();
    // Not chosen any more, and no service has it: the facet no longer lists it (the API's rule).
    await expect(page.getByRole('checkbox', { name: /^BioNet/ })).toHaveCount(0);
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

test.describe('FacetSearch, look bar', () => {
  const open = (scene: (n: string, o?: object) => Promise<void>, query = '', lang?: 'de') =>
    scene('facet-search', { query: `look=bar${query ? `&${query}` : ''}`, lang });
  const facetButton = (page: Page, name: string) =>
    page
      .getByRole('group', { name: 'Filter by' })
      .getByRole('button', { name: new RegExp(`^${name}`) });

  test('a facet button discloses its panel; choosing keeps it open and adds one chip per facet', async ({
    page,
    scene,
  }) => {
    await open(scene, 'page=2');
    const consortium = facetButton(page, 'Consortium');
    await expect(consortium).toHaveAttribute('aria-expanded', 'false');
    await consortium.click();
    await expect(consortium).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByRole('listbox', { name: 'Consortium' });
    await expect(list).toBeFocused();
    const bionet = list.getByRole('option', { name: /^BioNet/ });
    const count = Number(/\((\d+)\)/.exec(await bionet.innerText())?.[1]);
    await bionet.click();
    await expect(bionet).toHaveAttribute('aria-selected', 'true');
    await expect(live(page)).toHaveText(`${count} services match`);
    // The panel stays open while picking: OR within the facet is several clicks.
    await list.getByRole('option', { name: /^PlantData/ }).click();
    await expect(list).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Remove Consortium: BioNet, PlantData' }),
    ).toBeVisible();
    await expect(consortium).toHaveAccessibleName('Consortium 2 chosen');
    const search = await address(page);
    expect(search.getAll('f.consortium')).toEqual(['bionet', 'plantdata']);
    expect(search.get('page')).toBeNull();
    // Escape closes the popover and gives the focus back to its button.
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(consortium).toBeFocused();
    await expect(consortium).toHaveAttribute('aria-expanded', 'false');
  });

  test('a removed chip is announced; the focus goes to the next chip, then to the search box', async ({
    page,
    scene,
  }) => {
    await open(scene, 'f.consortium=bionet&f.stage=PROD');
    const first = page.getByRole('button', { name: 'Remove Consortium: BioNet' });
    await first.click();
    await expect(live(page)).toHaveText(/^Consortium: BioNet removed\. \d+ services? match/);
    await expect(page.getByRole('button', { name: 'Remove Stage: Production' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('searchbox', { name: 'Search services' })).toBeFocused();
    expect([...(await address(page)).keys()].filter((key) => key.startsWith('f.'))).toEqual([]);
  });

  test('"Clear all" clears the text and the facets and puts the focus in the search box', async ({
    page,
    scene,
  }) => {
    await open(scene, 'f.consortium=bionet&q=service');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByTestId('state')).toHaveText('{"q":"","state":{}}');
    await expect(page.getByRole('searchbox', { name: 'Search services' })).toBeFocused();
    await expect(page.getByRole('searchbox', { name: 'Search services' })).toHaveValue('');
  });

  test('a facet with 300 values takes no more room: a filter field, 50 values and "type to narrow"', async ({
    page,
    scene,
  }) => {
    await open(scene, 'set=300');
    await facetButton(page, 'Provider').click();
    const field = page.getByRole('combobox', { name: 'Filter Provider' });
    await expect(field).toBeFocused();
    const list = page.getByRole('listbox', { name: 'Provider' });
    await expect(list.getByRole('option')).toHaveCount(50);
    await expect(page.getByText(/^\d+ more, type to narrow/)).toBeVisible();
    // The list scrolls inside its panel; the page does not grow.
    const box = await list.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(18 * 16 + 1);
    await field.fill('GATERSLEBEN');
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(page.getByText(/\b1 of 300 match/)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(list.getByRole('option', { name: /^IPK Gatersleben/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('button', { name: 'Remove Provider: IPK Gatersleben' }),
    ).toBeVisible();
  });

  test('a range is applied with Enter, and from > to is refused with a message, not a request', async ({
    page,
    scene,
  }) => {
    await open(scene, 'set=range');
    await facetButton(page, 'Year').click();
    const from = page.getByRole('spinbutton', { name: 'From' });
    await expect(from).toBeFocused();
    await from.fill('2022');
    await page.getByRole('spinbutton', { name: 'To' }).fill('2018');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('“From” must not be greater than “To”.');
    await expect(page.getByTestId('changes')).toHaveText('0');
    await from.fill('2018');
    await page.getByRole('spinbutton', { name: 'To' }).fill('2022');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove Year: 2018–2022' })).toBeVisible();
    const search = await address(page);
    expect([search.get('f.year.min'), search.get('f.year.max')]).toEqual(['2018', '2022']);
    await expect(live(page)).toHaveText(/^\d+ services match$/);
  });

  test('speaks German when the page does', async ({ page, scene }) => {
    await open(scene, 'f.consortium=bionet', 'de');
    await expect(page.getByRole('group', { name: 'Filtern nach' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Consortium: BioNet entfernen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alles zurücksetzen' })).toBeVisible();
  });

  test('[component:FacetSearch] keyboard (bar): Tab to a facet, Enter opens, arrows and Space choose, Escape returns', async ({
    page,
    scene,
  }) => {
    await open(scene);
    await page.getByRole('searchbox', { name: 'Search services' }).focus();
    await page.keyboard.press('Tab');
    const consortium = facetButton(page, 'Consortium');
    await expect(consortium).toBeFocused();
    await page.keyboard.press('Enter');
    const list = page.getByRole('listbox', { name: 'Consortium' });
    await expect(list).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(list).toHaveAttribute('aria-activedescendant', /-1$/);
    await page.keyboard.press('Space');
    await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(live(page)).toHaveText(/services? match/);
    await page.keyboard.press('Escape');
    await expect(consortium).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(facetButton(page, 'Stage')).toBeFocused();
  });

  const openPanel = (name: string) => async (page: Page) => {
    await facetButton(page, name).click();
    await expect(
      page.locator('[role="listbox"], [role="group"][id$="-list"]').last(),
    ).toBeVisible();
  };
  inBothThemes('[component:FacetSearch] axe (bar): closed', 'facet-search', undefined, 'look=bar');
  inBothThemes(
    '[component:FacetSearch] axe (bar): value panel with a choice',
    'facet-search',
    openPanel('Consortium'),
    'look=bar&f.consortium=bionet',
  );
  inBothThemes(
    '[component:FacetSearch] axe (bar): 300 values',
    'facet-search',
    openPanel('Provider'),
    'look=bar&set=300',
  );
  inBothThemes(
    '[component:FacetSearch] axe (bar): range panel',
    'facet-search',
    openPanel('Year'),
    'look=bar&set=range&f.year.min=2015',
  );
  inBothThemes(
    '[component:FacetSearch] axe (bar): chips at 360 px',
    'facet-search',
    async (page) => {
      await page.setViewportSize({ width: 360, height: 740 });
    },
    'look=bar&set=6&f.consortium=bionet&f.consortium=plantdata&f.stage=PROD&f.provider=ipk&f.provider=fzj&f.license=MIT&f.topic=genomics',
  );
});
