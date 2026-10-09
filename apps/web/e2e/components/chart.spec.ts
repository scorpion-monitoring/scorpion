import { expect, inBothThemes, test } from './support.ts';

// Chart (harness/scenes/chart.svelte): ECharts behind the adapter, with a text alternative.

test.describe('Chart', () => {
  test('draws a line, a bar and a radar chart as SVG, each named, and loads ECharts only when a chart mounts', async ({
    page,
    scene,
  }) => {
    const loaded: string[] = [];
    page.on('request', (request) => loaded.push(request.url()));
    // A page of the harness without a chart does not fetch the library.
    await scene('parts');
    expect(loaded.filter((url) => /chart-echarts|charts-|renderers-/.test(url))).toEqual([]);

    await scene('chart');
    for (const name of [
      'Services and users per year',
      'Services and users per year, as bars',
      'Maturity per principle',
    ]) {
      const chart = page.getByRole('img', { name, exact: true });
      await expect(chart.locator('svg')).toBeVisible();
      expect(await chart.locator('svg *').count()).toBeGreaterThan(5);
    }
    expect(loaded.some((url) => /chart-echarts/.test(url))).toBe(true);
  });

  test('has the same numbers as a table behind a button, with the unit and a dash for a gap', async ({
    page,
    scene,
  }) => {
    await scene('chart');
    const figure = page.locator('figure').first();
    const table = figure.getByRole('table', { name: 'Services and users per year' });
    await expect(table).toBeHidden();
    const toggle = figure.locator('button[aria-controls]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveText('Hide the table');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(table.getByRole('columnheader')).toHaveText(['Category', 'Services', 'Users']);
    await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText([
      '4 items',
      '2 items',
    ]);
    await expect(table.getByRole('row').nth(3).getByRole('cell')).toHaveText(['15 items', '–']);
    await expect(table.getByRole('rowheader')).toHaveText(['2021', '2022', '2023', '2024']);
  });

  test('follows the theme: the colours change when the page goes dark', async ({ page, scene }) => {
    await scene('chart', { theme: 'light' });
    const chart = page.getByRole('img', { name: 'Services and users per year', exact: true });
    const textColour = () =>
      chart
        .locator('svg text')
        .first()
        .evaluate((node) => getComputedStyle(node).fill);
    await expect(chart.locator('svg text').first()).toBeVisible();
    const light = await textColour();
    await page.evaluate(() => (document.documentElement.dataset.theme = 'scorpiondark'));
    await expect.poll(textColour).not.toBe(light);
  });

  test('says so, and keeps the table, for a spec that cannot be drawn', async ({ page, scene }) => {
    await scene('chart');
    const figure = page.locator('figure').nth(3);
    await expect(figure.getByRole('alert')).toHaveText(
      'The chart data is not valid. The table has what there is.',
    );
    await figure.getByRole('button', { name: 'Show the data as a table' }).click();
    await expect(figure.getByRole('table')).toBeVisible();
  });

  test('[component:Chart] keyboard: the table button is reached with Tab and works with Enter and Space', async ({
    page,
    scene,
  }) => {
    await scene('chart');
    const figure = page.locator('figure').first();
    const toggle = figure.locator('button[aria-controls]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(figure.getByRole('table')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(figure.getByRole('table')).toBeHidden();
  });

  inBothThemes('[component:Chart] axe: charts and tables', 'chart', async (page) => {
    await expect(
      page.getByRole('img', { name: 'Maturity per principle' }).locator('svg'),
    ).toBeVisible();
    for (let index = 0; index < 4; index += 1)
      await page.locator('figure button[aria-controls]').nth(index).click();
  });
});
