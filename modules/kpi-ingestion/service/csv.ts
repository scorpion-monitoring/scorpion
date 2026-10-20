// Our own CSV and TSV parser and writer (ADR-0041 decision 5; no runtime dependency). Pure. RFC 4180 quoting (embedded delimiters
// and newlines in quoted fields, doubled quotes), CRLF, LF and CR, a UTF-8 BOM, a trailing newline, and a delimiter chosen among
// comma, semicolon and tab (a semicolon is what German spreadsheets export). It never throws: every failure is a problem with a
// line and a column, and a cell's content is never part of one.
//
// Where the input is not valid CSV the parser still returns what it could read, next to the problems, so a preview can show
// the rows that are good; a caller that must not write refuses the file when `problems` is not empty.

/** The most data rows a file holds (the header is one more record). */
export const MAX_DATA_ROWS = 5000;
/** The most columns a record holds. */
export const MAX_COLUMNS = 200;
/** The longest field; a longer one is cut here and reported. */
export const MAX_FIELD_LENGTH = 4000;
/** The most problems a parse reports; the first ones are the useful ones. */
export const MAX_TABLE_PROBLEMS = 100;

export type Delimiter = ',' | ';' | '\t';
const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];

export type CsvProblemCode =
  | 'not-text'
  | 'unterminated-quote'
  | 'quote-in-field'
  | 'text-after-quote'
  | 'field-too-long'
  | 'too-many-rows'
  | 'too-many-columns';

/** Where and what, never the content. `row` is the line the record starts on (1-based), `column` the field (1-based). */
export interface CsvProblem {
  row: number;
  column: number;
  code: CsvProblemCode;
}

export interface CsvResult {
  /** The records, header first; a blank line is not a record. */
  rows: string[][];
  /** The line each record starts on (1-based), parallel to `rows`. */
  lines: number[];
  delimiter: Delimiter;
  problems: CsvProblem[];
}

export interface CsvOptions {
  /** Forces the delimiter; otherwise it is detected from the first line. */
  delimiter?: Delimiter;
  /** A file extension (`csv`, `tsv`, `txt`, with or without the dot) used only to break a tie. */
  extension?: string;
}

const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * The delimiter of a text: the one that occurs most often in the first line outside quotes. A tie, or no delimiter at all, is
 * decided by the extension (`tsv` means tab) and then by the order comma, semicolon, tab.
 */
export function detectDelimiter(text: string, extension?: string): Delimiter {
  const counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts.has(ch as Delimiter))
      counts.set(ch as Delimiter, counts.get(ch as Delimiter)! + 1);
  }
  const best = Math.max(...counts.values());
  const hint: Delimiter | undefined = /^\.?(tsv|tab)$/i.test(extension ?? '') ? '\t' : undefined;
  const top = DELIMITERS.filter((d) => counts.get(d) === best);
  if (hint && top.includes(hint)) return hint;
  return top[0]!;
}

/** Parses a text. Never throws. */
export function parseCsv(input: string, options: CsvOptions = {}): CsvResult {
  const text = stripBom(typeof input === 'string' ? input : '');
  const delimiter = options.delimiter ?? detectDelimiter(text, options.extension);
  const result: CsvResult = { rows: [], lines: [], delimiter, problems: [] };
  const note = (row: number, column: number, code: CsvProblemCode) => {
    if (result.problems.length < MAX_TABLE_PROBLEMS) result.problems.push({ row, column, code });
  };

  if (text.includes('\u0000')) {
    note(0, 0, 'not-text');
    return result;
  }

  let record: string[] = [];
  let recordLine = 1;
  let line = 1;
  let field = '';
  let quoted = false; // the current field began with a quote
  let i = 0;
  const n = text.length;

  const endField = () => {
    if (field.length > MAX_FIELD_LENGTH) {
      note(recordLine, record.length + 1, 'field-too-long');
      field = field.slice(0, MAX_FIELD_LENGTH);
    }
    record.push(field);
    field = '';
  };
  /** Ends the record; false when the parse must stop. */
  const endRecord = (wasQuoted: boolean): boolean => {
    endField();
    const blank = record.length === 1 && record[0] === '' && !wasQuoted;
    if (!blank) {
      if (record.length > MAX_COLUMNS) {
        note(recordLine, MAX_COLUMNS + 1, 'too-many-columns');
        return false;
      }
      if (result.rows.length > MAX_DATA_ROWS) {
        // the header and MAX_DATA_ROWS records are in; this is one more
        note(recordLine, 0, 'too-many-rows');
        return false;
      }
      result.rows.push(record);
      result.lines.push(recordLine);
    }
    record = [];
    quoted = false;
    return true;
  };

  let more = true;
  while (more && i < n) {
    // At the start of a field.
    if (text[i] === '"') {
      quoted = true;
      i++;
      let closed = false;
      while (i < n) {
        const ch = text[i]!;
        if (ch === '"') {
          if (text[i + 1] === '"') {
            if (field.length <= MAX_FIELD_LENGTH) field += '"';
            i += 2;
          } else {
            closed = true;
            i++;
            break;
          }
        } else {
          if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
          if (field.length <= MAX_FIELD_LENGTH) field += ch;
          i++;
        }
      }
      if (!closed) {
        note(recordLine, record.length + 1, 'unterminated-quote');
      } else {
        // Only a delimiter, a newline or the end may follow the closing quote.
        const next = text[i];
        if (next !== undefined && next !== delimiter && next !== '\n' && next !== '\r') {
          note(recordLine, record.length + 1, 'text-after-quote');
          while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') {
            if (field.length <= MAX_FIELD_LENGTH) field += text[i];
            i++;
          }
        }
      }
    } else {
      const from = i;
      let sawQuote = false;
      while (i < n) {
        const ch = text[i]!;
        if (ch === delimiter || ch === '\n' || ch === '\r') break;
        if (ch === '"') sawQuote = true;
        i++;
      }
      field = text.slice(from, Math.min(i, from + MAX_FIELD_LENGTH + 1));
      if (sawQuote) note(recordLine, record.length + 1, 'quote-in-field');
    }

    // After a field: a delimiter (another field follows), a newline (the record ends) or the end.
    const ch = text[i];
    if (ch === delimiter) {
      endField();
      i++;
      if (record.length > MAX_COLUMNS) {
        // stop before a file of nothing but delimiters becomes a million fields
        note(recordLine, MAX_COLUMNS + 1, 'too-many-columns');
        more = false;
      } else if (i >= n) {
        // a trailing delimiter: one more, empty, field ends the record
        more = endRecord(false);
      }
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      more = endRecord(quoted);
      line++;
      recordLine = line;
    } else {
      // the end of the text
      more = endRecord(quoted);
    }
  }
  return result;
}

/**
 * Writes a table as CSV: a field is quoted when it holds the delimiter, a quote or a line break, and a record of one empty field is
 * written as `""` so that it is not read as a blank line. Records end with CRLF. No BOM (the template adds it). A first field that
 * starts with a BOM is preceded by one, because the reader strips exactly one.
 */
export function writeCsv(rows: readonly (readonly string[])[], delimiter: Delimiter = ','): string {
  const cell = (value: string, alone: boolean) =>
    value === '' && alone
      ? '""'
      : /["\r\n]/.test(value) || value.includes(delimiter)
        ? `"${value.replaceAll('"', '""')}"`
        : value;
  const body = rows
    .map((row) => row.map((value) => cell(value, row.length === 1)).join(delimiter) + '\r\n')
    .join('');
  return rows[0]?.[0]?.charCodeAt(0) === 0xfeff ? '\uFEFF' + body : body;
}
