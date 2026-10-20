// The CSV and TSV adapter: bytes to text (UTF-8 only; a legacy encoding is a problem that says so), our own parser, then the shared
// mapping. The template is the same table written back with a BOM so that a spreadsheet opens the umlauts.
import { extensionOf, fromTable, failed, type AdapterEntry } from './adapters.ts';
import { parseCsv, writeCsv } from './csv.ts';
import type { Table, TableProblem } from './table.ts';

const BOM = '﻿';

/** Text, not a workbook or binary: no NUL in the first 8 kB and not a zip or an OLE2 file. */
function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 0x03 &&
    head[3] === 0x04
  )
    return false;
  if (
    head.length >= 4 &&
    head[0] === 0xd0 &&
    head[1] === 0xcf &&
    head[2] === 0x11 &&
    head[3] === 0xe0
  )
    return false;
  return !head.includes(0);
}

export const csvAdapter: AdapterEntry = {
  id: 'csv',
  labels: { en: 'CSV or TSV file', de: 'CSV- oder TSV-Datei' },
  input: 'file',
  accepts: {
    extensions: ['csv', 'tsv', 'txt'],
    mediaTypes: ['text/csv', 'text/tab-separated-values', 'text/plain', 'application/csv'],
  },
  sniff: looksLikeText,
  parse(input, context) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes ?? new Uint8Array());
    } catch {
      return failed([{ row: 0, column: 0, code: 'encoding' }]);
    }
    const extension = extensionOf(input.fileName);
    const parsed = parseCsv(text, extension ? { extension } : {});
    const width = parsed.rows[0]?.length ?? 0;
    const table: Table | undefined =
      parsed.rows.length === 0
        ? undefined
        : {
            header: parsed.rows[0]!,
            rows: parsed.rows
              .slice(1)
              .map((cells) =>
                cells.length < width ? [...cells, ...Array(width - cells.length).fill('')] : cells,
              ),
            rowNumbers: parsed.lines.slice(1),
          };
    const problems: TableProblem[] = parsed.problems;
    return fromTable(table, problems, input, context);
  },
  template: {
    extension: 'csv',
    contentType: 'text/csv; charset=utf-8',
    async write(rows) {
      return new TextEncoder().encode(BOM + writeCsv(rows));
    },
  },
};
