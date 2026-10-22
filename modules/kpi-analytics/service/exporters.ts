// The registry `analytics.exporter` of kpi.analytics (M11 sprint 5, ADR-0043 decision 8): a file format for the table of a series. The module
// contributes CSV and XLSX; another module adds a format by contributing an entry. Entries are validated by a Zod schema at start, and two with
// one id stop the start.
import { z } from '@scorpion/contracts';
import { writeCsv } from '@scorpion/kpi-ingestion/public';
import writeExcelFile from 'write-excel-file/node';
import type { Cell, ExportTable } from './export-table.ts';

export const EXPORTER_REGISTRY = 'analytics.exporter';

const key = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a lower-case key')
  .max(32);

/**
 * An exporter: `id` is the value of `format` in the route. `write` takes the table and returns the bytes; it never throws for a valid table.
 * `extension` has no dot; the file's name is the service's abbreviation plus this.
 */
export const exporterEntrySchema = z.strictObject({
  id: key,
  labels: z.strictObject({
    en: z.string().min(1).max(100),
    de: z.string().min(1).max(100).optional(),
  }),
  extension: z.string().regex(/^[a-z0-9]{1,8}$/, 'must be a short lower-case extension'),
  mediaType: z
    .string()
    .regex(/^[a-z]+\/[a-z0-9.+-]+(; charset=[a-z0-9-]+)?$/i, 'must be a media type'),
  write: z.custom<(table: ExportTable) => Uint8Array | Promise<Uint8Array>>(
    (value) => typeof value === 'function',
    { message: 'expected a function' },
  ),
});
export type ExporterEntry = z.output<typeof exporterEntrySchema>;

const BOM = '﻿';

/** CSV: UTF-8 with a byte order mark (a spreadsheet then reads the umlauts), as the import templates are. A gap is an empty field. */
export const csvExporter: ExporterEntry = {
  id: 'csv',
  labels: { en: 'CSV', de: 'CSV' },
  extension: 'csv',
  mediaType: 'text/csv; charset=utf-8',
  write: (table) =>
    new TextEncoder().encode(
      BOM +
        writeCsv([
          table.header,
          ...table.rows.map((row) => row.map((cell) => (cell === null ? '' : String(cell)))),
        ]),
    ),
};

/**
 * XLSX: text cells with the text format `@` for the headings and for text, so Excel does not turn `2026-05` into a date; a number is a number
 * cell; a gap is an empty cell.
 */
export const xlsxExporter: ExporterEntry = {
  id: 'xlsx',
  labels: { en: 'XLSX', de: 'XLSX' },
  extension: 'xlsx',
  mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  async write(table) {
    const text = (value: string) => ({ value, type: String, format: '@' });
    const cell = (value: Cell) =>
      value === null ? null : typeof value === 'number' ? { value, type: Number } : text(value);
    const sheet = [table.header.map(text), ...table.rows.map((row) => row.map(cell))];
    return new Uint8Array(await writeExcelFile(sheet as never).toBuffer());
  },
};

export const BUILTIN_EXPORTERS: ExporterEntry[] = [csvExporter, xlsxExporter];
