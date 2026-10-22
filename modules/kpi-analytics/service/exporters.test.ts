// The two exporters on their own (M11 sprint 5): the CSV with its byte order mark and quoting, and the XLSX read back with `read-excel-file`.
import { parseCsv } from '@scorpion/kpi-ingestion/public';
import { readSheet } from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import { buildTable } from './export-table.ts';
import { csvExporter, exporterEntrySchema, xlsxExporter } from './exporters.ts';

const table = buildTable([
  {
    name: 'Größe, "quoted"',
    unit: 'Prozent',
    points: [
      { period: '2026-01-31', value: 12.5, text: null },
      { period: '2026-03-31', value: -3, text: null },
    ],
  },
  {
    name: '=HYPERLINK("x")',
    unit: null,
    points: [{ period: '2026-02-28', value: null, text: 'all well' }],
  },
]);

describe('the CSV exporter', () => {
  it('writes UTF-8 with a byte order mark, quotes what needs it, and leaves a gap empty', async () => {
    const bytes = await csvExporter.write(table);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text).toBe(
      '\uFEFFKPI,Unit,2026-01,2026-02,2026-03\r\n' +
        '"Größe, ""quoted""",Prozent,12.5,,-3\r\n' +
        '"\'=HYPERLINK(""x"")",,,all well,\r\n',
    );
    // and it parses back to the same cells
    const parsed = parseCsv(text, { delimiter: ',' });
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toEqual([
      ['KPI', 'Unit', '2026-01', '2026-02', '2026-03'],
      ['Größe, "quoted"', 'Prozent', '12.5', '', '-3'],
      ['\'=HYPERLINK("x")', '', '', 'all well', ''],
    ]);
  });
});

describe('the XLSX exporter', () => {
  it('is read back with the same numbers, the months as text and the gaps empty', async () => {
    const bytes = await xlsxExporter.write(table);
    // a workbook is a zip
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const rows = await readSheet(Buffer.from(bytes));
    expect(rows[0]).toEqual(['KPI', 'Unit', '2026-01', '2026-02', '2026-03']);
    expect(rows[1]).toEqual(['Größe, "quoted"', 'Prozent', 12.5, null, -3]);
    // the injection is neutralised and a text value stays text
    expect(rows[2]).toEqual(['\'=HYPERLINK("x")', null, null, 'all well', null]);
    // a month is a string, never a date
    for (const heading of rows[0]!.slice(2)) expect(typeof heading).toBe('string');
  });
});

describe('the entry schema', () => {
  const entry = { ...csvExporter };
  it('takes the built-in entries', () => {
    expect(exporterEntrySchema.safeParse(csvExporter).success).toBe(true);
    expect(exporterEntrySchema.safeParse(xlsxExporter).success).toBe(true);
  });
  it.each([
    ['an id that is not a key', { ...entry, id: 'Not A Key' }],
    ['an extension with a dot', { ...entry, extension: '.csv' }],
    ['a media type that is none', { ...entry, mediaType: 'csv' }],
    ['a write that is not a function', { ...entry, write: 'x' }],
    ['no English label', { ...entry, labels: { de: 'CSV' } }],
    ['an unknown field', { ...entry, extra: 1 }],
  ])('refuses %s', (_name, bad) => {
    expect(exporterEntrySchema.safeParse(bad).success).toBe(false);
  });
});
