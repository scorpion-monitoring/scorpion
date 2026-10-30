import { pageAs } from '../support/members.ts';
import { expect, test } from '../support/fixtures.ts';
import { docShot } from '../support/doc-shot.ts';
import { field, stored, watch, world } from '../support/submission.ts';

// J09: submit a month of KPI values with the form. Moved from data-submission.spec.ts with every assertion. What the browser
// sends itself is counted and printed (`[kpi-calls]`) and written into the report.
test.describe('J09: submit a month of KPI values with the form', () => {
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
    const save = page.getByRole('button', { name: 'Save values' });

    await test.step('Pick your service on the Data Submission page and open it', async () => {
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
    });

    await test.step('Read the indicators in the groups mandatory, recommended and optional', async () => {
      // The groups carry the words of the vocabulary; the save stays disabled until the mandatory value is there.
      for (const group of ['Mandatory', 'Recommended', 'Optional'])
        await expect(page.getByRole('group', { name: group })).toBeVisible();
      await expect(save).toBeDisabled();
      await expect(page.getByText('Fill in every mandatory indicator to save.')).toBeVisible();
      await expect(
        page.getByRole('group', { name: 'Mandatory' }).getByLabel(/Downloads/),
      ).toBeVisible();
      await docShot(page, 'j09', 'form-groups');
    });

    await test.step('Enter the values and fix the ones the page rejects', async () => {
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
      await docShot(page, 'j09', 'form-with-problem');
    });
    await test.step('Try to save with a value the page rejects', async () => {
      // A save with a field the page rejects sends nothing.
      seen.clear();
      await save.click();
      await expect(
        page.getByText('Some values need attention before they can be saved.'),
      ).toBeVisible();
      expect(seen.calls).toEqual([]);
    });
    await test.step('Correct the value and add a note', async () => {
      await field(page, 'Session length').fill('01-30-00');
      await field(page, 'Notes').fill('All fine');
    });

    await test.step('Save the values', async () => {
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
    });

    await test.step('Reload the page and find the stored values', async () => {
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
    });

    await test.step('Change two values and save the same month again', async () => {
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
    });

    await test.step('Choose another month', async () => {
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
    });

    await test.step('Read the history and the coverage of the last months', async () => {
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
      await docShot(page, 'j09', 'history-and-coverage');
    });
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
    await test.step('Open a link that names the service and a month', async () => {
      await page.goto(at(`/submit?service=${w.service.id}&period=${w.previous}`));
      await expect(page.getByLabel('Month', { exact: true })).toHaveValue(w.previous);
    });
    await test.step('Open a link with a month that has not come, and land on the current month', async () => {
      // A month later than the server's current one falls back to the current month; so does a thing that is no month.
      await page.goto(at(`/submit?service=${w.service.id}&period=2999-01`));
      await expect(page.getByLabel('Month', { exact: true })).toHaveValue(w.current);
      await page.goto(at(`/submit?service=${w.service.id}&period=soon`));
      await expect(page.getByLabel('Month', { exact: true })).toHaveValue(w.current);
    });
    await test.step('Open a link with an old month and correct it', async () => {
      // A month older than the list is still open to a correction.
      await page.goto(at(`/submit?service=${w.service.id}&period=2015-03`));
      await expect(page.getByLabel('Month', { exact: true })).toHaveValue('2015-03');
    });
    await opened.close();
    await w.api.dispose();
  });
});
