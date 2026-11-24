import { readFile } from 'node:fs/promises';
import { violations } from './support/a11y.ts';
import { activeUser, apiAs, newPerson } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { pageAs } from './support/members.ts';
import {
  W,
  configure,
  fab,
  filter,
  saved,
  store,
  storedTiles,
  tile,
  tileOf,
  world,
  type Tile,
} from './support/dashboard.ts';

// M13c: a person exports their dashboard to a file and another person imports it and sees the same dashboard; the
// settings of a KPI widget open without edit mode. Every test makes its own data and runs under both base paths.

test.describe('journey: a dashboard is shared as a file', () => {
  test('one person exports, another imports and gets the same tiles; a broken file is named and changes nothing', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    const items: Tile[] = [
      tile('trnda', W.trends, { x: 0, y: 0, w: 8, h: 5 }, filter(w.a.id, '1y')),
      tile('crdsb', W.cards, { x: 8, y: 0, w: 4, h: 5 }, filter(w.b.id, '3m')),
    ];
    await store(me, items);

    // The export: the file the browser writes.
    const mine = await pageAs(browser, baseURL, at, w.person);
    await mine.page.goto(at('/'));
    await expect(tileOf(mine.page, 'Trends').getByRole('img').first()).toBeVisible();
    await fab(mine.page).click();
    const downloading = mine.page.waitForEvent('download');
    await mine.page.getByRole('button', { name: 'Export dashboard' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^dashboard-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await readFile(await download.path(), 'utf8');
    const file = JSON.parse(text) as { format: string; version: number; items: Tile[] };
    expect(file.format).toBe('scorpion.dashboard');
    expect(file.version).toBe(1);
    expect(file.items.map((item) => [item.id, item.widget, item.config.service])).toEqual([
      ['trnda', W.trends, w.a.id],
      ['crdsb', W.cards, w.b.id],
    ]);
    // Nothing personal in the file.
    expect(text).not.toContain(w.person.username);
    await mine.close();

    // The import, by another person.
    const other = newPerson('share');
    await activeUser(w.api, at, other);
    const them = await apiAs(playwright, baseURL, at, other);
    const opened = await pageAs(browser, baseURL, at, other);
    const page = opened.page;
    await page.goto(at('/'));

    // A file that is no dashboard is named, and nothing is sent.
    await fab(page).click();
    let choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import dashboard' }).click();
    await (
      await choosing
    ).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('nope') });
    await expect(page.getByRole('alert').filter({ hasText: 'could not be read' })).toBeVisible();

    await fab(page).click();
    choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import dashboard' }).click();
    await (
      await choosing
    ).setFiles({ name: 'dashboard.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    const dialog = page.getByRole('dialog', { name: 'Import a dashboard' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('(2 widgets)');
    expect(await violations(page), 'the import dialog').toEqual([]);
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await expect(dialog).toBeHidden();
    await expect(tileOf(page, 'Trends').getByRole('img').first()).toBeVisible();
    await expect(tileOf(page, 'KPI cards')).toContainText(w.b.name);

    // The same tiles as the exporter's (the trends chart with its series options, as the server stored them).
    const view = await them.get<{ items: Tile[] }>('/ui/dashboard');
    expect(view.items).toEqual(file.items);
    expect(view.items.map((item) => item.id)).toEqual(items.map((item) => item.id));
    await opened.close();
    await me.dispose();
    await them.dispose();
    await w.api.dispose();
  });
});

test.describe('journey: the settings of a KPI widget open without edit mode', () => {
  test('the gear in the heading changes the service, saves, gives focus back, and is the only gear in edit mode', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    await store(me, [tile('trnda', W.trends, { x: 0, y: 0, w: 8, h: 5 }, filter(w.a.id))]);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    await page.goto(at('/'));
    await expect(tileOf(page, 'Trends')).toContainText(w.a.name);
    expect(await violations(page), 'the gear in view mode').toEqual([]);

    // No "Customise dashboard" first.
    await configure(page, 'Trends', { service: w.b });
    await expect(saved(page)).toBeVisible({ timeout: 10_000 });
    await expect(tileOf(page, 'Trends')).toContainText(w.b.name);
    await expect(
      page.getByRole('button', { name: 'Settings of Trends', exact: true }),
    ).toBeFocused();
    expect((await storedTiles(me, W.trends))[0]!.config.service).toBe(w.b.id);

    // In edit mode the tile's edit bar has the gear; the heading's is gone, so there is one.
    await fab(page).click();
    await expect(page.getByRole('button', { name: 'Settings of Trends', exact: true })).toHaveCount(
      1,
    );
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});
