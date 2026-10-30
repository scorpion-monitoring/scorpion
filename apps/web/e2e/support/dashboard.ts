// What the dashboard widget specs share: a world of two services with values, a person with a dashboard, the stored tiles and the
// readers of a tile. Each spec makes its own data under names of its own.
import type { Page } from '@playwright/test';
import { activeUser, adminApi, newPerson, unique, type AdminApi } from './admin.ts';
import { expect, type Credentials } from './fixtures.ts';
import { makeOrg, uniqueAbbreviation } from './members.ts';

export interface Service {
  id: string;
  slug: string;
  name: string;
}

export interface World {
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
export const shortId = (id: string) => id.replaceAll('-', '').slice(-12).toLowerCase();

export async function report(
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
export async function world(
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

export interface Tile {
  id: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export const W = {
  cards: 'kpi.analytics.cards',
  trends: 'kpi.analytics.trends',
  averages: 'kpi.analytics.averages',
  volatility: 'kpi.analytics.volatility',
  actions: 'kpi.analytics.actions',
};

export const tile = (
  id: string,
  widget: string,
  at: { x: number; y: number; w?: number; h?: number },
  config: Record<string, unknown> = {},
): Tile => ({ id, widget, w: 4, h: 5, ...at, config });

export const filter = (service: string | null, range = '6m') => ({
  service,
  range,
  category: 'all',
});

/** Stores the person's dashboard through the API, so a journey starts from a known layout. */
export async function store(api: AdminApi, items: Tile[]) {
  const saved = await api.send('PUT', '/ui/dashboard', { items });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}

/** The person's stored tiles of one widget, as the server reads them. */
export async function storedTiles(api: AdminApi, widget: string): Promise<Tile[]> {
  const view = await api.get<{ items: Tile[] }>('/ui/dashboard');
  return view.items.filter((item) => item.widget === widget);
}

/** What the browser sends to the API itself. */
export function watch(page: Page) {
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

export const fab = (page: Page) => page.getByRole('button', { name: 'Customise dashboard' });
/** Leaves edit mode: the menu of the customise button holds "Done", so it is opened first if it is closed. */
export async function finish(page: Page) {
  if ((await fab(page).getAttribute('aria-expanded')) !== 'true') await fab(page).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
export const tileOf = (page: Page, text: string | RegExp) =>
  page.locator('[data-grid-id]').filter({ hasText: text });
export const saved = (page: Page) => page.getByRole('status').filter({ hasText: /^Saved$/ });

/** Opens the settings of the tile named `name` (edit mode must be on), chooses a service by searching for its tag, a range, and applies. */
export async function configure(
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
