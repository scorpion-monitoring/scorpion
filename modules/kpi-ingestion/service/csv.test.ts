// The CSV parser and writer: table-driven cases for the shapes real exports have, and fast-check properties for what must hold
// for any input (a table written with `writeCsv` reads back as itself; no input throws; a bad quote is a problem, never an exception).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  MAX_COLUMNS,
  MAX_DATA_ROWS,
  MAX_FIELD_LENGTH,
  MAX_TABLE_PROBLEMS,
  parseCsv,
  writeCsv,
  type CsvProblemCode,
  type Delimiter,
} from './csv.ts';

const rowsOf = (text: string, delimiter?: Delimiter) =>
  parseCsv(text, delimiter ? { delimiter } : {});

describe('parseCsv', () => {
  const cases: [string, string, string[][]][] = [
    [
      'plain fields',
      'a,b,c\n1,2,3\n',
      [
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ],
    ],
    [
      'CRLF',
      'a,b\r\n1,2\r\n',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    [
      'a lone CR',
      'a,b\r1,2\r',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    [
      'no trailing newline',
      'a,b\n1,2',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    [
      'a UTF-8 BOM',
      '﻿a,b\n1,2\n',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    ['a quoted delimiter', '"a,b",c\n', [['a,b', 'c']]],
    [
      'a quoted newline (LF, CRLF and CR)',
      '"a\nb","c\r\nd","e\rf"\n',
      [['a\nb', 'c\r\nd', 'e\rf']],
    ],
    ['doubled quotes', '"say ""hi""",x\n', [['say "hi"', 'x']]],
    ['an empty quoted field', '"",x\n', [['', 'x']]],
    [
      'empty fields',
      'a,,c\n,,\n',
      [
        ['a', '', 'c'],
        ['', '', ''],
      ],
    ],
    ['a trailing delimiter', 'a,b,\n', [['a', 'b', '']]],
    ['blank lines are skipped', 'a\n\n\nb\n', [['a'], ['b']]],
    ['a quoted empty line is a record', '""\na\n', [[''], ['a']]],
    ['umlauts and spaces are kept', ' Größe ,ä\n', [[' Größe ', 'ä']]],
    [
      'a semicolon file',
      'Periode;Downloads\n2026-01;12\n',
      [
        ['Periode', 'Downloads'],
        ['2026-01', '12'],
      ],
    ],
    [
      'a tab file',
      'Period\tDownloads\n2026-01\t12\n',
      [
        ['Period', 'Downloads'],
        ['2026-01', '12'],
      ],
    ],
    ['a quote closing at the end of the text', '"a"', [['a']]],
    ['the empty text', '', []],
    ['only a newline', '\n', []],
  ];
  it.each(cases)('reads %s', (_name, text, expected) => {
    const result = rowsOf(text);
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual(expected);
  });

  it('numbers the lines the records start on, also across a quoted newline', () => {
    const result = rowsOf('a,b\n"x\ny",2\n\nlast,3\n');
    expect(result.lines).toEqual([1, 2, 5]);
  });

  describe('the delimiter', () => {
    const detect: [string, string, string | undefined, Delimiter][] = [
      ['a comma', 'a,b,c\n', undefined, ','],
      ['a semicolon (German export)', 'a;b;c\n1,5;2,5;3\n', undefined, ';'],
      ['a tab', 'a\tb\n', undefined, '\t'],
      ['none at all', 'a\n1\n', undefined, ','],
      ['none at all, a tsv', 'a\n1\n', 'tsv', '\t'],
      ['a tie, a tsv', 'a,b\tc\n', '.tsv', '\t'],
      ['a tie, a csv', 'a,b\tc\n', 'csv', ','],
      ['the first line only', 'a,b\n1;2;3;4\n', undefined, ','],
      ['a delimiter inside quotes does not count', '"a;b;c;d",e,f\n', undefined, ','],
    ];
    it.each(detect)('chooses %s', (_name, text, extension, expected) => {
      expect(detectDelimiter(text, extension)).toBe(expected);
      expect(parseCsv(text, extension ? { extension } : {}).delimiter).toBe(expected);
    });
    it('uses the given delimiter over the detected one', () => {
      expect(parseCsv('a;b,c\n', { delimiter: ',' }).rows).toEqual([['a;b', 'c']]);
    });
  });

  describe('problems carry a line and a column, never the content', () => {
    const bad: [string, string, CsvProblemCode, number, number][] = [
      ['an unterminated quote', 'a,b\n"open,2\n', 'unterminated-quote', 2, 1],
      ['a quote in the middle of an unquoted field', 'a,b\nx"y,2\n', 'quote-in-field', 2, 1],
      ['text after a closing quote', 'a,b\n"x"y,2\n', 'text-after-quote', 2, 1],
      ['a quote in the second field', 'a,b\n1,x"y\n', 'quote-in-field', 2, 2],
      ['a NUL byte', 'a,b\u0000\n', 'not-text', 0, 0],
    ];
    it.each(bad)('reports %s', (_name, text, code, row, column) => {
      const result = rowsOf(text);
      expect(result.problems[0]).toEqual({ row, column, code });
      expect(JSON.stringify(result.problems)).not.toMatch(/open|"y|x"/);
    });

    it('keeps the rows it could read next to the problem', () => {
      const result = rowsOf('a,b\n1,2\nx"y,3\n4,5\n');
      expect(result.rows.map((row) => row[0])).toEqual(['a', '1', 'x"y', '4']);
      expect(result.problems).toEqual([{ row: 3, column: 1, code: 'quote-in-field' }]);
    });

    it('cuts a field that is too long and says where', () => {
      const result = rowsOf(`a,b\n${'x'.repeat(MAX_FIELD_LENGTH + 50)},2\n`);
      expect(result.problems).toEqual([{ row: 2, column: 1, code: 'field-too-long' }]);
      expect(result.rows[1]![0]).toHaveLength(MAX_FIELD_LENGTH);
    });

    it('accepts a field of exactly the limit', () => {
      expect(rowsOf(`${'x'.repeat(MAX_FIELD_LENGTH)}\n`).problems).toEqual([]);
      expect(rowsOf(`"${'x'.repeat(MAX_FIELD_LENGTH)}"\n`).problems).toEqual([]);
    });

    it('stops at the row limit: the header and 5 000 data rows are fine, one more is not', () => {
      const header = 'a,b\n';
      const ok = rowsOf(header + '1,2\n'.repeat(MAX_DATA_ROWS));
      expect(ok.problems).toEqual([]);
      expect(ok.rows).toHaveLength(MAX_DATA_ROWS + 1);
      const over = rowsOf(header + '1,2\n'.repeat(MAX_DATA_ROWS + 1));
      expect(over.problems).toEqual([{ row: MAX_DATA_ROWS + 2, column: 0, code: 'too-many-rows' }]);
      expect(over.rows).toHaveLength(MAX_DATA_ROWS + 1);
    });

    it('stops at the column limit, also for a file of nothing but delimiters', () => {
      const ok = rowsOf(Array.from({ length: MAX_COLUMNS }, (_, i) => `c${i}`).join(',') + '\n');
      expect(ok.problems).toEqual([]);
      const over = rowsOf(
        Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(',') + '\n',
      );
      expect(over.problems[0]?.code).toBe('too-many-columns');
      const commas = rowsOf(','.repeat(1_000_000));
      expect(commas.problems[0]?.code).toBe('too-many-columns');
      expect(commas.rows).toEqual([]);
    });

    it('lists at most as many problems as the limit', () => {
      const result = rowsOf('a,b\n' + 'x"y,1\n'.repeat(500));
      expect(result.problems).toHaveLength(MAX_TABLE_PROBLEMS);
    });
  });

  it('reads a file of the size the upload allows in well under a second', () => {
    const text =
      'Period,' +
      Array.from({ length: 20 }, (_, i) => `Indicator ${i}`).join(',') +
      '\n' +
      Array.from(
        { length: MAX_DATA_ROWS },
        (_, r) =>
          `2026-${(r % 12) + 1},` + Array.from({ length: 20 }, (_, i) => String(r * i)).join(','),
      ).join('\n');
    const started = performance.now();
    const result = parseCsv(text);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.rows).toHaveLength(MAX_DATA_ROWS + 1);
  });
});

describe('writeCsv', () => {
  it('quotes what needs it and ends records with CRLF', () => {
    expect(
      writeCsv([
        ['a', 'b,c', 'say "hi"', 'x\ny'],
        ['', ''],
      ]),
    ).toBe('a,"b,c","say ""hi""","x\ny"\r\n,\r\n');
    expect(writeCsv([['a;b', 'c']], ';')).toBe('"a;b";c\r\n');
    expect(writeCsv([[''], ['x']])).toBe('""\r\nx\r\n');
  });
  it('keeps a first field that starts with a BOM by writing one in front', () => {
    const rows = [['﻿a', 'b']];
    expect(parseCsv(writeCsv(rows)).rows).toEqual(rows);
  });
});

// Anything the writer can be given: any text, including quotes, delimiters, line breaks, lone surrogates and the BOM.
const field = fc
  .string({ unit: 'binary', maxLength: 40 })
  .filter((text) => !text.includes('\u0000'));
const table = fc.array(fc.array(field, { minLength: 1, maxLength: 6 }), {
  minLength: 1,
  maxLength: 12,
});

describe('properties (fast-check)', () => {
  it.each([',', ';', '\t'] as Delimiter[])(
    'a table written with writeCsv reads back as itself (%j)',
    (delimiter) => {
      fc.assert(
        fc.property(table, (rows) => {
          const result = parseCsv(writeCsv(rows, delimiter), { delimiter });
          expect(result.problems).toEqual([]);
          expect(result.rows).toEqual(rows);
        }),
        { numRuns: 400 },
      );
    },
  );

  it('a written table is also read back when the delimiter is detected, if the header names it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Delimiter>(',', ';', '\t'),
        fc.array(fc.stringMatching(/^[A-Za-z0-9 ]{1,10}$/), { minLength: 2, maxLength: 6 }),
        (delimiter, header) => {
          const rows = [header, header.map((_, i) => String(i))];
          expect(parseCsv(writeCsv(rows, delimiter)).rows).toEqual(rows);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('no input throws, and every problem has a line and a column inside the input', () => {
    const noise = fc.string({
      unit: fc.constantFrom(
        'a',
        'b',
        '1',
        ',',
        ';',
        '\t',
        '"',
        '"',
        '\n',
        '\r',
        ' ',
        '﻿',
        '\u0000',
      ),
      maxLength: 120,
    });
    fc.assert(
      fc.property(fc.oneof(noise, fc.string({ unit: 'binary', maxLength: 200 })), (text) => {
        const result = parseCsv(text);
        const lines = text.split(/\r\n|\r|\n/).length;
        for (const problem of result.problems) {
          expect(problem.row).toBeGreaterThanOrEqual(0);
          expect(problem.row).toBeLessThanOrEqual(lines + 1);
          expect(problem.column).toBeGreaterThanOrEqual(0);
        }
        expect(result.lines).toHaveLength(result.rows.length);
      }),
      { numRuns: 1000 },
    );
  });

  it('a quote in the middle of an unquoted field, and an unterminated quote, are problems and not exceptions', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.stringMatching(/^[a-z ,]{0,8}$/),
        (head, tail) => {
          const middle = parseCsv(`h\n${head}"${tail}\n`, { delimiter: ';' });
          expect(middle.problems.map((p) => p.code)).toContain('quote-in-field');
          const open = parseCsv(`h\n"${head}${tail}\n`, { delimiter: ';' });
          expect(open.problems.map((p) => p.code)).toContain('unterminated-quote');
        },
      ),
      { numRuns: 200 },
    );
  });
});
