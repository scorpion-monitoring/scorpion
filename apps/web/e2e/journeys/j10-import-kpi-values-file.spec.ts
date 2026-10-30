import { readFile } from 'node:fs/promises';
import writeExcelFile from 'write-excel-file/node';
import { expect, test } from '../support/fixtures.ts';
import { pageAs } from '../support/members.ts';
import {
  CSV_TYPE,
  csvOf,
  openService,
  sheet,
  stored,
  tableOf,
  watch,
  world,
  XLSX_TYPE,
} from '../support/submission.ts';

// J10: import KPI values from a CSV or XLSX file. Moved from data-submission.spec.ts with every assertion: the same data from a
// CSV file and from an XLSX file, and the import template. What the browser sends itself is counted and written into the report.
test.describe('J10: import KPI values from a CSV or XLSX file', () => {
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

    await test.step('Open the File tab of your service', async () => {
      await openService(page, at, w);
      await page.getByRole('tab', { name: 'File' }).click();
    });
    await test.step('Choose a CSV file and read the preview', async () => {
      // The CSV file: the preview proposes the mapping from the headings, and the check says what would be recorded.
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
    });
    await test.step('Check that every column is matched to an indicator', async () => {
      // Every column has its target in a select, in words; nothing is left to map.
      await expect(page.getByLabel(`What column 1 (Period) holds`)).toHaveValue('period');
      await expect(page.getByLabel(`What column 2 (${w.names.downloads}) holds`)).toHaveValue(
        w.indicators.downloads,
      );
      await expect(page.getByText(/Still to map/)).toHaveCount(0);
      await expect(page.getByText('will be added').first()).toBeVisible();
    });
    await test.step('Record the values', async () => {
      seen.clear();
      await page.getByRole('button', { name: 'Record the values' }).click();
      await expect(page.getByText('Recorded: 7 added, 0 changed, 0 unchanged.')).toBeVisible();
      expect(seen.calls).toEqual(['POST /kpi/ingestion/runs']);
      console.log(`[kpi-calls] file, one commit: ${seen.calls.join(' | ')}`);
      test
        .info()
        .annotations.push({ type: 'file: one commit', description: seen.calls.join(' | ') });
    });

    await test.step('Choose an XLSX file with the same table for a second service and record it', async () => {
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
    });

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

    await test.step('Read the history of the CSV import', async () => {
      // The history of the CSV service lists the run, with the file name and the way, and the other lists its own.
      await openService(page, at, w);
      await page.getByRole('tab', { name: 'History' }).click();
      const runs = page.getByRole('table', { name: 'Recent reports' });
      await expect(runs.getByRole('row')).toHaveCount(2);
      await expect(runs.getByText('data.csv')).toBeVisible();
      await expect(runs.getByText('CSV or TSV file')).toBeVisible();
    });
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
    await test.step('Open the File tab of your service', async () => {
      await openService(page, at, w);
      await page.getByRole('tab', { name: 'File' }).click();
    });

    let text = '';
    let lines: string[] = [];
    let header: string[] = [];
    let example = '';
    await test.step('Download the CSV template', async () => {
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
      text = (await readFile(await csvFile.path(), 'utf8')).replace(/^\uFEFF/, '');
      lines = text.split(/\r?\n/).filter((line) => line !== '');
      // The columns are the effective KPI set in the order of the grid (the rows of the set by name, then the extras).
      header = lines[0]!.split(',');
      expect(header).toEqual([
        'Period',
        `${w.names.downloads} (count) *`,
        w.names.notes,
        `${w.names.session} (second)`,
        `${w.names.uptime} (percent)`,
      ]);
      expect(lines).toHaveLength(2);
      example = lines[1]!.split(',')[0]!;
      expect(example).toMatch(/^\d{4}-\d{2}$/);
    });

    await test.step('Fill in the template and upload it unchanged', async () => {
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
    });
    await test.step('Record the values', async () => {
      await page.getByRole('button', { name: 'Record the values' }).click();
      await expect(page.getByText('Recorded: 4 added, 0 changed, 0 unchanged.')).toBeVisible();
      expect(await stored(w.api, w.service.id, example)).toEqual({
        [w.indicators.downloads]: '5',
        [w.indicators.uptime]: '97.5',
        [w.indicators.session]: '00-10-00',
        [w.indicators.notes]: 'ok',
      });
    });

    await test.step('Upload the empty template and find nothing to record', async () => {
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
    });

    await test.step('Download the XLSX template and upload it', async () => {
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
    });
    await opened.close();
    await w.api.dispose();
  });
});
