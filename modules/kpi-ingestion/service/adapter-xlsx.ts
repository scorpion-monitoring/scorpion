// The XLSX adapter (ADR-0041 decision 2). `read-excel-file`'s `node` entry (it parses in a worker thread and takes a Buffer; chosen
// over `universal`, which blocks the calling thread, was about 25% slower and cannot take a Buffer) reads the first sheet, or the one
// named; it reads the cached value of a formula and never evaluates it, and follows no external link. The reader is only ever called
// with bytes that passed `guardXlsx`. A date cell becomes `YYYY-MM-DD`, a number its shortest text, so a workbook, a CSV and a form
// with the same data give the same rows. The template is written with `write-excel-file`.
import { readSheet } from 'read-excel-file/node';
import writeExcelFile from 'write-excel-file/node';
import { failed, fromTable, type AdapterEntry } from './adapters.ts';
import { MAX_COLUMNS, MAX_DATA_ROWS, MAX_FIELD_LENGTH } from './csv.ts';
import type { Table, TableProblem } from './table.ts';
import { guardXlsx } from './xlsx-guard.ts';

/** `PK\x03\x04` (a zip, so a workbook) or the OLE2 header (an old or password-protected workbook, which the guard then refuses). */
function looksLikeWorkbook(bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  return zip || ole;
}

/** A cell as text; `undefined` for a kind of cell that is no value (a boolean). */
function cellText(cell: unknown): string | undefined {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : undefined;
  if (cell instanceof Date)
    return Number.isNaN(cell.getTime()) ? undefined : cell.toISOString().slice(0, 10);
  return undefined;
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : '');

export const xlsxAdapter: AdapterEntry = {
  id: 'xlsx',
  labels: { en: 'Excel workbook (XLSX)', de: 'Excel-Arbeitsmappe (XLSX)' },
  input: 'file',
  accepts: {
    extensions: ['xlsx'],
    mediaTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  sniff: looksLikeWorkbook,
  async parse(input, context) {
    const bytes = input.bytes ?? new Uint8Array();
    const guarded = guardXlsx(bytes);
    if (!guarded.ok) return failed([{ row: 0, column: 0, code: guarded.code }]);

    let data: unknown[][];
    try {
      data = (await readSheet(Buffer.from(bytes), input.sheet)) as unknown[][];
    } catch (error) {
      const code = errorName(error) === 'SheetNotFoundError' ? 'sheet-not-found' : 'format';
      return failed([{ row: 0, column: 0, code }]);
    }

    const problems: TableProblem[] = [];
    const note = (problem: TableProblem) => {
      if (problems.length < 100) problems.push(problem);
    };
    if (data.length === 0) return failed([{ row: 0, column: 0, code: 'empty-file' }]);
    if (data.length > MAX_DATA_ROWS + 1) {
      note({ row: MAX_DATA_ROWS + 2, column: 0, code: 'too-many-rows' });
      data = data.slice(0, MAX_DATA_ROWS + 1);
    }
    const width = Math.max(...data.map((row) => row.length));
    if (width > MAX_COLUMNS) {
      note({ row: 1, column: MAX_COLUMNS + 1, code: 'too-many-columns' });
      data = data.map((row) => row.slice(0, MAX_COLUMNS));
    }
    const columns = Math.min(width, MAX_COLUMNS);

    const text = (row: number, column: number, cell: unknown): string => {
      const value = cellText(cell);
      if (value === undefined) {
        note({ row, column, code: 'cell-type' });
        return '';
      }
      if (value.length > MAX_FIELD_LENGTH) {
        note({ row, column, code: 'field-too-long' });
        return value.slice(0, MAX_FIELD_LENGTH);
      }
      return value;
    };
    const line = (cells: unknown[], row: number) =>
      Array.from({ length: columns }, (_, index) => text(row, index + 1, cells[index]));

    const table: Table = {
      header: line(data[0]!, 1),
      rows: data.slice(1).map((cells, index) => line(cells, index + 2)),
      rowNumbers: data.slice(1).map((_, index) => index + 2),
    };
    return fromTable(table, problems, input, context);
  },
  template: {
    extension: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    async write(rows) {
      // Every cell is a text cell: `@` keeps Excel from turning `2026-05` into a date.
      const sheet = rows.map((row) => row.map((value) => ({ value, type: String, format: '@' })));
      return new Uint8Array(await writeExcelFile(sheet as never).toBuffer());
    },
  },
};
