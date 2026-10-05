// A CSV writer for the audit export, in-house (no dependency, M4 plan §2). RFC 4180 quoting, and a
// guard against formula injection: a spreadsheet runs a cell that starts with `=`, `+`, `-`, `@`,
// a tab or a carriage return as a formula, and the trail holds text an attacker chose (a path, a
// body). Such a cell gets a leading apostrophe, which the spreadsheet shows as plain text.
const FORMULA_START = /^[=+\-@\t\r\n]/;
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvCell = string | number | boolean | Date | null | undefined | object;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') text = JSON.stringify(value);
  else text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One record, with the line ending RFC 4180 asks for. */
export function csvRow(cells: readonly CsvCell[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}
