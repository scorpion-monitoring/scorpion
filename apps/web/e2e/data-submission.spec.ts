import { readFile } from 'node:fs/promises';
import type { Browser, Page } from '@playwright/test';
import writeExcelFile from 'write-excel-file/node';
import { violations } from './support/a11y.ts';
import { adminApi, apiAs, newPerson, unique, type AdminApi } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { makeOrg, memberOf, pageAs, uniqueAbbreviation } from './support/members.ts';

// M10 sprint 4: the Data Submission page. A member reports a month in the form, from a CSV file and from an XLSX file, sees what a file would do before
// anything is recorded, cannot commit a file with a bad cell, downloads the import template and uploads it again, and reads the history. A person of
// another provider cannot see the service. Every test makes its own data under names of its own (the specs of a run share one database), under both
// base paths, and axe runs in both themes. What the browser sends itself is counted and printed (`[kpi-calls]`) and written into the report.

const CSV_TYPE = 'text/csv';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface World {
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
async function world(
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
async function stored(
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

const csvOf = (w: World, rows: string[][]) =>
  [['Period', w.names.downloads, w.names.uptime, w.names.session, w.names.notes], ...rows]
    .map((row) => row.join(','))
    .join('\n');

/** The same table for a CSV and for an XLSX file: the equivalence test sends both. */
const tableOf = (w: World): string[][] => [
  [w.previous, '10', '99.5', '00-45-00', 'fine'],
  [w.current, '20', '98', '01-00-00', ''],
];

async function openService(
  page: Page,
  at: (path: string) => string,
  w: World,
  serviceId = w.service.id,
) {
  await page.goto(at(`/submit?service=${serviceId}`));
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
}

const field = (page: Page, name: string) => page.getByLabel(new RegExp(`^${name}`));

/** Counts what the browser sends to the API itself; page loads of the shell (`__data.json`) are counted apart. */
function watch(page: Page) {
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
const sheet = (header: string[], rows: string[][]): (string | number)[][] => [
  header,
  ...rows.map((row) =>
    row.map((cell, index) => (index > 0 && index < 3 && cell !== '' ? Number(cell) : cell)),
  ),
];

test.describe('journey: a member reports a month in the form', () => {
  test('fills it in, reloads, sees the values, and a second save corrects them', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    const seen = watch(page);

    // The picker lists the service of the member's provider, and opening it puts the service in the address.
    await page.goto(at('/submit'));
    await expect(page.getByRole('heading', { name: 'Data Submission', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Service', { exact: true }).locator('option')).toHaveCount(1);
    await page.getByLabel('Service', { exact: true }).selectOption(w.service.id);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`submit\\?service=${w.service.id}$`));
    await expect(
      page.getByRole('heading', { name: `Reporting for ${w.service.name}`, level: 2 }),
    ).toBeVisible();

    // The groups carry the words of the vocabulary; the save stays disabled until the mandatory value is there.
    for (const group of ['Mandatory', 'Recommended', 'Optional'])
      await expect(page.getByRole('group', { name: group })).toBeVisible();
    const save = page.getByRole('button', { name: 'Save values' });
    await expect(save).toBeDisabled();
    await expect(page.getByText('Fill in every mandatory indicator to save.')).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Mandatory' }).getByLabel(/Downloads/),
    ).toBeVisible();

    // The unit and the bounds are beside the input; typed values are checked and the error is under the field, in text.
    await expect(page.getByText('Unit: Count · From 0 to 1000000')).toBeVisible();
    await expect(page.getByText('Format: HH-MM-SS')).toBeVisible();
    await field(page, 'Downloads').fill('120');
    await expect(save).toBeEnabled();
    await field(page, 'Uptime').fill('120');
    await field(page, 'Uptime').blur();
    await expect(page.getByText('Enter a value of at most 100.')).toBeVisible();
    await expect(field(page, 'Uptime')).toHaveAttribute('aria-invalid', 'true');
    await field(page, 'Uptime').fill('99.5');
    await expect(page.getByText('Enter a value of at most 100.')).toHaveCount(0);
    await field(page, 'Session length').fill('1:30');
    await field(page, 'Session length').blur();
    await expect(page.getByText('Use the format HH-MM-SS.')).toBeVisible();
    // A save with a field the page rejects sends nothing.
    seen.clear();
    await save.click();
    await expect(
      page.getByText('Some values need attention before they can be saved.'),
    ).toBeVisible();
    expect(seen.calls).toEqual([]);
    await field(page, 'Session length').fill('01-30-00');
    await field(page, 'Notes').fill('All fine');

    // One save is one call; the form is kept; the page says what happened.
    seen.clear();
    await save.click();
    await expect(page.getByText(/Saved .*: 4 added, 0 changed, 0 unchanged\./)).toBeVisible();
    expect(seen.calls).toEqual(['POST /kpi/ingestion/runs']);
    await expect(field(page, 'Downloads')).toHaveValue('120');
    test.info().annotations.push({ type: 'form: one save', description: seen.calls.join(' | ') });
    console.log(
      `[kpi-calls] form, one save: ${seen.calls.join(' | ')} (page loads: ${seen.loads.length})`,
    );

    // After a reload the stored values are filled in.
    await page.reload();
    await expect(field(page, 'Downloads')).toHaveValue('120');
    await expect(field(page, 'Uptime')).toHaveValue('99.5');
    await expect(field(page, 'Session length')).toHaveValue('01-30-00');
    await expect(field(page, 'Notes')).toHaveValue('All fine');
    expect(await stored(w.api, w.service.id, w.current)).toMatchObject({
      [w.indicators.downloads]: '120',
      [w.indicators.uptime]: '99.5',
    });

    // The same month again with changed values: the stored ones are updated, the unchanged ones say so, and the form is not reset.
    await field(page, 'Downloads').fill('150');
    await field(page, 'Uptime').fill('98');
    await expect(page.getByText('There are unsaved values.')).toBeVisible();
    await save.click();
    await expect(page.getByText(/Saved .*: 0 added, 2 changed, 2 unchanged\./)).toBeVisible();
    await expect(field(page, 'Downloads')).toHaveValue('150');
    await page.reload();
    await expect(field(page, 'Downloads')).toHaveValue('150');
    await expect(field(page, 'Uptime')).toHaveValue('98');
    expect(await stored(w.api, w.service.id, w.current)).toMatchObject({
      [w.indicators.downloads]: '150',
      [w.indicators.uptime]: '98',
    });

    // Another month has its own values (none yet). The months are the server's: the first is the current one, and none is later.
    const months = page.getByLabel('Month', { exact: true });
    await expect(months).toHaveValue(w.current);
    await expect(months.locator('option').first()).toHaveAttribute('value', w.current);
    await expect(months.locator('option')).toHaveCount(36);
    await months.selectOption(w.previous);
    await page.getByRole('button', { name: 'Show month' }).click();
    await expect(page).toHaveURL(new RegExp(`period=${w.previous}`));
    await expect(field(page, 'Downloads')).toHaveValue('');
    await expect(save).toBeDisabled();

    // The history lists the two saves and the coverage the months.
    await page.getByRole('tab', { name: 'History' }).click();
    const runs = page.getByRole('table', { name: 'Recent reports' });
    await expect(runs.getByRole('row')).toHaveCount(3);
    await expect(runs.getByText('Recorded')).toHaveCount(2);
    await expect(runs.getByText('You')).toHaveCount(2);
    await expect(runs.getByText('Form')).toHaveCount(2);
    const coverage = page.getByRole('table', { name: 'The last 12 months' });
    await expect(coverage.getByRole('row')).toHaveCount(13);
    await expect(coverage.getByText('Complete')).toHaveCount(1);
    await expect(coverage.getByText('Mandatory values missing')).toHaveCount(11);
    await opened.close();
    await w.api.dispose();
  });

  test('a link opens the page on the service and the month, and a month that has not come is not offered', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    await page.goto(at(`/submit?service=${w.service.id}&period=${w.previous}`));
    await expect(page.getByLabel('Month', { exact: true })).toHaveValue(w.previous);
    // A month later than the server's current one falls back to the current month; so does a thing that is no month.
    await page.goto(at(`/submit?service=${w.service.id}&period=2999-01`));
    await expect(page.getByLabel('Month', { exact: true })).toHaveValue(w.current);
    await page.goto(at(`/submit?service=${w.service.id}&period=soon`));
    await expect(page.getByLabel('Month', { exact: true })).toHaveValue(w.current);
    // A month older than the list is still open to a correction.
    await page.goto(at(`/submit?service=${w.service.id}&period=2015-03`));
    await expect(page.getByLabel('Month', { exact: true })).toHaveValue('2015-03');
    await opened.close();
    await w.api.dispose();
  });
});

test.describe('journey: a person of another provider', () => {
  test('does not find the service in the picker and is refused on a direct call [ASVS-8.2.1] [ASVS-8.3.1]', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    // The stranger has a service of their own, so the picker is not empty for them.
    const theirs = await w.api.send('POST', '/services', {
      slug: `${w.tag}-theirs`,
      name: `${w.tag} theirs service`,
      provider: w.elsewhere.id,
    });
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
    const opened = await pageAs(browser, baseURL, at, w.stranger);
    const page = opened.page;
    await page.goto(at('/submit'));
    const picker = page.getByLabel('Service', { exact: true });
    await expect(picker.locator('option')).toHaveCount(1);
    await expect(picker).toContainText(`${w.tag} theirs service`);
    await expect(picker).not.toContainText(w.service.name);
    // The search does not find it either.
    await page.getByLabel('Search services').fill(w.service.slug);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByText('No service you can report for matches this search.'),
    ).toBeVisible();

    // The address of the service is a 403, not a page.
    const response = await page.goto(at(`/submit?service=${w.service.id}`));
    expect(response?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Reporting for', level: 2 })).toHaveCount(0);

    // A direct call to the API is refused the same way: the history, a form and a file.
    const api = await apiAs(playwright, baseURL, at, w.stranger);
    const history = await api.request.get(
      at(`/api/internal/kpi/ingestion/runs?service=${w.service.id}`),
    );
    expect(history.status()).toBe(403);
    const write = await api.send('POST', '/kpi/ingestion/runs', {
      serviceId: w.service.id,
      form: { period: w.current, values: { [w.indicators.downloads]: '1' } },
    });
    expect(write.status).toBe(403);
    const template = await api.request.get(
      at(`/api/internal/kpi/ingestion/template?service=${w.service.id}&format=csv`),
    );
    expect(template.status()).toBe(403);
    expect(await stored(w.api, w.service.id, w.current)).toEqual({});
    await api.dispose();
    await opened.close();
    await w.api.dispose();
  });

  test('with no service of their own sees a page that says so, and no way to report', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.stranger);
    await opened.page.goto(at('/submit'));
    await expect(opened.page.getByText('There is no service you can report for')).toBeVisible();
    await expect(opened.page.getByRole('link', { name: 'Your organisations' })).toHaveAttribute(
      'href',
      at('/account/organisations'),
    );
    await expect(opened.page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
    await expect(opened.page.getByRole('tab')).toHaveCount(0);
    await opened.close();
    await w.api.dispose();
  });
});

test.describe('journey: a member reports from a file', () => {
  test('the same data from a CSV file and from an XLSX file gives the same values', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const viaXlsx = await w.makeService('xlsx');
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    const seen = watch(page);
    const table = tableOf(w);

    // The CSV file: the preview proposes the mapping from the headings, and the check says what would be recorded.
    await openService(page, at, w);
    await page.getByRole('tab', { name: 'File' }).click();
    seen.clear();
    await page.locator('input[type=file]').setInputFiles({
      name: 'data.csv',
      mimeType: CSV_TYPE,
      buffer: Buffer.from(csvOf(w, table)),
    });
    await expect(page.getByText('7 to add, 0 to change, 0 unchanged, 0 rejected.')).toBeVisible();
    await expect(page.getByText('The file was read as CSV or TSV file.')).toBeVisible();
    await expect(page.getByText('Nothing is rejected. You can record the values.')).toBeVisible();
    // The file is one preview and one dry run.
    expect(seen.calls).toEqual(['POST /kpi/ingestion/preview', 'POST /kpi/ingestion/runs']);
    test
      .info()
      .annotations.push({ type: 'file: a file chosen', description: seen.calls.join(' | ') });
    console.log(`[kpi-calls] file, one file chosen: ${seen.calls.join(' | ')}`);
    // Every column has its target in a select, in words; nothing is left to map.
    await expect(page.getByLabel(`What column 1 (Period) holds`)).toHaveValue('period');
    await expect(page.getByLabel(`What column 2 (${w.names.downloads}) holds`)).toHaveValue(
      w.indicators.downloads,
    );
    await expect(page.getByText(/Still to map/)).toHaveCount(0);
    await expect(page.getByText('will be added').first()).toBeVisible();
    seen.clear();
    await page.getByRole('button', { name: 'Record the values' }).click();
    await expect(page.getByText('Recorded: 7 added, 0 changed, 0 unchanged.')).toBeVisible();
    expect(seen.calls).toEqual(['POST /kpi/ingestion/runs']);
    console.log(`[kpi-calls] file, one commit: ${seen.calls.join(' | ')}`);
    test.info().annotations.push({ type: 'file: one commit', description: seen.calls.join(' | ') });

    // The XLSX file with the same table, for the second service.
    await openService(page, at, w, viaXlsx.id);
    await page.getByRole('tab', { name: 'File' }).click();
    const workbook = await writeExcelFile(
      sheet(
        ['Period', w.names.downloads, w.names.uptime, w.names.session, w.names.notes],
        table,
      ) as never,
      { sheet: 'Data' },
    ).toBuffer();
    await page.locator('input[type=file]').setInputFiles({
      name: 'data.xlsx',
      mimeType: XLSX_TYPE,
      buffer: workbook,
    });
    await expect(page.getByText('The file was read as Excel workbook (XLSX).')).toBeVisible();
    await expect(page.getByText('7 to add, 0 to change, 0 unchanged, 0 rejected.')).toBeVisible();
    await page.getByRole('button', { name: 'Record the values' }).click();
    await expect(page.getByText('Recorded: 7 added, 0 changed, 0 unchanged.')).toBeVisible();

    // The values are the same in both services, month by month, and equal what was sent.
    for (const month of [w.previous, w.current]) {
      const fromCsv = await stored(w.api, w.service.id, month);
      const fromXlsx = await stored(w.api, viaXlsx.id, month);
      expect(fromXlsx, month).toEqual(fromCsv);
      expect(Object.keys(fromCsv).length).toBeGreaterThanOrEqual(3);
    }
    expect(await stored(w.api, w.service.id, w.previous)).toEqual({
      [w.indicators.downloads]: '10',
      [w.indicators.uptime]: '99.5',
      [w.indicators.session]: '00-45-00',
      [w.indicators.notes]: 'fine',
    });

    // The history of the CSV service lists the run, with the file name and the way, and the other lists its own.
    await openService(page, at, w);
    await page.getByRole('tab', { name: 'History' }).click();
    const runs = page.getByRole('table', { name: 'Recent reports' });
    await expect(runs.getByRole('row')).toHaveCount(2);
    await expect(runs.getByText('data.csv')).toBeVisible();
    await expect(runs.getByText('CSV or TSV file')).toBeVisible();
    await opened.close();
    await w.api.dispose();
  });

  test('a file with a bad cell shows the row and the reason and cannot be committed', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    const seen = watch(page);
    await openService(page, at, w);
    await page.getByRole('tab', { name: 'File' }).click();

    // Row 2 has a word where the number goes, and row 3 has no value for the mandatory indicator.
    const bad = csvOf(w, [
      [w.previous, 'abc', '99.5', '', ''],
      [w.current, '', '98', '', ''],
    ]);
    await page.locator('input[type=file]').setInputFiles({
      name: 'bad.csv',
      mimeType: CSV_TYPE,
      buffer: Buffer.from(bad),
    });
    await expect(page.getByText('What needs to be fixed')).toBeVisible();
    await expect(
      page.getByText('Row 2, column 2: The value is not valid for this indicator.'),
    ).toBeVisible();
    await expect(
      page.getByText('Row 3, column 2: A mandatory indicator has no value here.'),
    ).toBeVisible();
    // The cell is marked in words as well as colour, and the verdict of the other values is shown.
    await expect(
      page
        .getByRole('cell', { name: /abc/ })
        .getByText('Invalid: The value is not valid for this indicator.'),
    ).toBeVisible();
    await expect(page.getByText('cannot be recorded').first()).toBeVisible();
    await expect(page.getByText(/Nothing is recorded while any value is rejected/)).toBeVisible();
    const commit = page.getByRole('button', { name: 'Record the values' });
    await expect(commit).toBeDisabled();
    expect(await stored(w.api, w.service.id, w.previous)).toEqual({});

    // A change of the mapping sends nothing; the check is one call and names what is missing in words.
    seen.clear();
    await page
      .getByLabel(`What column 2 (${w.names.downloads}) holds`)
      .selectOption({ label: 'Not used' });
    await expect(
      page.getByText('You changed the mapping. Check the file again to see the result.'),
    ).toBeVisible();
    expect(seen.calls).toEqual([]);
    await page.getByRole('button', { name: 'Check the file' }).click();
    await expect(
      page.getByText('A required column is not mapped: the period, or a mandatory indicator.'),
    ).toBeVisible();
    expect(seen.calls).toEqual(['POST /kpi/ingestion/runs']);
    await expect(commit).toBeDisabled();
    test.info().annotations.push({
      type: 'file: a mapping changed, then checked',
      description: seen.calls.join(' | '),
    });
    console.log(
      `[kpi-calls] file, a mapping changed then checked: ${seen.calls.join(' | ') || 'none'}`,
    );

    // A target belongs to one column: the select of another column shows it as taken.
    await expect(
      page
        .getByLabel(`What column 3 (${w.names.uptime}) holds`)
        .getByRole('option', { name: /^Period \(month\) \(used by column 1\)$/ }),
    ).toBeDisabled();

    // Nothing was ever recorded.
    expect(await stored(w.api, w.service.id, w.previous)).toEqual({});
    expect(await stored(w.api, w.service.id, w.current)).toEqual({});
    await opened.close();
    await w.api.dispose();
  });

  test('the template downloads, is filled in and uploads unchanged; an XLSX template reads back too', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    const seen = watch(page);
    await openService(page, at, w);
    await page.getByRole('tab', { name: 'File' }).click();

    // The CSV template: one call, a file with the headings of the service (the unit's key, a star for a mandatory one) and an example row.
    seen.clear();
    const csvDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download the CSV template' }).click();
    const csvFile = await csvDownload;
    expect(csvFile.suggestedFilename()).toBe(`${w.service.slug}-import-template.csv`);
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]).toMatch(/^GET \/kpi\/ingestion\/template\?service=.*&format=csv$/);
    console.log(`[kpi-calls] file, one template: ${seen.calls.join(' | ')}`);
    test
      .info()
      .annotations.push({ type: 'file: one template', description: seen.calls.join(' | ') });
    const text = (await readFile(await csvFile.path(), 'utf8')).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((line) => line !== '');
    // The columns are the effective KPI set in the order of the grid (the rows of the set by name, then the extras).
    const header = lines[0]!.split(',');
    expect(header).toEqual([
      'Period',
      `${w.names.downloads} (count) *`,
      w.names.notes,
      `${w.names.session} (second)`,
      `${w.names.uptime} (percent)`,
    ]);
    expect(lines).toHaveLength(2);
    const example = lines[1]!.split(',')[0]!;
    expect(example).toMatch(/^\d{4}-\d{2}$/);

    // Filled in and uploaded as it is (the headings untouched): every column is matched, and the values are recorded.
    const valueOf = (column: string) =>
      column.startsWith('Downloads')
        ? '5'
        : column.startsWith('Uptime')
          ? '97.5'
          : column.startsWith('Session')
            ? '00-10-00'
            : 'ok';
    const filled = [lines[0], [example, ...header.slice(1).map(valueOf)].join(',')].join('\n');
    await page.locator('input[type=file]').setInputFiles({
      name: 'filled.csv',
      mimeType: CSV_TYPE,
      buffer: Buffer.from(filled),
    });
    await expect(page.getByText('4 to add, 0 to change, 0 unchanged, 0 rejected.')).toBeVisible();
    await expect(page.getByText(/Still to map/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Record the values' }).click();
    await expect(page.getByText('Recorded: 4 added, 0 changed, 0 unchanged.')).toBeVisible();
    expect(await stored(w.api, w.service.id, example)).toEqual({
      [w.indicators.downloads]: '5',
      [w.indicators.uptime]: '97.5',
      [w.indicators.session]: '00-10-00',
      [w.indicators.notes]: 'ok',
    });

    // The empty template uploads as it is too: it reads, every column is matched, and it holds no values to record.
    await page.locator('input[type=file]').setInputFiles({
      name: 'empty.csv',
      mimeType: CSV_TYPE,
      buffer: Buffer.from(text),
    });
    await expect(
      page.getByText('The file holds no values to record.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record the values' })).toBeDisabled();

    // The XLSX template: a workbook, read back as one with the same columns matched.
    const xlsxDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download the XLSX template' }).click();
    const xlsxFile = await xlsxDownload;
    expect(xlsxFile.suggestedFilename()).toBe(`${w.service.slug}-import-template.xlsx`);
    const bytes = await readFile(await xlsxFile.path());
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    await page.locator('input[type=file]').setInputFiles({
      name: 'template.xlsx',
      mimeType: XLSX_TYPE,
      buffer: bytes,
    });
    await expect(page.getByText('The file was read as Excel workbook (XLSX).')).toBeVisible();
    await expect(
      page.getByLabel(`What column 2 (${w.names.downloads} (count) *) holds`),
    ).toHaveValue(w.indicators.downloads);
    await expect(page.getByText(/Still to map/)).toHaveCount(0);
    await opened.close();
    await w.api.dispose();
  });

  test('the file button does what the drop zone does, and a file the page cannot use is turned away before it is sent', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    const seen = watch(page);
    await openService(page, at, w);
    await page.getByRole('tab', { name: 'File' }).click();
    await expect(
      page.getByText(/Accepted: \.csv, \.tsv, \.txt, \.xlsx\. At most 2 MiB\./),
    ).toBeVisible();

    // The keyboard path: the button opens the file chooser.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a file' }).click();
    const picked = await chooser;
    seen.clear();
    await picked.setFiles({ name: 'empty.csv', mimeType: CSV_TYPE, buffer: Buffer.alloc(0) });
    await expect(page.getByText('The file is empty.')).toBeVisible();
    await picked
      .page()
      .locator('input[type=file]')
      .setInputFiles({
        name: 'big.csv',
        mimeType: CSV_TYPE,
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 'a'),
      });
    await expect(page.getByText('The file is larger than 2 MiB.')).toBeVisible();
    expect(seen.calls).toEqual([]);

    // A file that is not a table is the server's answer, in the page's words.
    await page.locator('input[type=file]').setInputFiles({
      name: 'photo.csv',
      mimeType: CSV_TYPE,
      buffer: Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x81]),
    });
    await expect(page.getByText('What needs to be fixed')).toBeVisible();
    await expect(page.getByText(/File: .*(UTF-8|table)/)).toBeVisible();
    await opened.close();
    await w.api.dispose();
  });
});

// The calls the page makes (plan §8 item 7): the loader runs on the server, so the browser sends nothing on arrival; a month or a service is a page
// load (`__data.json`), not a call to the API; a save, a preview and a check are one call each.
test.describe('the calls the page makes', () => {
  test('are none on arrival or when the month changes, and one for each save, preview, check and commit', async ({
    browser,
    playwright,
    baseURL,
    at,
  }) => {
    test.slow();
    const w = await world(playwright, baseURL, at);
    const opened = await pageAs(browser, baseURL, at, w.member);
    const page = opened.page;
    // Signing in left the person on the start page, whose widgets may still be reading: leave it, so only this page's arrival is counted.
    await page.goto('about:blank');
    const seen = watch(page);

    await page.goto(at(`/submit?service=${w.service.id}`));
    await expect(field(page, 'Downloads')).toBeVisible();
    const onArrival = [...seen.calls];
    console.log(
      `[kpi-calls] arrival on a service (a full page load): ${onArrival.join(' | ') || 'none'}`,
    );
    test.info().annotations.push({ type: 'arrival', description: onArrival.join(' | ') || 'none' });
    // The shell may read what it needs for the page around (the account, the navigation); the page itself reads nothing.
    expect(onArrival.filter((call) => /\/kpi\/|\/vocabularies\/|\/services\//.test(call))).toEqual(
      [],
    );

    seen.clear();
    await page.getByLabel('Month', { exact: true }).selectOption(w.previous);
    await page.getByRole('button', { name: 'Show month' }).click();
    await expect(page).toHaveURL(new RegExp(`period=${w.previous}`));
    await expect(field(page, 'Downloads')).toHaveValue('');
    const onMonth = [...seen.calls];
    console.log(
      `[kpi-calls] a month shown (a client navigation): ${onMonth.join(' | ') || 'none'} (page loads: ${seen.loads.length})`,
    );
    test.info().annotations.push({
      type: 'a month shown',
      description: `${onMonth.join(' | ') || 'none'}; page loads: ${seen.loads.length}`,
    });
    expect(onMonth).toEqual([]);
    expect(seen.loads).toHaveLength(1);

    // No call per keystroke: typing in every field sends nothing.
    seen.clear();
    await field(page, 'Downloads').pressSequentially('1234', { delay: 20 });
    await field(page, 'Uptime').pressSequentially('55.5', { delay: 20 });
    await field(page, 'Notes').pressSequentially('typed by hand', { delay: 20 });
    expect(seen.calls).toEqual([]);

    // A visit to another tab does not lose what was typed.
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('tab', { name: 'Form' }).click();
    await expect(field(page, 'Downloads')).toHaveValue('1234');
    await expect(field(page, 'Notes')).toHaveValue('typed by hand');
    expect(seen.calls).toEqual([]);
    await opened.close();
    await w.api.dispose();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the Data Submission page, ${scheme} theme`, () => {
    test('has no serious violation: the empty page, the form, the file preview with errors, the run result and the history', async ({
      browser,
      playwright,
      baseURL,
      at,
    }) => {
      test.slow();
      const w = await world(playwright, baseURL, at);
      const clean = async (page: Page, what: string) =>
        expect(await violations(page), what).toEqual([]);
      const as = async (who: ReturnType<typeof newPerson>, browserOf: Browser = browser) => {
        const opened = await pageAs(browserOf, baseURL, at, who);
        await opened.page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        return opened;
      };

      // The empty page: a person with no service to report for.
      const stranger = await as(w.stranger);
      await stranger.page.goto(at('/submit'));
      await expect(stranger.page.getByText('There is no service you can report for')).toBeVisible();
      await clean(stranger.page, 'the empty page');
      await stranger.close();

      const opened = await as(w.member);
      const page = opened.page;

      // The picker with a service chosen, the form, with an error shown and with values saved.
      await page.goto(at('/submit'));
      await clean(page, 'the picker');
      await openService(page, at, w);
      await clean(page, 'the form, empty');
      await field(page, 'Downloads').fill('12');
      await field(page, 'Uptime').fill('120');
      await field(page, 'Uptime').blur();
      await expect(page.getByText('Enter a value of at most 100.')).toBeVisible();
      await clean(page, 'the form with an error under a field');
      await field(page, 'Uptime').fill('90');
      await page.getByRole('button', { name: 'Save values' }).click();
      await expect(page.getByText(/Saved .*: 2 added/)).toBeVisible();
      await clean(page, 'the form after a save');

      // The file tab, empty, then a preview with errors, then the result of a good file.
      await page.getByRole('tab', { name: 'File' }).click();
      await clean(page, 'the file tab, empty');
      await page.locator('input[type=file]').setInputFiles({
        name: 'bad.csv',
        mimeType: CSV_TYPE,
        buffer: Buffer.from(
          csvOf(w, [
            [w.previous, 'abc', '99.5', '', ''],
            [w.current, '', '98', '', ''],
          ]),
        ),
      });
      await expect(page.getByText('What needs to be fixed')).toBeVisible();
      await clean(page, 'the file preview with errors');
      await page.locator('input[type=file]').setInputFiles({
        name: 'good.csv',
        mimeType: CSV_TYPE,
        buffer: Buffer.from(csvOf(w, tableOf(w).slice(0, 1))),
      });
      await expect(page.getByText('4 to add, 0 to change, 0 unchanged, 0 rejected.')).toBeVisible();
      await clean(page, 'the file preview, checked');
      await page.getByRole('button', { name: 'Record the values' }).click();
      await expect(page.getByText('Recorded: 4 added, 0 changed, 0 unchanged.')).toBeVisible();
      await clean(page, 'the run result');

      // The history.
      await page.getByRole('tab', { name: 'History' }).click();
      await expect(page.getByRole('table', { name: 'Recent reports' })).toBeVisible();
      await clean(page, 'the history');
      await opened.close();
      await w.api.dispose();
    });
  });
}
