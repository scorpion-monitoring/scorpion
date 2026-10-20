// From a table of cells to measurements, the part every file adapter shares (plan §7 item 5). The first row is the header; each
// column maps to the period or to one indicator of the service (by id, by name without case, or by a header that names exactly one:
// `resolveIndicatorRef`, the same function as the legacy API's `kpi`), each target at most once. The period column and every
// mandatory indicator are required, and the answer says which are missing. Pure: it reads nothing and writes nothing, and a problem
// is `{ row, column, code }`, never a cell's content.
import { resolveIndicatorRef, type IndicatorChoice } from './names.ts';
import { unescapeCell } from './escape.ts';

/** What a header may be called to mean the period; compared without case. The template says `Period`. */
const PERIOD_HEADERS = new Set(['period', 'month', 'date', 'periode', 'monat', 'datum']);
/** The longest cell the preview shows; a longer one is cut. Nothing longer is ever echoed. */
export const MAX_ECHO = 64;
/** How many data rows a preview shows. */
export const PREVIEW_ROWS = 20;

export type ProblemCode =
  // the file
  | 'empty-file'
  | 'format'
  | 'encoding'
  | 'not-text'
  | 'not-a-zip'
  | 'encrypted'
  | 'zip64'
  | 'corrupt'
  | 'too-many-entries'
  | 'declared-too-large'
  | 'inflated-too-large'
  | 'sheet-not-found'
  | 'unterminated-quote'
  | 'quote-in-field'
  | 'text-after-quote'
  | 'field-too-long'
  | 'too-many-rows'
  | 'too-many-columns'
  // the mapping
  | 'mapping-invalid'
  | 'duplicate-column'
  | 'missing-column'
  // a row
  | 'period-missing'
  | 'required-value'
  | 'cell-type'
  | 'indicator-invalid'
  | 'period-invalid'
  | 'value-invalid'
  | 'duplicate-row';

/** Where and what. `row` is the line (CSV) or row (XLSX) of the file, 1-based, 0 for the file as a whole; `column` is 1-based, 0 for the row. */
export interface TableProblem {
  row: number;
  column: number;
  code: ProblemCode;
}

/** A sentence per code, in English; the page of sprint 4 has its own words. None repeats anything from the file. */
export const PROBLEM_MESSAGES: Record<ProblemCode, string> = {
  'empty-file': 'The file has no rows.',
  format: 'The file could not be read as a table.',
  encoding: 'The file is not UTF-8 text; save it as UTF-8 and upload it again.',
  'not-text': 'The file is not a text file.',
  'not-a-zip': 'The file is not an XLSX workbook (it may be cut short, or another kind of file).',
  encrypted:
    'The workbook is password-protected or encrypted; save it without a password and upload it again.',
  zip64: 'The workbook uses an archive format that is not accepted here.',
  corrupt: 'The workbook is damaged and cannot be read.',
  'too-many-entries': 'The workbook holds too many parts to be a normal spreadsheet.',
  'declared-too-large': 'The workbook is too large when unpacked (at most 20 MiB).',
  'inflated-too-large': 'The workbook is too large when unpacked (at most 20 MiB).',
  'sheet-not-found': 'The workbook has no such sheet.',
  'unterminated-quote': 'A quoted field is not closed.',
  'quote-in-field': 'A quote appears inside a field that does not start with one.',
  'text-after-quote': 'There is text between the closing quote and the next separator.',
  'field-too-long': 'A field is longer than 4000 characters.',
  'too-many-rows': 'The file has more than 5000 data rows.',
  'too-many-columns': 'The file has more than 200 columns.',
  'mapping-invalid':
    'The column mapping names a column or a KPI that does not exist, or uses a target twice.',
  'duplicate-column': 'Two columns name the same KPI or the period; only the first is used.',
  'missing-column': 'A required column is not mapped: the period, or a mandatory KPI.',
  'period-missing': 'The row has values but no period.',
  'required-value': 'A mandatory KPI has no value in this row.',
  'cell-type': 'The cell is not text, a number or a date.',
  'indicator-invalid': 'The KPI is not one of the KPIs of this service.',
  'period-invalid': 'The period is not a month in the form YYYY-MM or YYYY-MM-DD.',
  'value-invalid': 'The value is not valid for this KPI.',
  'duplicate-row': 'The same KPI and month appear twice in the file.',
};

/** The table a format reader produces: strings only (a number is its shortest text, a date `YYYY-MM-DD`). */
export interface Table {
  /** The first record. */
  header: string[];
  /** The data records, each padded to the header's width. */
  rows: string[][];
  /** The line or row of the file each data row came from (1-based). */
  rowNumbers: number[];
}

/** A KPI of the service's effective set, as the mapping needs it. */
export interface TargetIndicator extends IndicatorChoice {
  mandatory: boolean;
  valueType: string;
  unit: string | null;
}

/** The mapping of columns to targets, keyed by the column's 0-based index as text; `'period'` or an indicator id. An unmapped column is absent. */
export type ColumnMapping = Record<string, string>;

/** One value found in the table, with where it came from. */
export interface ParsedRow {
  indicator: string;
  period: string;
  value: string;
  /** 1-based file row, and the 1-based columns of the value and of the period. */
  origin: { row: number; column: number; periodColumn: number };
}

export interface MappedTable {
  rows: ParsedRow[];
  /** One entry per header column: `'period'`, an indicator id, or `null`. */
  targets: (string | null)[];
  /** The mapping as an object, for the request and the answer. */
  mapping: ColumnMapping;
  /** True when it was proposed from the header, false when the request gave it. */
  proposed: boolean;
  /** `'period'` and the ids of mandatory indicators with no column. */
  missing: string[];
  problems: TableProblem[];
}

const clean = (text: string) => unescapeCell(text.trim());

/** The header with the decoration of the template taken off (`Name (unit) *`), tried after the exact text. */
function undecorated(header: string): string {
  return header
    .replace(/\s*\*\s*$/, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim();
}

/** The mapping a header suggests. */
export function proposeMapping(
  header: readonly string[],
  indicators: readonly TargetIndicator[],
): { targets: (string | null)[]; problems: TableProblem[] } {
  const targets: (string | null)[] = [];
  const taken = new Set<string>();
  const problems: TableProblem[] = [];
  header.forEach((raw, index) => {
    const text = clean(raw);
    let target: string | null = null;
    if (text !== '') {
      if (PERIOD_HEADERS.has(text.toLowerCase())) target = 'period';
      else {
        const exact = resolveIndicatorRef(indicators, text);
        const found = exact.ok ? exact : resolveIndicatorRef(indicators, undecorated(text));
        if (found.ok) target = found.indicatorId;
      }
    }
    if (target !== null && taken.has(target)) {
      problems.push({ row: 1, column: index + 1, code: 'duplicate-column' });
      target = null;
    }
    if (target !== null) taken.add(target);
    targets.push(target);
  });
  return { targets, problems };
}

/** Checks a mapping the request gave: columns inside the header, targets that exist, each at most once. */
function checkMapping(
  given: Record<string, unknown>,
  width: number,
  indicators: readonly TargetIndicator[],
): { targets: (string | null)[]; problems: TableProblem[] } {
  const targets: (string | null)[] = Array.from({ length: width }, () => null);
  const problems: TableProblem[] = [];
  const known = new Set(indicators.map((indicator) => indicator.indicatorId));
  const taken = new Set<string>();
  for (const [key, target] of Object.entries(given)) {
    const column = /^\d{1,3}$/.test(key) ? Number(key) : -1;
    if (target === null || target === '') continue;
    if (
      column < 0 ||
      column >= width ||
      typeof target !== 'string' ||
      !(target === 'period' || known.has(target)) ||
      taken.has(target)
    ) {
      problems.push({
        row: 1,
        column: column >= 0 && column < width ? column + 1 : 0,
        code: 'mapping-invalid',
      });
      continue;
    }
    taken.add(target);
    targets[column] = target;
  }
  return { targets, problems };
}

const blank = (text: string | undefined) => text === undefined || text.trim() === '';

/**
 * Turns a table into rows: the mapping (given, or proposed from the header), the required columns, and for each data row the period
 * and one value per mapped indicator. A blank value is no value, an error only for a mandatory indicator; a row that is blank
 * throughout is skipped; a row with values and no period is a problem. The values are the cells as text, trimmed; whether they are
 * valid for the indicator is `upsertBatch`'s verdict, so there is one rule.
 */
export function mapTable(
  table: Table,
  indicators: readonly TargetIndicator[],
  given?: Record<string, unknown>,
): MappedTable {
  const width = table.header.length;
  const checked = given
    ? checkMapping(given, width, indicators)
    : proposeMapping(table.header, indicators);
  const { targets } = checked;
  const problems: TableProblem[] = [...checked.problems];

  const mapping: ColumnMapping = {};
  targets.forEach((target, index) => {
    if (target !== null) mapping[String(index)] = target;
  });
  const periodColumn = targets.indexOf('period');
  const mapped = new Set(targets.filter((target): target is string => target !== null));
  const missing = [
    ...(periodColumn < 0 ? ['period'] : []),
    ...indicators
      .filter((indicator) => indicator.mandatory && !mapped.has(indicator.indicatorId))
      .map((indicator) => indicator.indicatorId),
  ];
  for (let n = 0; n < missing.length; n++)
    problems.push({ row: 1, column: 0, code: 'missing-column' });

  const mandatory = new Set(indicators.filter((i) => i.mandatory).map((i) => i.indicatorId));
  const rows: ParsedRow[] = [];
  table.rows.forEach((cells, at) => {
    const row = table.rowNumbers[at]!;
    const mappedColumns = targets
      .map((target, index) => ({ target, index }))
      .filter(
        (entry): entry is { target: string; index: number } =>
          entry.target !== null && entry.target !== 'period',
      );
    // A row with no value in any mapped column is skipped: the empty rows of an export, and the template's example row.
    if (periodColumn < 0 || mappedColumns.every((c) => blank(cells[c.index]))) return;
    const period = (cells[periodColumn] ?? '').trim();
    if (period === '') {
      problems.push({ row, column: periodColumn + 1, code: 'period-missing' });
      return;
    }
    for (const { target, index } of mappedColumns) {
      const value = (cells[index] ?? '').trim();
      if (value === '') {
        if (mandatory.has(target))
          problems.push({ row, column: index + 1, code: 'required-value' });
        continue;
      }
      rows.push({
        indicator: target,
        period,
        value,
        origin: { row, column: index + 1, periodColumn: periodColumn + 1 },
      });
    }
  });
  return { rows, targets, mapping, proposed: !given, missing, problems };
}

/** A cell as the preview shows it: cut at 64 characters. */
export const echo = (text: string) =>
  text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO)}…` : text;

/** The header as the page shows it, with the escape of the template taken off and cut. */
export const echoHeader = (header: readonly string[]) => header.map((text) => echo(clean(text)));

/** A problem list with each (row, column, code) once, in order, and at most `limit`. */
export function uniqueProblems(problems: readonly TableProblem[], limit = 100): TableProblem[] {
  const seen = new Set<string>();
  const result: TableProblem[] = [];
  for (const problem of problems) {
    const key = `${problem.row}|${problem.column}|${problem.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(problem);
    if (result.length >= limit) break;
  }
  return result;
}
