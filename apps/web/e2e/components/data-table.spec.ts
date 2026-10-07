import type { Page } from '@playwright/test';
import { expect, inBothThemes, test } from './support.ts';

// DataTable (harness/scenes/data-table.svelte): a table of the API's list envelope with a sort and pages
// the "server" (the scene) does, states for loading, failing and being empty, and a short list that sorts
// itself.

const server = (page: Page) => page.getByRole('table', { name: 'People' });
const names = (page: Page) => server(page).getByRole('rowheader').allInnerTexts();

test.describe('DataTable', () => {
  test('is a table with a caption, scoped headings and the sort on the column it is sorted by', async ({
    page,
    scene,
  }) => {
    await scene('data-table');
    const table = server(page);
    await expect(table.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(table.getByRole('columnheader', { name: /Group/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    await expect(table.getByRole('columnheader', { name: 'Actions' })).toBeAttached();
    expect(await names(page)).toEqual(
      Array.from({ length: 10 }, (_, n) => `Person ${String(n + 1).padStart(2, '0')}`),
    );
  });

  test('sorts by a column, turns it round on a second click, and keeps rows with the same value in a fixed order', async ({
    page,
    scene,
  }) => {
    await scene('data-table');
    const table = server(page);
    await table.getByRole('button', { name: /Group/ }).click();
    await expect(table.getByRole('columnheader', { name: /Group/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(table.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    const groups = await table
      .getByRole('row')
      .evaluateAll((rows) =>
        rows.slice(1).map((row) => row.querySelectorAll('td')[0]!.textContent),
      );
    expect(groups.every((group) => group === 'blue')).toBe(true);
    // "blue" rows are n = 2, 5, 8, ...: by id they come p02, p05, ... so the names fall: 43, 40, 37, ...
    expect(await names(page)).toEqual([
      'Person 43',
      'Person 40',
      'Person 37',
      'Person 34',
      'Person 31',
      'Person 28',
      'Person 25',
      'Person 22',
      'Person 19',
      'Person 16',
    ]);
    await table.getByRole('button', { name: /Group/ }).click();
    await expect(table.getByRole('columnheader', { name: /Group/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    const first = await table.getByRole('row').nth(1).locator('td').first().innerText();
    expect(first).toBe('red');
  });

  test('pages, changes the page size, and goes back to the first page when the sort or the size changes', async ({
    page,
    scene,
  }) => {
    await scene('data-table');
    const pages = page.getByRole('navigation', { name: 'Pages' });
    await expect(pages.getByRole('status')).toHaveText('1–10 of 45');
    await pages.getByRole('button', { name: 'Next' }).click();
    await expect(pages.getByRole('status')).toHaveText('11–20 of 45');
    expect((await names(page))[0]).toBe('Person 11');
    await server(page).getByRole('button', { name: /Age/ }).click();
    await expect(pages.getByRole('status')).toHaveText('1–10 of 45');
    await pages.getByRole('button', { name: 'Page 3' }).click();
    await pages.getByRole('combobox', { name: 'Rows per page' }).selectOption('20');
    await expect(pages.getByRole('status')).toHaveText('1–20 of 45');
    await expect(server(page).getByRole('row')).toHaveCount(21);
  });

  test('has a button per row in the actions column, named by the row', async ({ page, scene }) => {
    await scene('data-table');
    await server(page).getByRole('button', { name: 'Remove Person 03' }).click();
    await expect(page.getByTestId('removed')).toHaveText('p42');
  });

  test('says that it is loading, that it failed (with a way to try again), or that it is empty', async ({
    page,
    scene,
  }) => {
    await scene('data-table', { query: 'state=loading' });
    await expect(server(page)).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toBeVisible();
    await scene('data-table', { query: 'state=error' });
    await expect(page.getByRole('alert')).toContainText('The list could not be loaded.');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await scene('data-table', { query: 'state=empty' });
    await expect(server(page).getByRole('cell', { name: 'Nobody here.' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('status')).toHaveText(
      '0–0 of 0',
    );
  });

  test('sorts a short list by itself, with the empty value last', async ({ page, scene }) => {
    await scene('data-table');
    const small = page.getByRole('table', { name: 'A short list' });
    await small.getByRole('button', { name: /Age/ }).click();
    expect(await small.getByRole('rowheader').allInnerTexts()).toEqual([
      'Person 44',
      'Person 43',
      'Person 42',
      'Person 41',
      'Person 45',
    ]);
    await small.getByRole('button', { name: /Age/ }).click();
    expect(await small.getByRole('rowheader').allInnerTexts()).toEqual([
      'Person 41',
      'Person 42',
      'Person 43',
      'Person 44',
      'Person 45',
    ]);
  });

  test('[component:DataTable] keyboard: a header sorts with Enter, Up and Down move between rows, and the pages are reached with Tab', async ({
    page,
    scene,
  }) => {
    await scene('data-table');
    const table = server(page);
    await table.getByRole('button', { name: /Group/ }).focus();
    await page.keyboard.press('Enter');
    await expect(table.getByRole('columnheader', { name: /Group/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(table.getByRole('button', { name: /Group/ })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(table.getByRole('columnheader', { name: /Group/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    const rows = table.getByRole('row');
    await rows
      .nth(1)
      .getByRole('button', { name: /^Remove/ })
      .focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(2).getByRole('button', { name: /^Remove/ })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(rows.nth(1).getByRole('button', { name: /^Remove/ })).toBeFocused();
    // From the first control of a row Down goes to the first control of the next.
    await rows.nth(1).getByRole('button', { name: /^Open/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(2).getByRole('button', { name: /^Open/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(rows.nth(2).getByRole('button', { name: /^Remove/ })).toBeFocused();

    await rows
      .nth(10)
      .getByRole('button', { name: /^Remove/ })
      .focus();
    await page.keyboard.press('ArrowDown'); // the last row: nothing below, focus stays
    await expect(rows.nth(10).getByRole('button', { name: /^Remove/ })).toBeFocused();
    const pages = page.getByRole('navigation', { name: 'Pages' });
    await pages.getByRole('button', { name: 'Next' }).focus();
    await page.keyboard.press('Enter');
    await expect(pages.getByRole('status')).toHaveText('11–20 of 45');
  });

  inBothThemes('[component:DataTable] axe: the table', 'data-table');
  inBothThemes('[component:DataTable] axe: loading', 'data-table', undefined, 'state=loading');
  inBothThemes('[component:DataTable] axe: failed', 'data-table', undefined, 'state=error');
  inBothThemes('[component:DataTable] axe: empty', 'data-table', undefined, 'state=empty');
});
