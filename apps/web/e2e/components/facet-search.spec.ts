import { expect, inBothThemes, test } from './support.ts';
import type { Page } from '@playwright/test';

// FacetSearch (harness/scenes/facet-search.svelte, sprint 3 of M12a): the shared state behind the three looks.
// The scene counts like the catalogue's API. These tests hold for every look; the look's own keyboard path,
// ARIA snapshots and axe states are in the describe blocks per look.

const live = (page: Page) => page.locator('[data-facet-status]');
/**
 * The address as the browser has it. Read from `window.location`, not from the scene's copy (which the scene writes a
 * tick after a change): the harness's `goto` writes the location in the same task as the change, so once an action
 * has been handled the location is current.
 */
const address = async (page: Page) =>
  new URLSearchParams(await page.evaluate(() => window.location.search));
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

test.describe('FacetSearch, look combined', () => {
  const open = (scene: (n: string, o?: object) => Promise<void>, query = '', lang?: 'de') =>
    scene('facet-search', { query: `look=combined${query ? `&${query}` : ''}`, lang });
  const box = (page: Page) => page.getByRole('combobox', { name: 'Search services' });

  test('[component:FacetSearch] keyboard (combined): the whole path of the spec, step by step', async ({
    page,
    scene,
  }) => {
    await open(scene);
    const combobox = box(page);

    // Tab into the box: the facet list opens, no option is active (a reader says the combobox first).
    await page.keyboard.press('Tab');
    await expect(combobox).toBeFocused();
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    await expect(combobox).not.toHaveAttribute('aria-activedescendant');
    await expect(page.getByRole('listbox', { name: 'Filter by' })).toMatchAriaSnapshot(`
      - listbox "Filter by":
        - option "Consortium" [selected=false]
        - option "Stage" [selected=false]
    `);

    // ↓ and ↑ move.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    const first = page.getByRole('option', { name: 'Consortium' });
    await expect(combobox).toHaveAttribute(
      'aria-activedescendant',
      (await first.getAttribute('id'))!,
    );
    await expect(first).toHaveAttribute('aria-selected', 'true');

    // Enter opens the facet: its values, the first one active, the focus still in the box.
    await page.keyboard.press('Enter');
    const values = page.getByRole('listbox', { name: 'Consortium' });
    await expect(values).toHaveAttribute('aria-multiselectable', 'true');
    await expect(values.getByRole('option')).toHaveCount(3);
    await expect(combobox).toBeFocused();
    await expect(combobox).toHaveAttribute(
      'aria-activedescendant',
      (await values.getByRole('option').first().getAttribute('id'))!,
    );

    // Typing narrows the values; an arrow, then Space chooses; the list stays open and the count is announced.
    await page.keyboard.type('plant');
    await expect(values.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    const plant = values.getByRole('option', { name: /^PlantData/ });
    await expect(plant).toHaveAttribute('aria-selected', 'true');
    await expect(values).toBeVisible();
    await expect(live(page)).toHaveText(/^\d+ services match$/);
    await expect(page.getByRole('button', { name: 'Remove Consortium: PlantData' })).toBeVisible();
    expect((await address(page)).getAll('f.consortium')).toEqual(['plantdata']);
    await expect(combobox).toBeFocused();

    // Escape goes back one level, the filter text goes; Escape on the facet list closes it, the focus stays.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Filter by' })).toBeVisible();
    await expect(combobox).toHaveValue('');
    const left = page.getByRole('option', { name: 'Consortium, 1 chosen' });
    await expect(left).toBeVisible();
    // The facet just left is the active option: a reader says where the person is.
    await expect(combobox).toHaveAttribute(
      'aria-activedescendant',
      (await left.getAttribute('id'))!,
    );
    await page.keyboard.press('Escape');
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
    await expect(combobox).toBeFocused();

    // Backspace in the empty box removes the last chip, and says so.
    await page.keyboard.press('Backspace');
    await expect(page.getByRole('button', { name: /^Remove Consortium/ })).toHaveCount(0);
    await expect(live(page)).toHaveText('Consortium: PlantData removed. 24 services match');
    await expect(combobox).toBeFocused();

    // Tab leaves for the list; the dropdown is closed.
    await page.keyboard.press('Tab');
    await expect(combobox).not.toBeFocused();
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  });

  test('typed text searches the names and offers matching facet values; Enter adds one as a chip', async ({
    page,
    scene,
  }) => {
    await open(scene, 'set=zero');
    await box(page).click();
    await page.keyboard.type('gaters');
    // The matching values come first, in a group of their own, above the facets ("Filter by"), in one listbox.
    const offers = page
      .getByRole('listbox', { name: 'Filter by' })
      .getByRole('group', { name: 'Matching values' });
    await expect(
      page.getByRole('listbox', { name: 'Filter by' }).getByRole('group', { name: 'Filter by' }),
    ).toBeVisible();
    await expect(
      offers.getByRole('option', { name: /^Provider: IPK Gatersleben \(\d+\)$/ }),
    ).toBeVisible();
    // The name search went out: no service is called that.
    await expect(page.getByText('No services match the name', { exact: true })).toBeVisible();
    expect((await address(page)).get('q')).toBe('gaters');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Remove Provider: IPK Gatersleben' }),
    ).toBeVisible();
    await expect(box(page)).toHaveValue('');
    const search = await address(page);
    expect(search.get('q')).toBeNull();
    expect(search.getAll('f.provider')).toEqual(['ipk']);
    await expect(live(page)).toHaveText(/^\d+ services match$/);
  });

  test('facet:value narrows to that facet by id or label, quoted, and is no name search; an unknown facet is text', async ({
    page,
    scene,
  }) => {
    await open(scene, 'set=zero');
    await box(page).click();
    await page.keyboard.type('provider:"IPK Gat');
    const panel = page.getByRole('listbox', { name: 'Provider' });
    await expect(panel.getByRole('option')).toHaveCount(1);
    await expect(panel.getByRole('option', { name: /^IPK Gatersleben/ })).toBeVisible();
    await page.waitForTimeout(400); // past the search's rest
    await expect(page.getByTestId('changes')).toHaveText('0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    expect((await address(page)).getAll('f.provider')).toEqual(['ipk']);
    expect((await address(page)).get('q')).toBeNull();

    await box(page).fill('');
    await page.keyboard.press('Escape');
    await box(page).fill('owner:x');
    await expect.poll(async () => (await address(page)).get('q')).toBe('owner:x');
  });

  test('with a name typed, a facet still opens from the list and its value adds to the search', async ({
    page,
    scene,
  }) => {
    await open(scene);
    await box(page).click();
    await page.keyboard.type('service');
    await expect.poll(async () => (await address(page)).get('q')).toBe('service');
    // Nothing to offer for "service": the list waits to be asked for.
    await page.keyboard.press('ArrowDown');
    const stage = page
      .getByRole('listbox', { name: 'Filter by' })
      .getByRole('option', { name: 'Stage' });
    await stage.click();
    await page
      .getByRole('listbox', { name: 'Stage' })
      .getByRole('option', { name: /^Production/ })
      .click();
    const search = await address(page);
    expect(search.get('q')).toBe('service');
    expect(search.getAll('f.stage')).toEqual(['PROD']);
  });

  test('leaving a facet:value text puts back the search it stood in for, and sends nothing', async ({
    page,
    scene,
  }) => {
    await open(scene, 'q=service');
    await box(page).click();
    await box(page).fill('stage:prod');
    await expect(page.getByRole('listbox', { name: 'Stage' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box(page)).toHaveValue('service');
    await expect(page.getByTestId('changes')).toHaveText('0');
  });

  test('the list is drawn above the count line and the results, never over them', async ({
    page,
    scene,
  }) => {
    await open(scene, 'set=zero');
    await box(page).click();
    await page.keyboard.type('gat');
    const list = page.getByRole('listbox', { name: 'Filter by' });
    await expect(list).toBeVisible();
    const bottom = (await list.boundingBox())!;
    const count = (await page.locator('[data-facet-count]').boundingBox())!;
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(count.y);
  });

  test('typing a name that offers no value shows no list, so the found rows are in view; ↓ opens it', async ({
    page,
    scene,
  }) => {
    await open(scene);
    await box(page).click();
    await page.keyboard.type('galaxy');
    await expect(page.getByTestId('rows').getByRole('listitem')).toHaveText(['Service D Galaxy']);
    await expect(box(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox', { name: 'Filter by' })).toBeVisible();
  });

  test('the shortcut takes the facet’s label in the page’s language', async ({ page, scene }) => {
    await open(scene, 'set=zero', 'de');
    await box(page).click();
    await page.keyboard.type('Consortium:bio');
    await expect(page.getByRole('listbox', { name: 'Consortium' }).getByRole('option')).toHaveCount(
      1,
    );
    await expect(page.getByText(/^\d+ Dienste passen$/)).toBeVisible();
  });

  test('a chip opens its facet, its × removes the facet, ✕ clears everything; the focus stays in the box', async ({
    page,
    scene,
  }) => {
    await open(scene, 'f.consortium=bionet&f.stage=PROD&q=service');
    await page.getByRole('button', { name: 'Edit Consortium: BioNet' }).click();
    await expect(page.getByRole('listbox', { name: 'Consortium' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Stage: Production' }).click();
    await expect(box(page)).toBeFocused();
    await expect(live(page)).toHaveText(/^Stage: Production removed\. \d+ services? match/);
    await page.getByRole('button', { name: 'Clear the search and the filters' }).click();
    await expect(page.getByTestId('state')).toHaveText('{"q":"","state":{}}');
    await expect(box(page)).toBeFocused();
  });

  test('Tab into the box reaches the input; the chips are reached with Shift+Tab and lead back with Tab', async ({
    page,
    scene,
  }) => {
    await open(scene, 'f.consortium=bionet&f.stage=PROD');
    await page.keyboard.press('Tab');
    await expect(box(page)).toBeFocused();
    await expect(box(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Remove Stage: Production' })).toBeFocused();
    await expect(box(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Edit Stage: Production' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox', { name: 'Stage' })).toBeVisible();
    await expect(box(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(box(page)).toBeFocused();
  });

  test('at 360 px the chips take two lines at most and fold the rest into +N, which unfolds them', async ({
    page,
    scene,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(
      scene,
      'set=6&f.consortium=bionet&f.stage=PROD&f.provider=ipk&f.license=MIT&f.topic=genomics',
    );
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(1);
    const more = page.getByRole('button', { name: '4 more filters' });
    await expect(more).toHaveText('+4');
    // Two lines at most: the chips, `+N` and the input start on no more than two distinct rows.
    const tops = new Set<number>();
    for (const part of [page.getByRole('button', { name: /^Edit / }), more, box(page)]) {
      for (const one of await part.all()) tops.add(Math.round((await one.boundingBox())!.y / 8));
    }
    expect(tops.size).toBeLessThanOrEqual(2);
    // The count line is in view below the box.
    await expect(page.getByText(/services? match/).first()).toBeInViewport();
    await more.click();
    await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(5);
  });

  test('a range facet takes the focus into its fields; Enter applies, Escape gives the focus back', async ({
    page,
    scene,
  }) => {
    await open(scene, 'set=range');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const from = page.getByRole('spinbutton', { name: 'From' });
    await expect(from).toBeFocused();
    await page.keyboard.type('2018');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove Year: ≥ 2018' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box(page)).toBeFocused();
    await expect(page.getByRole('listbox', { name: 'Filter by' })).toBeVisible();
  });

  test('300 values: the first 50 and "type to narrow"', async ({ page, scene }) => {
    await open(scene, 'set=300');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const list = page.getByRole('listbox', { name: 'Provider' });
    await expect(list.getByRole('option')).toHaveCount(50);
    await expect(page.getByText(/250 more, type to narrow/)).toBeVisible();
    await page.keyboard.type('gaters');
    await expect(list.getByRole('option')).toHaveCount(1);
  });

  test('the public page’s shortcuts open the list at a facet', async ({ page, scene }) => {
    await open(scene, 'shortcuts');
    await page
      .getByRole('group', { name: 'Filter by' })
      .getByRole('button', { name: /^Stage/ })
      .click();
    await expect(page.getByRole('listbox', { name: 'Stage' })).toBeVisible();
    await expect(box(page)).toBeFocused();
  });

  const prepare =
    (...keys: string[]) =>
    async (page: Page) => {
      await page.keyboard.press('Tab');
      for (const key of keys) {
        if (key.length > 1) await page.keyboard.press(key);
        else await page.keyboard.type(key);
      }
    };
  inBothThemes(
    '[component:FacetSearch] axe (combined): closed with chips',
    'facet-search',
    undefined,
    'look=combined&f.consortium=bionet&f.stage=PROD',
  );
  inBothThemes(
    '[component:FacetSearch] axe (combined): the facet list',
    'facet-search',
    prepare('ArrowDown'),
    'look=combined',
  );
  inBothThemes(
    '[component:FacetSearch] axe (combined): a value panel',
    'facet-search',
    prepare('ArrowDown', 'Enter'),
    'look=combined&f.consortium=bionet',
  );
  inBothThemes(
    '[component:FacetSearch] axe (combined): the range panel',
    'facet-search',
    prepare('ArrowDown', 'ArrowDown', 'Enter'),
    'look=combined&set=range',
  );
  inBothThemes(
    '[component:FacetSearch] axe (combined): offered values',
    'facet-search',
    prepare('g', 'a', 't'),
    'look=combined&set=zero',
  );
  inBothThemes(
    '[component:FacetSearch] axe (combined): folded chips at 360 px',
    'facet-search',
    async (page) => {
      await page.setViewportSize({ width: 360, height: 740 });
    },
    'look=combined&set=6&f.consortium=bionet&f.stage=PROD&f.provider=ipk&f.license=MIT&f.topic=genomics',
  );
});
