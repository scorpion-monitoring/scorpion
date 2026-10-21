import type { Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import {
  activeUser,
  adminApi,
  apiAs,
  newPerson,
  permissionsOf,
  unique,
  type AdminApi,
} from './support/admin.ts';
import { expect, test, type Credentials } from './support/fixtures.ts';
import { makeOrg, pageAs, uniqueAbbreviation } from './support/members.ts';

// M11 sprint 4: the widgets of kpi.analytics on the dashboard. A person builds a dashboard of trends charts for two services with a range on each, the
// cards show the latest values and the changes in words, the controls of a chart survive a reload, a widget whose permission was taken away is dropped,
// the states say what to do, the defaults dialog changes what a new widget starts with, and a dashboard of eight widgets over two (service, range) pairs
// makes two reads. Every test makes its own data under names of its own (the specs of a run share one database) and runs under both base paths.
// What the browser sends itself is counted and printed (`[dashboard-calls]`) and written into the report.

interface Service {
  id: string;
  slug: string;
  name: string;
}

interface World {
  api: AdminApi;
  tag: string;
  names: { downloads: string; visits: string; share: string; notes: string };
  ids: { downloads: string; visits: string; share: string; notes: string };
  /** Two services with values, one with a KPI set and no values, one with no KPI set. */
  a: Service;
  b: Service;
  bare: Service;
  noKpis: Service;
  person: Credentials;
  /** `back(1)` is the month before the current one, as the server's clock has it. */
  back: (n: number) => string;
}

/** The last 12 hex digits of an id: how a chart's configuration names a KPI. */
const shortId = (id: string) => id.replaceAll('-', '').slice(-12).toLowerCase();

async function report(
  api: AdminApi,
  serviceId: string,
  period: string,
  values: Record<string, string>,
) {
  const made = await api.send('POST', '/kpi/ingestion/runs', {
    serviceId,
    form: { period, values },
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
}

/**
 * Four KPIs (two whole numbers, a percentage and a text), one KPI set, two services with five months of values, one with none, one with no KPI set
 * at all, and a person with the role `user`. The months are the server's: the last month of the coverage is the current one.
 */
async function world(
  playwright: Parameters<typeof adminApi>[0],
  baseURL: string | undefined,
  at: (path: string) => string,
): Promise<World> {
  const api = await adminApi(playwright, baseURL, at);
  const tag = unique('aw');
  const make = async (body: Record<string, unknown>) => {
    const made = await api.send('POST', '/kpi/indicators', { thematic: 'Usage', ...body });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return (made.body as { id: string }).id;
  };
  const names = {
    downloads: `Downloads ${tag}`,
    visits: `Visits ${tag}`,
    share: `Share ${tag}`,
    notes: `Notes ${tag}`,
  };
  const ids = {
    downloads: await make({ name: names.downloads, valueType: 'integer', unit: 'count' }),
    visits: await make({ name: names.visits, valueType: 'integer', unit: 'count' }),
    share: await make({
      name: names.share,
      valueType: 'percentage',
      unit: 'percent',
      thematic: 'Technical',
    }),
    notes: await make({ name: names.notes, valueType: 'text', qualitative: true }),
  };
  const setMade = await api.send('POST', '/kpi/sets', { name: `Widgets set ${tag}` });
  expect(setMade.status, JSON.stringify(setMade.body)).toBe(201);
  const setId = (setMade.body as { id: string }).id;
  const rows = await api.send('PUT', `/kpi/sets/${setId}/indicators`, {
    indicators: Object.values(ids).map((indicatorId) => ({ indicatorId, necessity: 'optional' })),
  });
  expect(rows.status, JSON.stringify(rows.body)).toBe(200);

  const provider = await makeOrg(api, uniqueAbbreviation('AWA'));
  const makeService = async (suffix: string, withKpis: boolean): Promise<Service> => {
    const slug = `${tag}-${suffix}`;
    const name = `${tag} ${suffix} service`;
    const made = await api.send('POST', '/services', {
      slug,
      name,
      provider: provider.id,
      ...(withKpis ? { kpiSet: { setId, extras: [] } } : {}),
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return { id: (made.body as { id: string }).id, slug, name };
  };
  const a = await makeService('alpha', true);
  const b = await makeService('beta', true);
  const bare = await makeService('bare', true);
  const noKpis = await makeService('none', false);

  const coverage = await api.get<{ result: { period: string }[] }>(
    `/kpi/measurements/coverage?service=${a.id}&months=12`,
  );
  const months = coverage.result.map((entry) => entry.period.slice(0, 7));
  const back = (n: number) => months[months.length - 1 - n]!;

  // Service A over five months, oldest first: downloads 100 to 150 (up 50 %), the share 40 to 20 (down 50 %), a text in the newest month.
  const downloads = ['100', '110', '120', '130', '150'];
  const visits = ['10', '11', '12', '13', '14'];
  for (const [at5, value] of downloads.entries()) {
    await report(api, a.id, back(5 - at5), {
      [ids.downloads]: value,
      [ids.visits]: visits[at5]!,
      ...(at5 === 0 ? { [ids.share]: '40' } : {}),
      ...(at5 === 4 ? { [ids.share]: '20', [ids.notes]: 'all well' } : {}),
    });
  }
  // Service B: two months.
  await report(api, b.id, back(2), { [ids.downloads]: '1000', [ids.share]: '60' });
  await report(api, b.id, back(1), { [ids.downloads]: '2000', [ids.share]: '70' });

  const person = newPerson('aw');
  await activeUser(api, at, person);
  return { api, tag, names, ids, a, b, bare, noKpis, person, back };
}

interface Tile {
  id: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

const W = {
  cards: 'kpi.analytics.cards',
  trends: 'kpi.analytics.trends',
  averages: 'kpi.analytics.averages',
  volatility: 'kpi.analytics.volatility',
  actions: 'kpi.analytics.actions',
};

const tile = (
  id: string,
  widget: string,
  at: { x: number; y: number; w?: number; h?: number },
  config: Record<string, unknown> = {},
): Tile => ({ id, widget, w: 4, h: 5, ...at, config });

const filter = (service: string | null, range = '6m') => ({ service, range, category: 'all' });

/** Stores the person's dashboard through the API, so a journey starts from a known layout. */
async function store(api: AdminApi, items: Tile[]) {
  const saved = await api.send('PUT', '/ui/dashboard', { items });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}

/** The person's stored tiles of one widget, as the server reads them. */
async function storedTiles(api: AdminApi, widget: string): Promise<Tile[]> {
  const view = await api.get<{ items: Tile[] }>('/ui/dashboard');
  return view.items.filter((item) => item.widget === widget);
}

/** What the browser sends to the API itself. */
function watch(page: Page) {
  const calls: string[] = [];
  page.on('pageerror', (error) => console.log('PAGEERROR', String(error).slice(0, 600)));
  page.on('request', (request) => {
    const url = new URL(request.url());
    const at = url.pathname.indexOf('/api/internal/');
    if (at >= 0) calls.push(`${request.method()} ${url.pathname.slice(at + 13)}${url.search}`);
  });
  return {
    calls,
    clear() {
      calls.length = 0;
    },
    /** The analytics reads: summary and series. */
    reads: () => calls.filter((call) => /^GET \/kpi\/analytics\/(summary|series)\b/.test(call)),
  };
}

const fab = (page: Page) => page.getByRole('button', { name: 'Customise dashboard' });
/** Leaves edit mode: the menu of the customise button holds "Done", so it is opened first if it is closed. */
async function finish(page: Page) {
  if ((await fab(page).getAttribute('aria-expanded')) !== 'true') await fab(page).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
const tileOf = (page: Page, text: string | RegExp) =>
  page.locator('[data-grid-id]').filter({ hasText: text });
const saved = (page: Page) => page.getByRole('status').filter({ hasText: /^Saved$/ });

/** Opens the settings of the tile named `name` (edit mode must be on), chooses a service by searching for its tag, a range, and applies. */
async function configure(
  page: Page,
  name: string,
  choice: { service?: Service; tag?: string; range?: string; category?: string },
) {
  await page.getByRole('button', { name: `Settings of ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (choice.service) {
    await dialog.getByLabel('Search services').fill(choice.service.slug);
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    const select = dialog.getByRole('combobox', { name: 'Service', exact: true });
    await expect(select.locator('option', { hasText: `(${choice.service.slug})` })).toHaveCount(1);
    await select.selectOption({ label: `${choice.service.name} (${choice.service.slug})` });
  }
  if (choice.range) await dialog.getByLabel('Range').selectOption(choice.range);
  if (choice.category) await dialog.getByLabel('Thematic category').selectOption(choice.category);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('journey: a person builds a dashboard of trends charts', () => {
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
    await page.goto(at('/'));
    // The person has no defaults and no provider: the tile says what to do, and never takes an arbitrary service.
    const first = tileOf(page, 'Trends');
    await expect(first.getByText('Choose a service.')).toBeVisible();

    await fab(page).click();
    await configure(page, 'Trends', { service: w.a, range: '3m' });
    await expect(first).toContainText(`${w.a.name} · Last 3 months`);

    // A second chart: a new widget starts with the person's defaults (none), so it also says "Choose a service".
    await fab(page).click();
    await page.getByRole('button', { name: 'Add Trends' }).click();
    await expect(page.getByRole('button', { name: 'Settings of Trends (2)' })).toBeVisible();
    await configure(page, 'Trends (2)', { service: w.b, range: '6m' });
    await expect(tileOf(page, w.b.name)).toContainText('Last 6 months');
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

    await page.reload();
    await expect(tileOf(page, `${w.a.name} · Last 3 months`)).toBeVisible();
    await expect(tileOf(page, `${w.b.name} · Last 6 months`)).toBeVisible();
    const charts = page.getByRole('img', {
      name: 'Trends of the KPIs of the service, month by month',
    });
    await expect(charts).toHaveCount(2);
    await expect(charts.first().locator('svg')).toBeVisible();
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });

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

test.describe('journey: the cards, the averages and the volatility say what the numbers are', () => {
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
    await page.goto(at('/'));
    const cards = tileOf(page, 'KPI cards');
    await expect(cards.getByRole('status').filter({ hasText: '4 KPIs' })).toBeVisible();
    const row = (name: string) => cards.getByRole('listitem').filter({ hasText: name });

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
    // A text KPI shows its text and no change, and has no sparkline.
    const notes = row(w.names.notes);
    await expect(notes).toContainText('all well');
    await expect(notes).not.toContainText(/up|down|unchanged|n\/a/);
    await expect(notes.getByRole('img')).toHaveCount(0);

    // The averages: downloads (100 + 110 + 120 + 130 + 150) / 5 = 122, the text has none.
    const averages = tileOf(page, 'Averages');
    await expect(averages.getByRole('row', { name: new RegExp(w.names.downloads) })).toContainText(
      '122',
    );
    await expect(averages.getByRole('row', { name: new RegExp(w.names.notes) })).toContainText(
      'n/a',
    );

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
    await opened.close();
    await me.dispose();
    await w.api.dispose();
  });
});

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
