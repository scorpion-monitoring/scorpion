import { apiAs } from '../support/admin.ts';
import {
  configure,
  fab,
  filter,
  finish,
  saved,
  store,
  storedTiles,
  tile,
  tileOf,
  W,
  watch,
  world,
} from '../support/dashboard.ts';
import { expect, test } from '../support/fixtures.ts';
import { docShot } from '../support/doc-shot.ts';
import { pageAs } from '../support/members.ts';

// J12: read the dashboard and export the numbers (CSV or XLSX). Moved from dashboard-widgets.spec.ts with every assertion: a person
// builds a dashboard of trends charts, reads the cards, the averages and the volatility, and exports what a widget shows. What the
// browser sends itself is counted and printed (`[dashboard-calls]`) and written into the report.
test.describe('J12: read the dashboard and export the numbers', () => {
  test('a chart for one service and a second for another, a range on each, the same after a reload', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    const first = tileOf(page, 'Trends');
    await test.step('Open the start page and find a chart that asks you to choose a service', async () => {
      await page.goto(at('/'));
      // The person has no defaults and no provider: the tile says what to do, and never takes an arbitrary service.
      await expect(first.getByText('Choose a service.')).toBeVisible();
    });

    await test.step('Choose a service and a range for the first chart', async () => {
      await fab(page).click();
      await configure(page, 'Trends', { service: w.a, range: '3m' });
      await expect(first).toContainText(`${w.a.name} · Last 3 months`);
    });
    await test.step('Add a second chart for another service and range', async () => {
      // A second chart: a new widget starts with the person's defaults (none), so it also says "Choose a service".
      await fab(page).click();
      await page.getByRole('button', { name: 'Add Trends' }).click();
      await expect(page.getByRole('button', { name: 'Settings of Trends (2)' })).toBeVisible();
      await configure(page, 'Trends (2)', { service: w.b, range: '6m' });
      await expect(tileOf(page, w.b.name)).toContainText('Last 6 months');
    });
    await test.step('Finish editing and see the dashboard saved', async () => {
      await finish(page);
      await expect(saved(page)).toBeVisible({ timeout: 10_000 });
      const stored = await storedTiles(me, W.trends);
      expect(
        stored.map((item) => [item.config.service, item.config.range, item.config.category]).sort(),
      ).toEqual(
        [
          [w.a.id, '3m', 'all'],
          [w.b.id, '6m', 'all'],
        ].sort(),
      );
    });

    await test.step('Reload the page and find both charts as you left them', async () => {
      await page.reload();
      await expect(tileOf(page, `${w.a.name} · Last 3 months`)).toBeVisible();
      await expect(tileOf(page, `${w.b.name} · Last 6 months`)).toBeVisible();
      const charts = page.getByRole('img', {
        name: 'Trends of the KPIs of the service, month by month',
      });
      await expect(charts).toHaveCount(2);
      await expect(charts.first().locator('svg')).toBeVisible();
      await docShot(page, 'j12', 'two-charts');
    });
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });

  test('the cards show the latest values and the changes in words, a text KPI shows its text and no change', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    await store(me, [
      tile('cardsa', W.cards, { x: 0, y: 0, w: 6, h: 8 }, filter(w.a.id)),
      tile('avga', W.averages, { x: 6, y: 0, w: 6, h: 4 }, filter(w.a.id)),
      tile('vola', W.volatility, { x: 6, y: 4, w: 6, h: 4 }, filter(w.a.id)),
    ]);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    const cards = tileOf(page, 'KPI cards');
    const row = (name: string) => cards.getByRole('listitem').filter({ hasText: name });
    await test.step('Open the start page and find the cards of your service', async () => {
      await page.goto(at('/'));
      await expect(cards.getByRole('status').filter({ hasText: '4 KPIs' })).toBeVisible();
    });

    await test.step('Read the latest values and the changes in words', async () => {
      const downloads = row(w.names.downloads);
      await expect(downloads).toContainText('150');
      await expect(downloads).toContainText('Count');
      await expect(downloads).toContainText('up 50 %');
      await expect(
        downloads.getByRole('img', { name: `${w.names.downloads}: 5 values, from 100 to 150` }),
      ).toBeVisible();
      const share = row(w.names.share);
      await expect(share).toContainText('20');
      await expect(share).toContainText('Percent');
      await expect(share).toContainText('down 50 %');
      await docShot(page, 'j12', 'cards');
    });
    await test.step('Read a text KPI, which shows its text and no change', async () => {
      // A text KPI shows its text and no change, and has no sparkline.
      const notes = row(w.names.notes);
      await expect(notes).toContainText('all well');
      await expect(notes).not.toContainText(/up|down|unchanged|n\/a/);
      await expect(notes.getByRole('img')).toHaveCount(0);
    });

    await test.step('Read the averages', async () => {
      // The averages: downloads (100 + 110 + 120 + 130 + 150) / 5 = 122, the text has none.
      const averages = tileOf(page, 'Averages');
      await expect(
        averages.getByRole('row', { name: new RegExp(w.names.downloads) }),
      ).toContainText('122');
      await expect(averages.getByRole('row', { name: new RegExp(w.names.notes) })).toContainText(
        'n/a',
      );
    });

    await test.step('Read the volatility and open its explanation with the keyboard', async () => {
      // The volatility bars: a value, the band in words, and an explanation that opens by keyboard.
      const volatility = tileOf(page, 'Volatility');
      const bar = volatility.getByRole('progressbar', {
        name: new RegExp(`${w.names.downloads}: volatility`),
      });
      await expect(bar).toHaveAccessibleName(/volatility \d+(\.\d)? %, (low|medium|high)$/);
      const toggle = volatility.getByRole('button', { name: 'What is volatility?' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(volatility.getByText(/Volatility says how far/)).toBeVisible();
    });
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });

  test('the Export menu of the trends chart and of the cards saves a CSV and an XLSX that match the series, with one request each', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    await store(me, [
      tile('cardsx', W.cards, { x: 0, y: 0, w: 6, h: 8 }, filter(w.a.id, '6m')),
      tile('trendsx', W.trends, { x: 6, y: 0, w: 6, h: 8 }, filter(w.a.id, '6m')),
      tile('avgx', W.averages, { x: 0, y: 8, w: 6, h: 4 }, filter(w.a.id, '6m')),
    ]);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    await page.goto('about:blank');
    const seen = watch(page);
    const trends = tileOf(page, 'Trends');
    const cards = tileOf(page, 'KPI cards');
    await test.step('Open the start page and find the Export button on the charts and the cards', async () => {
      await page.goto(at('/'));
      await expect(cards.getByRole('status').filter({ hasText: '4 KPIs' })).toBeVisible();
      await expect(trends.getByRole('button', { name: 'Export' })).toBeVisible();
      await expect(cards.getByRole('button', { name: 'Export' })).toBeVisible();
      // The widgets that show no table of a service to take away have no menu.
      await expect(tileOf(page, 'Averages').getByRole('button', { name: 'Export' })).toHaveCount(0);
      await docShot(page, 'j12', 'export-button');
    });

    // What the series says for the same window: the file must match it, month by month.
    const series = await me.get<{
      result: {
        name: string;
        points: { period: string; value: number | null; text: string | null }[];
      }[];
    }>(`/kpi/analytics/series?service=${w.a.id}&range=6m&pageSize=200`);
    expect(series.result).toHaveLength(4);

    const save = async (owner: typeof trends, format: 'CSV' | 'XLSX') => {
      seen.clear();
      await owner.getByRole('button', { name: 'Export' }).click();
      const menu = page.getByRole('list', { name: 'Export the numbers of this widget as a file' });
      await expect(menu).toBeVisible();
      const download = page.waitForEvent('download');
      await menu.getByRole('button', { name: format, exact: true }).click();
      const file = await download;
      const chunks: Buffer[] = [];
      for await (const chunk of (await file.createReadStream()) as AsyncIterable<Buffer>)
        chunks.push(chunk);
      await expect(owner.getByRole('status').filter({ hasText: /^Saved / })).toContainText(
        file.suggestedFilename(),
      );
      await page.waitForTimeout(500);
      // One request for one export, and no read of numbers beside it.
      const calls = [...seen.calls];
      console.log(`[dashboard-calls] widgets, an export as ${format}: ${calls.join(' | ')}`);
      test.info().annotations.push({
        type: `dashboard-calls: widgets export ${format}`,
        description: calls.join(' | '),
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(
        new RegExp(
          `^GET /kpi/analytics/export\\?service=${w.a.id}&range=6m&category=all&format=${format.toLowerCase()}$`,
        ),
      );
      // The menu closed and focus went back to its button.
      await expect(menu).toBeHidden();
      await expect(owner.getByRole('button', { name: 'Export' })).toBeFocused();
      return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
    };

    const csv = await test.step('Export the trends chart as CSV', () => save(trends, 'CSV'));
    await test.step('Read the CSV file: a header, one row per KPI and the values of each month', () => {
      expect(csv.name).toBe(`${w.a.slug}-kpis-6m.csv`);
      expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const lines = new TextDecoder('utf-8', { ignoreBOM: true })
        .decode(csv.bytes)
        .replace(/^\uFEFF/, '')
        .trimEnd()
        .split('\r\n')
        .map((line) => line.split(','));
      const months = series.result[0]!.points.map((point) => point.period.slice(0, 7));
      expect(lines[0]).toEqual(['KPI', 'Unit', ...months]);
      expect(lines).toHaveLength(1 + series.result.length);
      for (const kpi of series.result) {
        const row = lines.find((line) => line[0] === kpi.name);
        expect(row, kpi.name).toBeDefined();
        kpi.points.forEach((point, at6) => {
          const cell = row![2 + at6];
          if (point.value !== null)
            expect(Number(cell), `${kpi.name} ${point.period}`).toBe(point.value);
          else expect(cell, `${kpi.name} ${point.period}`).toBe(point.text ?? '');
        });
      }
      // The values this journey reported: downloads 100 to 150 in the five months before the current one, which has none yet.
      expect(lines.find((line) => line[0] === w.names.downloads)!.slice(2)).toEqual([
        '100',
        '110',
        '120',
        '130',
        '150',
        '',
      ]);
    });

    // The cards offer the same menu; an XLSX is a workbook (a zip) with the name of the service.
    const xlsx = await test.step('Export the cards as XLSX', () => save(cards, 'XLSX'));
    await test.step('Read the XLSX file: a workbook named after the service', () => {
      expect(xlsx.name).toBe(`${w.a.slug}-kpis-6m.xlsx`);
      expect([...xlsx.bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    });
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});
