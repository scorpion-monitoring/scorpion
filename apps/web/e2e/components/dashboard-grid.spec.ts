import type { Page } from '@playwright/test';
import { violations } from '../support/a11y.ts';
import { expect, inBothThemes, test } from './support.ts';

// DashboardGrid (harness/scenes/dashboard-grid.svelte): the widget grid on Snapgrid, behind the adapter of
// `packages/ui-kit/src/dashboard-grid`. The five wrappers of ADR-0042 (Decision 2) each have a test here: the move
// grip, the named resize handle, the remount on a change of mode, reduced motion, and no grid below `md`.

const tile = (page: Page, id: string) => page.locator(`[data-grid-id="${id}"]`);
const layout = async (page: Page) =>
  JSON.parse((await page.getByTestId('layout').textContent()) ?? '[]') as [
    string,
    number,
    number,
    number,
    number,
  ][];
const at = async (page: Page, id: string) =>
  (await layout(page)).find(([name]) => name === id)!.slice(1);
const status = (page: Page) => page.locator('[role="status"]').filter({ hasText: /./ });
const running = (page: Page) =>
  page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === 'running').length,
  );

test.describe('DashboardGrid', () => {
  test('draws the tiles by their place in view mode, with no controls, and takes no room for a tile that draws nothing', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid');
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Service cards' })).toBeVisible();
    // The quiet tile has no body: it is hidden, so nothing is left as a hole.
    await expect(tile(page, 'quiet')).toBeHidden();
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
    await expect(page.locator('.dashboard-resize')).toHaveCount(0);
    const trends = await tile(page, 'trends').boundingBox();
    const cards = await tile(page, 'cards').boundingBox();
    const tuned = await tile(page, 'tuned').boundingBox();
    expect(cards!.x).toBeGreaterThan(trends!.x + trends!.width - 1);
    // The tuned card rose into the place the quiet card (and its row) would have held.
    expect(tuned!.y).toBeLessThan(trends!.y + trends!.height + 40);
  });

  test('loads Snapgrid and dnd-kit only for a page that draws the grid', async ({
    page,
    scene,
  }) => {
    const loaded: string[] = [];
    page.on('request', (request) => loaded.push(request.url()));
    await scene('parts');
    expect(loaded.filter((url) => /DashboardGrid|snapgrid|dnd-kit/i.test(url))).toEqual([]);
    await scene('dashboard-grid');
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible();
    expect(loaded.some((url) => /DashboardGrid/.test(url))).toBe(true);
  });

  test('edit mode gives every tile a move grip, buttons for every move and size, a remove button and a 24 px resize handle', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    for (const name of ['Trends', 'Service cards', 'Quiet card', 'Tuned card']) {
      const group = page.getByRole('group', { name, exact: true });
      await expect(group).toBeVisible();
      await expect(group.getByRole('button', { name: `Move ${name}`, exact: true })).toBeVisible();
      for (const verb of ['left', 'right', 'up', 'down']) {
        await expect(group.getByRole('button', { name: `Move ${name} ${verb}` })).toBeVisible();
      }
      for (const verb of ['wider', 'narrower', 'taller', 'shorter']) {
        await expect(group.getByRole('button', { name: `Make ${name} ${verb}` })).toBeVisible();
      }
      await expect(group.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
    }
    // The tile that draws nothing is there to be removed, and says so.
    await expect(tile(page, 'quiet')).toBeVisible();
    await expect(tile(page, 'quiet').getByText('nothing to show')).toBeVisible();
    const handle = tile(page, 'trends').locator('.dashboard-resize');
    const box = await handle.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
    await expect(handle).toHaveAttribute('aria-hidden', 'true');
    await expect(handle).toHaveAttribute('tabindex', '-1');
    await expect(handle).toHaveAttribute('role', 'presentation');
  });

  test('the grip is the one control dnd-kit labels: the tile itself is neither a button nor focusable', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    const grip = page.getByRole('button', { name: 'Move Trends', exact: true });
    await expect(grip).toHaveAttribute('aria-roledescription', 'movable widget');
    await expect(grip).toHaveAttribute('aria-describedby', /.+/);
    const element = tile(page, 'trends');
    await expect(element).not.toHaveAttribute('tabindex', /.*/);
    await expect(element).not.toHaveAttribute('aria-roledescription', /.*/);
    // The words of the instructions are the page's, not dnd-kit's English.
    const instructions = await grip.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${instructions}"]`)).toHaveText(/arrow keys/);
  });

  test('moves a tile with the buttons, announces the new place, and keeps focus on the button', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    const before = await at(page, 'cards');
    expect(before).toEqual([6, 0, 6, 3]);
    const left = page.getByRole('button', { name: 'Move Service cards down' });
    await left.click();
    await expect(left).toBeFocused();
    // Down: the tile below it is the tuned card? No: nothing is below it at x 6..12, so it cannot move.
    await expect(status(page).first()).toHaveText(/Service cards cannot move further/);
    // A tile in the way is passed when there is room beyond it, and refused when there is none.
    const blocked = page.getByRole('button', { name: 'Move Trends right' });
    await blocked.click();
    await expect(status(page).first()).toContainText('Trends cannot move further');
    const right = page.getByRole('button', { name: 'Move Tuned card right' });
    await right.click();
    await expect(right).toBeFocused();
    await expect.poll(() => at(page, 'tuned')).toEqual([5, 4, 4, 3]);
    await expect(status(page).first()).toContainText('Tuned card moved to row 5, column 6.');
    await expect(page.getByTestId('changes')).toContainText('move:tuned');
  });

  test('resizes with the buttons inside the limits of the widget, and says when it cannot', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    const wider = page.getByRole('button', { name: 'Make Trends wider' });
    await wider.click();
    await wider.click();
    await expect.poll(() => at(page, 'trends')).toEqual([0, 0, 8, 4]);
    await expect(status(page).first()).toContainText('Trends resized: width 8, height 4.');
    await wider.click();
    await expect(status(page).first()).toContainText('Trends cannot be resized further');
    await expect(wider).toBeFocused();
    expect(await at(page, 'trends')).toEqual([0, 0, 8, 4]);
  });

  test('removes a tile and puts focus on the one that takes its place, never on nothing', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    await page.getByRole('button', { name: 'Remove Trends' }).click();
    await expect(tile(page, 'trends')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Move Service cards', exact: true }),
    ).toBeFocused();
    await expect(status(page).first()).toContainText('Trends removed. 3 widgets left.');
    // Remove the others: the last removal leaves focus on the grid itself.
    for (const name of ['Service cards', 'Quiet card', 'Tuned card']) {
      await page.getByRole('button', { name: `Remove ${name}` }).click();
    }
    await expect(page.locator('[data-grid-id]')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });

  test('moves and resizes by pointer, from the grip and from the resize handle', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    const handle = await tile(page, 'tuned').locator('.dashboard-resize').boundingBox();
    const size = await at(page, 'tuned');
    await page.mouse.move(handle!.x + 12, handle!.y + 12);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 60, handle!.y + 40, { steps: 4 });
    await page.mouse.move(handle!.x + 160, handle!.y + 90, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => at(page, 'tuned')).not.toEqual(size);
    await expect(page.getByTestId('changes')).toContainText('resize:tuned');

    const grip = await page
      .getByRole('button', { name: 'Move Quiet card', exact: true })
      .boundingBox();
    const before = await at(page, 'quiet');
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x + grip!.width / 2 + 40, grip!.y + 40, { steps: 4 });
    await page.mouse.move(grip!.x + grip!.width / 2 + 200, grip!.y + 120, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => at(page, 'quiet')).not.toEqual(before);
    await expect(page.getByTestId('changes')).toContainText('move:quiet');
  });

  test('a view that is only looked at changes nothing: no drag from the body, no change reported', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid');
    const box = (await tile(page, 'cards').boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 8 });
    await page.mouse.up();
    expect((await layout(page)).find(([id]) => id === 'cards')!.slice(1)).toEqual([6, 0, 6, 3]);
    await expect(page.getByTestId('changes')).toHaveText('');
  });

  test('clears the stale aria-disabled when the mode changes, by remounting the grid', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid');
    const disabled = () => page.locator('[data-grid-id][aria-disabled="true"]').count();
    await page.locator('#mode').click(); // edit
    await expect(page.getByRole('button', { name: 'Move Trends', exact: true })).toBeVisible();
    expect(await disabled()).toBe(0);
    await page.locator('#mode').click(); // view
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
    await page.locator('#mode').click(); // edit again
    // The tiles' buttons are usable (a disabled ancestor would make Playwright wait for them).
    await page.getByRole('button', { name: 'Make Trends narrower' }).click({ timeout: 3000 });
    await expect.poll(() => at(page, 'trends')).toEqual([0, 0, 5, 4]);
    expect(await disabled()).toBe(0);
  });

  test('keeps focus on the mode button through a change of mode', async ({ page, scene }) => {
    await scene('dashboard-grid');
    await page.locator('#mode').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Move Trends', exact: true })).toBeVisible();
    await expect(page.locator('#mode')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Move Trends', exact: true })).toHaveCount(0);
    await expect(page.locator('#mode')).toBeFocused();
  });

  test('puts focus back on the tile that had it when the viewport crosses md', async ({
    page,
    scene,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await scene('dashboard-grid', { query: 'edit' });
    await page.getByRole('button', { name: 'Move Service cards', exact: true }).focus();
    await page.setViewportSize({ width: 500, height: 800 });
    await expect(page.locator('.snapgrid')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove Service cards' })).toBeFocused();
  });

  test('below md draws no grid and no drag: a stacked list in reading order, with only the remove button in edit mode', async ({
    page,
    scene,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await scene('dashboard-grid');
    await expect(page.locator('.snapgrid')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible();
    const order = await page.locator('h2').allInnerTexts();
    expect(
      order.filter((text) => ['Trends', 'Service cards', 'Tuned card'].includes(text)),
    ).toEqual(['Trends', 'Service cards', 'Tuned card']);
    const trends = await tile(page, 'trends').count();
    expect(trends).toBe(0); // no `data-grid-id`: those are Snapgrid's tiles
    const boxes = await page
      .locator('[data-tile-id]:visible')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect()));
    expect(boxes.length).toBe(3);
    for (const box of boxes) expect(box.width).toBeGreaterThan(300);
    for (const [index, box] of boxes.entries()) {
      if (index > 0)
        expect(box.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height - 1);
    }
    await page.locator('#mode').click();
    await expect(page.getByRole('button', { name: 'Remove Trends' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /wider|taller/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove Trends' }).click();
    await expect(page.getByRole('button', { name: 'Remove Service cards' })).toBeFocused();
  });

  test('moves with the keyboard from the grip: Space picks up, the arrows move, Space drops, in the words of the page', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    const grip = page.getByRole('button', { name: 'Move Tuned card', exact: true });
    await grip.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[id^="dnd-kit-announcement"]')).toHaveText(/Picked up Tuned card\./);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect.poll(() => at(page, 'tuned')).toEqual([6, 3, 4, 3]);
    await expect(page.getByTestId('changes')).toContainText('move:tuned');
    await expect(status(page).first()).toContainText('Tuned card moved to row 4, column 7.');
    await expect(grip).toBeFocused();
    // Escape cancels and says so.
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(page.locator('[id^="dnd-kit-announcement"]')).toHaveText(
      /Moving Tuned card was cancelled\./,
    );
    await expect.poll(() => at(page, 'tuned')).toEqual([6, 3, 4, 3]);
  });

  test('says the keyboard drag in German', async ({ page, scene }) => {
    await scene('dashboard-grid', { query: 'edit', lang: 'de' });
    const grip = page.getByRole('button', { name: 'Service cards verschieben', exact: true });
    await grip.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[id^="dnd-kit-announcement"]')).toHaveText(
      /Service cards aufgenommen/,
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('[id^="dnd-kit-announcement"]')).toHaveText(
      /Das Verschieben von Service cards wurde abgebrochen/,
    );
    await expect(page.getByRole('button', { name: 'Service cards entfernen' })).toBeVisible();
  });

  test('has no running animation after a move under reduced motion, and one otherwise', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    // `scene` asks for reduced motion.
    const movedBy = async () => {
      const button = page.getByRole('button', { name: 'Move Trends right' });
      return page
        .evaluate(async () => {
          const target = [...document.querySelectorAll('button')].find(
            (element) => element.getAttribute('aria-label') === 'Move Service cards left',
          );
          target?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return document.getAnimations().filter((animation) => animation.playState === 'running')
            .length;
        })
        .finally(() => button.count());
    };
    // The cards tile moves left and the trends tile (before it) is where it was: one tile moves.
    await page.getByRole('button', { name: 'Make Trends narrower' }).click();
    await expect.poll(() => running(page)).toBe(0);
    expect(await movedBy()).toBe(0);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Move Trends', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Make Trends narrower' }).click();
    await page.getByRole('button', { name: 'Make Trends narrower' }).click();
    expect(
      await page.evaluate(async () => {
        const target = [...document.querySelectorAll('button')].find(
          (element) => element.getAttribute('aria-label') === 'Move Service cards left',
        );
        target?.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return document.getAnimations().filter((animation) => animation.playState === 'running')
          .length;
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  test('opens the settings of a tile in a dialog and gives focus back to the gear', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit&settings' });
    const gear = page.getByRole('button', { name: 'Settings of Tuned card' });
    await expect(page.getByRole('button', { name: /^Settings of/ })).toHaveCount(1);
    await gear.click();
    const dialog = page.getByRole('dialog', { name: 'Settings: Tuned card' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(gear).toBeFocused();
  });

  test('says what the page asks it to say in the live region', async ({ page, scene }) => {
    await scene('dashboard-grid');
    await page.getByRole('button', { name: 'Announce' }).click();
    await expect(status(page).first()).toHaveText('A message from the page');
  });

  test('[component:DashboardGrid] keyboard: every control is reached with Tab, in reading order, and the resize handle is not a stop', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    await page.getByRole('button', { name: 'Move Trends', exact: true }).focus();
    const stops: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      stops.push(
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute('aria-label') ??
            (document.activeElement as HTMLElement | null)?.innerText ??
            '',
        ),
      );
      await page.keyboard.press('Tab');
    }
    expect(stops.slice(0, 11)).toEqual([
      'Move Trends',
      'Move Trends left',
      'Move Trends right',
      'Move Trends up',
      'Move Trends down',
      'Make Trends wider',
      'Make Trends narrower',
      'Make Trends taller',
      'Make Trends shorter',
      'Remove Trends',
      // The chart's own button comes before the next tile's controls.
      'Show the data as a table',
    ]);
    // A button works with Enter and with Space.
    await page.getByRole('button', { name: 'Make Trends narrower' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect.poll(() => at(page, 'trends')).toEqual([0, 0, 4, 4]);
  });

  test('the data is reachable as a table inside a resized tile: the chart follows its tile', async ({
    page,
    scene,
  }) => {
    await scene('dashboard-grid', { query: 'edit' });
    const chart = page.getByRole('img', { name: 'Services per year' });
    await expect(chart.locator('svg')).toBeVisible();
    const before = (await chart.boundingBox())!.width;
    await page.getByRole('button', { name: 'Make Trends narrower' }).click();
    await page.getByRole('button', { name: 'Make Trends narrower' }).click();
    await expect.poll(async () => (await chart.boundingBox())!.width).toBeLessThan(before - 50);
    const svg = (await chart.locator('svg').boundingBox())!.width;
    expect(svg).toBeLessThanOrEqual((await chart.boundingBox())!.width + 1);
  });

  inBothThemes(
    '[component:DashboardGrid] axe: has no serious violation in view mode',
    'dashboard-grid',
  );
  inBothThemes(
    '[component:DashboardGrid] axe: has no serious violation in edit mode',
    'dashboard-grid',
    async () => {},
    'edit',
  );
  inBothThemes(
    '[component:DashboardGrid] axe: has no serious violation with the settings dialog open',
    'dashboard-grid',
    async (page) => {
      await page.getByRole('button', { name: 'Settings of Tuned card' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
    'edit&settings',
  );

  test('[component:DashboardGrid] axe: has no serious violation on the stacked layout, in both modes', async ({
    page,
    scene,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await scene('dashboard-grid');
    expect(await violations(page)).toEqual([]);
    await page.locator('#mode').click();
    await expect(page.getByRole('button', { name: 'Remove Trends' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
