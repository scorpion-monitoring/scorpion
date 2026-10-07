import { expect, inBothThemes, test } from './support.ts';

// Facets (harness/scenes/facets.svelte): checkbox and range filters whose selection lives in the address.

test.describe('Facets', () => {
  test('writes the selection into the address, keeps the rest of it, and clears', async ({
    page,
    scene,
  }) => {
    await scene('facets', { query: 'q=abc&page=3' });
    const filters = page.getByRole('region', { name: 'Filters' });
    await expect(filters.getByRole('checkbox', { name: 'Active (12)' })).toBeVisible();
    await filters.getByRole('checkbox', { name: 'Active (12)' }).check();
    await filters.getByRole('checkbox', { name: 'Pending (3)' }).check();
    await filters.getByLabel('From').fill('2010');
    await filters.getByLabel('From').blur(); // a range applies when the box is left
    await expect(page.getByTestId('state')).toHaveText(
      '{"status":["active","pending"],"year":{"min":2010}}',
    );
    const search = new URLSearchParams(await page.getByTestId('search').innerText());
    expect(search.get('q')).toBe('abc');
    expect(search.get('page')).toBeNull(); // a filter changes the number of pages
    expect(search.getAll('f.status')).toEqual(['active', 'pending']);
    expect(search.get('f.year.min')).toBe('2010');

    await filters.getByRole('button', { name: 'Clear Status' }).click();
    await expect(page.getByTestId('state')).toHaveText('{"year":{"min":2010}}');
    await filters.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page.getByTestId('state')).toHaveText('{}');
    expect(new URLSearchParams(await page.getByTestId('search').innerText()).get('scene')).toBe(
      'facets',
    );
  });

  test('starts from the address, and a shared address gives the same filters', async ({
    page,
    scene,
  }) => {
    await scene('facets', {
      query: 'f.status=closed&f.year.min=1990&f.year.max=2020&f.status=<bad>',
    });
    await expect(page.getByTestId('state')).toHaveText(
      '{"status":["closed"],"year":{"min":2000,"max":2020}}',
    );
    const filters = page.getByRole('region', { name: 'Filters' });
    await expect(filters.getByRole('checkbox', { name: 'Closed' })).toBeChecked();
    await expect(filters.getByLabel('From')).toHaveValue('2000');
    await expect(filters.getByLabel('To')).toHaveValue('2020');
  });

  test('speaks German when the page does', async ({ page, scene }) => {
    await scene('facets', { lang: 'de' });
    await expect(page.getByRole('region', { name: 'Filter' })).toBeVisible();
    await expect(page.getByLabel('Von')).toBeVisible();
  });

  test('[component:Facets] keyboard: Space checks an option, Enter in a range applies it, and the clear buttons are reached with Tab', async ({
    page,
    scene,
  }) => {
    await scene('facets');
    const filters = page.getByRole('region', { name: 'Filters' });
    await filters.getByRole('checkbox', { name: 'Active (12)' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('state')).toHaveText('{"status":["active"]}');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(filters.getByRole('checkbox', { name: 'Closed' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(filters.getByRole('button', { name: 'Clear Status' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('state')).toHaveText('{}');
    await filters.getByLabel('To').focus();
    await page.keyboard.type('2022');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('state')).toHaveText('{"year":{"max":2022}}');
  });

  inBothThemes('[component:Facets] axe: no selection', 'facets');
  inBothThemes(
    '[component:Facets] axe: with a selection',
    'facets',
    undefined,
    'f.status=active&f.year.min=2005',
  );
});
