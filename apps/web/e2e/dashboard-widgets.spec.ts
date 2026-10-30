import { violations } from './support/a11y.ts';
import { apiAs, permissionsOf } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { pageAs } from './support/members.ts';
import {
  shortId,
  world,
  W,
  tile,
  filter,
  store,
  storedTiles,
  watch,
  fab,
  finish,
  tileOf,
  saved,
  configure,
} from './support/dashboard.ts';

// M11 sprints 4 and 5: the widgets of kpi.analytics on the dashboard, and their Export menu. A person builds a dashboard of trends charts for two services with a range on each, the
// cards show the latest values and the changes in words, the controls of a chart survive a reload, a widget whose permission was taken away is dropped,
// the states say what to do, the defaults dialog changes what a new widget starts with, and a dashboard of eight widgets over two (service, range) pairs
// makes two reads. Every test makes its own data under names of its own (the specs of a run share one database) and runs under both base paths.
// What the browser sends itself is counted and printed (`[dashboard-calls]`) and written into the report.

test.describe('journey: a person builds a dashboard of trends charts', () => {
  test('the cumulative, hide and second axis controls survive a reload, and the table has the numbers', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    await store(me, [tile('trendsa', W.trends, { x: 0, y: 0, w: 12, h: 8 }, filter(w.a.id))]);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    await page.goto(at('/'));
    const box = tileOf(page, 'Trends');
    await expect(box.getByRole('img', { name: /Trends of the KPIs/ })).toBeVisible();
    await box.getByText('Series options').click();
    await box.getByRole('checkbox', { name: `Running total of ${w.names.downloads}` }).check();
    await box.getByRole('checkbox', { name: `Second axis for ${w.names.share}` }).check();
    await box.getByRole('checkbox', { name: `Show ${w.names.visits}` }).uncheck();
    await expect(saved(page)).toBeVisible({ timeout: 10_000 });

    const config = (await storedTiles(me, W.trends))[0]!.config;
    expect(config).toMatchObject({
      cumulative: [shortId(w.ids.downloads)],
      secondary: [shortId(w.ids.share)],
      hidden: [shortId(w.ids.visits)],
    });

    await page.reload();
    const again = tileOf(page, 'Trends');
    await expect(again.getByRole('img', { name: /Trends of the KPIs/ })).toBeVisible();
    await again.getByText('Series options').click();
    await expect(
      again.getByRole('checkbox', { name: `Running total of ${w.names.downloads}` }),
    ).toBeChecked();
    await expect(
      again.getByRole('checkbox', { name: `Second axis for ${w.names.share}` }),
    ).toBeChecked();
    await expect(again.getByRole('checkbox', { name: `Show ${w.names.visits}` })).not.toBeChecked();
    await expect(again.getByRole('checkbox', { name: `Show ${w.names.downloads}` })).toBeChecked();

    // The table is the text alternative: the running total of 100, 110, 120, 130 and 150 ends at 610, and the hidden KPI is not in it.
    await again.getByRole('button', { name: 'Show the data as a table' }).click();
    const table = again.getByRole('table', {
      name: 'Trends of the KPIs of the service, month by month',
    });
    await expect(table.getByRole('cell', { name: '610' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: new RegExp(w.names.visits) })).toHaveCount(
      0,
    );
    await expect(table.getByRole('columnheader', { name: new RegExp(w.names.share) })).toHaveCount(
      1,
    );
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});

test.describe('journey: the cards, the averages and the volatility say what the numbers are', () => {});

test.describe('journey: a person exports what a widget shows (M11 sprint 5)', () => {});

test.describe('journey: a widget whose permission was taken away is dropped', () => {
  test('an administrator removes the permission and the widgets are gone after the reload, with a message; they come back with it', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    await store(me, [
      tile('cardsa', W.cards, { x: 0, y: 0 }, filter(w.a.id)),
      tile('trendsa', W.trends, { x: 4, y: 0, w: 8 }, filter(w.a.id)),
    ]);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    await page.goto(at('/'));
    await expect(tileOf(page, 'KPI cards')).toBeVisible();

    const user = await permissionsOf(w.api, 'user');
    try {
      const without = user.filter((permission) => permission !== 'kpi.analytics.read');
      expect(without).toHaveLength(user.length - 1);
      expect(
        (await w.api.send('PUT', '/roles/user/permissions', { permissions: without })).status,
      ).toBe(200);
      await page.reload();
      await expect(
        page.getByText('2 widgets are no longer available and are not shown.'),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'KPI cards' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Trends' })).toHaveCount(0);
      // No permission id and no role name in the words.
      expect(await page.getByText(/no longer available/).innerText()).not.toMatch(
        /analytics|permission|user/i,
      );
    } finally {
      await w.api.send('PUT', '/roles/user/permissions', { permissions: user });
    }
    await page.reload();
    await expect(page.getByRole('heading', { name: 'KPI cards' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible();
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});

test.describe('journey: every state says what to do', () => {
  test('choose a service, no values for the range, no KPIs, and a failed read that comes back with a retry', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    await store(me, [
      tile('trendsb', W.trends, { x: 0, y: 0 }, filter(w.bare.id)),
      tile('cardsn', W.cards, { x: 4, y: 0 }, filter(w.noKpis.id)),
      tile('avgnone', W.averages, { x: 8, y: 0 }, filter(null)),
      tile('vola', W.volatility, { x: 0, y: 5 }, filter(w.a.id)),
    ]);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    // The read of service A fails (a 500 problem), the others are real.
    let failing = true;
    await page.route('**/api/internal/kpi/analytics/summary*', (route) => {
      if (failing && route.request().url().includes(`service=${w.a.id}`))
        return route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
          }),
        });
      return route.continue();
    });
    await page.goto(at('/'));

    await expect(
      tileOf(page, 'Trends').getByRole('status').filter({ hasText: 'No values for this range.' }),
    ).toBeVisible();
    await expect(
      tileOf(page, 'KPI cards')
        .getByRole('status')
        .filter({ hasText: 'This service has no KPIs.' }),
    ).toBeVisible();
    await expect(
      tileOf(page, 'Averages').getByRole('status').filter({ hasText: 'Choose a service.' }),
    ).toBeVisible();
    const volatility = tileOf(page, 'Volatility');
    await expect(volatility.getByRole('alert')).toContainText('The numbers could not be loaded.');
    // None of them is a blank tile: each has its heading and a message.
    for (const name of ['Trends', 'KPI cards', 'Averages', 'Volatility'])
      await expect(page.getByRole('heading', { name })).toBeVisible();

    failing = false;
    await volatility.getByRole('button', { name: 'Try again' }).click();
    await expect(volatility.getByRole('progressbar').first()).toBeVisible();
    await expect(volatility.getByRole('alert')).toHaveCount(0);
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});

test.describe('journey: the defaults dialog changes what a new widget starts with', () => {
  test('the dialog offers the vocabulary of the filters and a new widget takes what it stored', async ({
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
    await page.goto(at('/'));

    await page.getByRole('button', { name: 'Dashboard defaults' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dashboard defaults' });
    await expect(dialog).toBeVisible();
    // The categories are the vocabulary the reads use: the dialog lists the same terms as the defaults route.
    const offered = await me.get<{ categories: { key: string; label: string }[] }>(
      '/kpi/analytics/defaults',
    );
    const listed = await dialog.getByLabel('Thematic category').locator('option').allInnerTexts();
    expect(listed).toEqual(['All categories', ...offered.categories.map((term) => term.label)]);
    const technical = offered.categories.find((term) => term.key === 'Technical')!;

    await dialog.getByLabel('Search services').fill(w.b.slug);
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    await dialog
      .getByRole('combobox', { name: 'Service', exact: true })
      .selectOption({ label: `${w.b.name} (${w.b.slug})` });
    await dialog.getByLabel('Range').selectOption('2y');
    await dialog.getByLabel('Thematic category').selectOption({ label: technical.label });
    await dialog.getByRole('button', { name: 'Save defaults' }).click();
    await expect(dialog).toBeHidden();
    expect(await me.get('/kpi/analytics/defaults')).toMatchObject({
      service: w.b.id,
      range: '2y',
      category: 'Technical',
    });

    // A new widget starts with them.
    await fab(page).click();
    await page.getByRole('button', { name: 'Add Averages' }).click();
    await expect(tileOf(page, 'Averages')).toContainText(`${w.b.name} · Last 2 years`);
    await finish(page);
    await expect(saved(page)).toBeVisible({ timeout: 10_000 });
    const added = (await storedTiles(me, W.averages))[0]!;
    expect(added.config).toMatchObject({ service: w.b.id, range: '2y', category: 'Technical' });
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});

test.describe('calls: a dashboard of eight widgets over two (service, range) pairs', () => {
  test('makes two reads on arrival, none on a move or a resize, and one on a change of a widget’s range', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const me = await apiAs(playwright, baseURL, at, w.person);
    // Eight widgets: service A over a year (cards, trends, averages, volatility), service B over three months (cards, trends, averages), the actions.
    await store(me, [
      tile('cardsaa', W.cards, { x: 0, y: 0 }, filter(w.a.id, '1y')),
      tile('trendsaa', W.trends, { x: 4, y: 0, w: 8 }, filter(w.a.id, '1y')),
      tile('avgaa', W.averages, { x: 0, y: 5, h: 4 }, filter(w.a.id, '1y')),
      tile('volaa', W.volatility, { x: 4, y: 5, h: 4 }, filter(w.a.id, '1y')),
      tile('cardsbb', W.cards, { x: 8, y: 5 }, filter(w.b.id, '3m')),
      tile('trendsbb', W.trends, { x: 0, y: 10, w: 8 }, filter(w.b.id, '3m')),
      tile('avgbb', W.averages, { x: 8, y: 10, h: 4 }, filter(w.b.id, '3m')),
      tile('actqa', W.actions, { x: 0, y: 15, h: 3 }),
    ]);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    // Signing in left the person on the start page, which may still be reading: leave it, so only the load below is counted.
    await page.goto('about:blank');
    const seen = watch(page);
    seen.clear();
    await page.goto(at('/'));
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
    await expect(tileOf(page, w.b.name).first()).toContainText('Last 3 months');
    await expect(tileOf(page, w.a.name).first()).toContainText('Last year');
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    await page.waitForTimeout(1500);
    const arrival = [...seen.calls].sort();
    const reads = seen.reads();
    console.log(`[dashboard-calls] widgets, arrival (a full page load): ${arrival.join(' | ')}`);
    console.log(`[dashboard-calls] widgets, analytics reads on arrival: ${reads.length}`);
    test.info().annotations.push({
      type: 'dashboard-calls: widgets arrival',
      description: arrival.join(' | '),
    });
    test.info().annotations.push({
      type: 'dashboard-calls: analytics reads',
      description: String(reads.length),
    });
    // Two reads, one per (service, range), whatever the number of widgets; the names of the two services and the vocabulary of units are read once each.
    expect(reads).toHaveLength(2);
    expect(arrival.filter((call) => call.startsWith('GET /services/'))).toHaveLength(2);
    expect(arrival.filter((call) => call.includes('/vocabularies/kpi.unit/terms'))).toHaveLength(1);
    expect(arrival.filter((call) => call.includes('/kpi/analytics/defaults'))).toHaveLength(0);
    expect(arrival.filter((call) => call.includes('/ui/dashboard'))).toEqual([]);

    // Edit mode, a move and a resize with the buttons: no request.
    seen.clear();
    await fab(page).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Make Averages (1) wider' }).click();
    await page.getByRole('button', { name: 'Move Averages (2) left' }).click();
    await page.waitForTimeout(800);
    const moved = seen.calls.filter((call) => !call.startsWith('PUT /ui/dashboard'));
    console.log(
      `[dashboard-calls] widgets, edit mode, a move and a resize: ${moved.join(' | ') || 'none'}`,
    );
    test.info().annotations.push({
      type: 'dashboard-calls: widgets move and resize',
      description: moved.join(' | ') || 'none',
    });
    expect(moved).toEqual([]);

    // A change of one widget's range asks for its own key, once; the others keep theirs.
    seen.clear();
    await configure(page, 'Averages (2)', { range: '6m' });
    await expect(tileOf(page, w.b.name).filter({ hasText: 'Last 6 months' }).first()).toBeVisible();
    await page.waitForTimeout(800);
    const changed = seen.reads();
    console.log(
      `[dashboard-calls] widgets, a change of one widget's range: ${changed.join(' | ')}`,
    );
    test.info().annotations.push({
      type: 'dashboard-calls: widgets range change',
      description: changed.join(' | '),
    });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain(`service=${w.b.id}`);
    expect(changed[0]).toContain('range=6m');
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});

test.describe('calls: the default dashboard of a person with no service', () => {
  test('reads the defaults once for all its tiles, and no numbers, no names and no vocabulary', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.person);
    const page = opened.page;
    await page.goto('about:blank');
    const seen = watch(page);
    seen.clear();
    await page.goto(at('/'));
    await expect(
      tileOf(page, 'KPI cards').getByRole('status').filter({ hasText: 'Choose a service.' }),
    ).toBeVisible();
    await expect(
      tileOf(page, 'Trends').getByRole('status').filter({ hasText: 'Choose a service.' }),
    ).toBeVisible();
    await page.waitForTimeout(1000);
    const mine = seen.calls.filter((call) => /\/kpi\/|\/services\/|\/vocabularies\//.test(call));
    console.log(`[dashboard-calls] widgets, default dashboard, no service: ${mine.join(' | ')}`);
    test.info().annotations.push({
      type: 'dashboard-calls: widgets default dashboard',
      description: mine.join(' | '),
    });
    expect(mine).toEqual(['GET /kpi/analytics/defaults']);
    await opened.close();
    await w.api.dispose();
  });
});

test.describe('accessibility: the widgets have no serious violation', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`with data, empty and failed, and the settings dialog, ${scheme} theme`, async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const w = await world(playwright, baseURL, at);
      const me = await apiAs(playwright, baseURL, at, w.person);
      await store(me, [
        tile('cardsa', W.cards, { x: 0, y: 0, h: 6 }, filter(w.a.id)),
        tile('trendsa', W.trends, { x: 4, y: 0, w: 8, h: 6 }, filter(w.a.id)),
        tile('avga', W.averages, { x: 0, y: 6, h: 4 }, filter(w.a.id)),
        tile('vola', W.volatility, { x: 4, y: 6, h: 4 }, filter(w.a.id)),
        tile('actqa', W.actions, { x: 8, y: 6, h: 4 }),
      ]);
      const opened = await pageAs(browser, baseURL, at, w.person);
      const page = opened.page;
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(at('/'));
      await expect(
        page.getByRole('img', { name: /Trends of the KPIs/ }).locator('svg'),
      ).toBeVisible();
      await expect(tileOf(page, 'Volatility').getByRole('progressbar').first()).toBeVisible();
      expect(await violations(page), 'with data').toEqual([]);

      // The chart's table and the series options open, the explanation of the volatility open.
      const trends = tileOf(page, 'Trends');
      await trends.getByRole('button', { name: 'Show the data as a table' }).click();
      await trends.getByText('Series options').click();
      await tileOf(page, 'Volatility').getByRole('button', { name: 'What is volatility?' }).click();
      expect(
        await violations(page),
        'with the table, the options and the explanation open',
      ).toEqual([]);

      // The chart is read by keyboard: an arrow key says one month's values in a status line.
      const chart = trends.getByRole('group', {
        name: 'Trends of the KPIs of the service, month by month',
      });
      await chart.focus();
      await page.keyboard.press('End');
      await expect(trends.getByRole('status').filter({ hasText: w.names.downloads })).toBeVisible();
      await page.keyboard.press('Escape');

      // The settings dialog and the defaults dialog.
      await fab(page).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Settings of Trends', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Service', exact: true })).toBeVisible();
      expect(await violations(page), 'the settings dialog').toEqual([]);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await finish(page);

      // Empty, no KPIs, no service and failed.
      await store(me, [
        tile('trendsb', W.trends, { x: 0, y: 0 }, filter(w.bare.id)),
        tile('cardsn', W.cards, { x: 4, y: 0 }, filter(w.noKpis.id)),
        tile('avgnone', W.averages, { x: 8, y: 0 }, filter(null)),
        tile('vola', W.volatility, { x: 0, y: 5 }, filter(w.a.id)),
      ]);
      await page.route('**/api/internal/kpi/analytics/summary*', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
          }),
        }),
      );
      await page.goto(at('/'));
      await expect(tileOf(page, 'Volatility').getByRole('alert')).toBeVisible();
      await expect(tileOf(page, 'Averages').getByText('Choose a service.')).toBeVisible();
      expect(await violations(page), 'empty, no KPIs, no service and failed').toEqual([]);
      await opened.close();
      await me.dispose();
      await w.api.dispose();
    });
  }
});
