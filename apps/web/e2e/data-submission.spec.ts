import type { Browser, Page } from '@playwright/test';
import { violations } from './support/a11y.ts';
import { apiAs, newPerson } from './support/admin.ts';
import { expect, test } from './support/fixtures.ts';
import { pageAs } from './support/members.ts';
import {
  CSV_TYPE,
  world,
  stored,
  csvOf,
  tableOf,
  openService,
  field,
  watch,
} from './support/submission.ts';

// M10 sprint 4: the Data Submission page. A member reports a month in the form, from a CSV file and from an XLSX file, sees what a file would do before
// anything is recorded, cannot commit a file with a bad cell, downloads the import template and uploads it again, and reads the history. A person of
// another provider cannot see the service. Every test makes its own data under names of its own (the specs of a run share one database), under both
// base paths, and axe runs in both themes. What the browser sends itself is counted and printed (`[kpi-calls]`) and written into the report.

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
