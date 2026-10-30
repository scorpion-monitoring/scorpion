// What the Data Submission specs share: a world of indicators, a KPI set, a service and two people, the file types, and the
// readers of what the page does (`watch`, `field`, `stored`). Each spec makes its own data under a tag of its own.
import type { Page } from '@playwright/test';
import { adminApi, newPerson, unique, type AdminApi } from './admin.ts';
import { expect } from './fixtures.ts';
import { makeOrg, memberOf, uniqueAbbreviation } from './members.ts';

export const CSV_TYPE = 'text/csv';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface World {
  api: AdminApi;
  tag: string;
  indicators: { downloads: string; uptime: string; session: string; notes: string };
  names: { downloads: string; uptime: string; session: string; notes: string };
  provider: Awaited<ReturnType<typeof makeOrg>>;
  elsewhere: Awaited<ReturnType<typeof makeOrg>>;
  member: ReturnType<typeof newPerson>;
  stranger: ReturnType<typeof newPerson>;
  service: { id: string; slug: string; name: string };
  /** The months by the server's clock: the current one and the one before. */
  current: string;
  previous: string;
  makeService: (suffix: string) => Promise<{ id: string; slug: string; name: string }>;
}

/** Indicators of four value types, a KPI set that names three necessities, a service with it, a member of its provider and a stranger. */
export async function world(
  playwright: Parameters<typeof adminApi>[0],
  baseURL: string | undefined,
  at: (path: string) => string,
): Promise<World> {
  const api = await adminApi(playwright, baseURL, at);
  const tag = unique('ds');
  const make = async (body: Record<string, unknown>) => {
    const made = await api.send('POST', '/kpi/indicators', { thematic: 'Usage', ...body });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return (made.body as { id: string }).id;
  };
  const names = {
    downloads: `Downloads ${tag}`,
    uptime: `Uptime ${tag}`,
    session: `Session length ${tag}`,
    notes: `Notes ${tag}`,
  };
  const indicators = {
    downloads: await make({
      name: names.downloads,
      valueType: 'integer',
      unit: 'count',
      min: 0,
      max: 1_000_000,
    }),
    uptime: await make({ name: names.uptime, valueType: 'percentage', unit: 'percent' }),
    session: await make({ name: names.session, valueType: 'duration', unit: 'second' }),
    notes: await make({ name: names.notes, valueType: 'text', qualitative: true }),
  };
  const setMade = await api.send('POST', '/kpi/sets', { name: `Submission set ${tag}` });
  expect(setMade.status, JSON.stringify(setMade.body)).toBe(201);
  const setId = (setMade.body as { id: string }).id;
  const rows = await api.send('PUT', `/kpi/sets/${setId}/indicators`, {
    indicators: [
      { indicatorId: indicators.downloads, necessity: 'mandatory' },
      { indicatorId: indicators.uptime, necessity: 'recommended' },
      { indicatorId: indicators.session, necessity: 'optional' },
      { indicatorId: indicators.notes, necessity: 'optional' },
    ],
  });
  expect(rows.status, JSON.stringify(rows.body)).toBe(200);

  const provider = await makeOrg(api, uniqueAbbreviation('DSA'));
  const elsewhere = await makeOrg(api, uniqueAbbreviation('DSB'));
  const member = newPerson('dsmem');
  await memberOf(api, playwright, baseURL, at, member, provider);
  const stranger = newPerson('dsstr');
  await memberOf(api, playwright, baseURL, at, stranger, elsewhere);

  const makeService = async (suffix: string) => {
    const slug = `${tag}-${suffix}`;
    const name = `${tag} ${suffix} service`;
    const made = await api.send('POST', '/services', {
      slug,
      name,
      provider: provider.id,
      kpiSet: { setId, extras: [] },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return { id: (made.body as { id: string }).id, slug, name };
  };
  const service = await makeService('main');

  // The months are the server's: the coverage's last month is the current one by its clock.
  const coverage = await api.get<{ result: { period: string }[] }>(
    `/kpi/measurements/coverage?service=${service.id}&months=3`,
  );
  const months = coverage.result.map((entry) => entry.period.slice(0, 7));
  return {
    api,
    tag,
    indicators,
    names,
    provider,
    elsewhere,
    member,
    stranger,
    service,
    current: months[months.length - 1]!,
    previous: months[months.length - 2]!,
    makeService,
  };
}

/** The values stored for a month, by indicator id, as the grid answers them. */
export async function stored(
  api: AdminApi,
  serviceId: string,
  month: string,
): Promise<Record<string, string>> {
  const grid = await api.get<{
    result: { indicatorId: string; measurement: { value: string } | null }[];
  }>(`/kpi/measurements?service=${serviceId}&period=${month}&pageSize=500`);
  return Object.fromEntries(
    grid.result.flatMap((row) =>
      row.measurement ? [[row.indicatorId, row.measurement.value]] : [],
    ),
  );
}

export const csvOf = (w: World, rows: string[][]) =>
  [['Period', w.names.downloads, w.names.uptime, w.names.session, w.names.notes], ...rows]
    .map((row) => row.join(','))
    .join('\n');

/** The same table for a CSV and for an XLSX file: the equivalence test sends both. */
export const tableOf = (w: World): string[][] => [
  [w.previous, '10', '99.5', '00-45-00', 'fine'],
  [w.current, '20', '98', '01-00-00', ''],
];

export async function openService(
  page: Page,
  at: (path: string) => string,
  w: World,
  serviceId = w.service.id,
) {
  await page.goto(at(`/submit?service=${serviceId}`));
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
}

export const field = (page: Page, name: string) => page.getByLabel(new RegExp(`^${name}`));

/** Counts what the browser sends to the API itself; page loads of the shell (`__data.json`) are counted apart. */
export function watch(page: Page) {
  const calls: string[] = [];
  const loads: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/api/internal/'))
      calls.push(
        `${request.method()} ${path.slice(path.indexOf('/api/internal/') + 13)}${new URL(request.url()).search}`,
      );
    else if (path.endsWith('__data.json')) loads.push(path);
  });
  return {
    calls,
    loads,
    clear() {
      calls.length = 0;
      loads.length = 0;
    },
  };
}

/** The cells of a workbook: the header as text, then in each row the period as text and the two numeric columns as numbers. */
export const sheet = (header: string[], rows: string[][]): (string | number)[][] => [
  header,
  ...rows.map((row) =>
    row.map((cell, index) => (index > 0 && index < 3 && cell !== '' ? Number(cell) : cell)),
  ),
];
