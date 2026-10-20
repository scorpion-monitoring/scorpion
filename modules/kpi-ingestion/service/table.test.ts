// The mapping of a table to measurements, pure: the proposal from a header, the checks of a given mapping, the required columns and what a
// row does. No database.
import { describe, expect, it } from 'vitest';
import { chooseFileAdapter, indexAdapters, type AdapterEntry } from './adapters.ts';
import { csvAdapter } from './adapter-csv.ts';
import { xlsxAdapter } from './adapter-xlsx.ts';
import { formAdapter } from './adapter-form.ts';
import { echo, mapTable, proposeMapping, uniqueProblems, type TargetIndicator } from './table.ts';

const ind = (id: string, name: string, mandatory = false): TargetIndicator => ({
  indicatorId: id,
  name,
  mandatory,
  valueType: 'integer',
  unit: null,
});
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const set = [ind(A, 'Downloads', true), ind(B, 'Active users'), ind(C, 'Satisfaction (score)')];
const table = (header: string[], rows: string[][]) => ({
  header,
  rows,
  rowNumbers: rows.map((_, i) => i + 2),
});

describe('proposeMapping', () => {
  it.each([
    [
      ['Period', 'Downloads'],
      ['period', A],
    ],
    [
      ['month', 'downloads', 'ACTIVE USERS'],
      ['period', A, B],
    ],
    [
      ['Monat', 'Active users'],
      ['period', B],
    ],
    [
      ['Date', 'Unknown', 'Downloads'],
      ['period', null, A],
    ],
    [
      [B, 'Period'],
      [B, 'period'],
    ],
    [
      ['Downloads (count) *', 'Active users *'],
      [A, B],
    ],
    [
      ['Satisfaction (score)', 'Satisfaction'],
      [C, null],
    ], // the exact name first; the bare name is not another
    [['  Downloads  '], [A]],
    [["'=Downloads"], [null]],
    [
      ['', 'Period'],
      [null, 'period'],
    ],
  ])('maps %j to %j', (header, expected) => {
    expect(proposeMapping(header, set).targets).toEqual(expected);
  });

  it('uses each target once and reports the second column', () => {
    const { targets, problems } = proposeMapping(['Downloads', 'downloads', 'Period', 'Date'], set);
    expect(targets).toEqual([A, null, 'period', null]);
    expect(problems).toEqual([
      { row: 1, column: 2, code: 'duplicate-column' },
      { row: 1, column: 4, code: 'duplicate-column' },
    ]);
  });

  it('matches a name that two indicators share by id only', () => {
    const twins = [ind(A, 'Same'), ind(B, 'same')];
    expect(proposeMapping(['Same', A], twins).targets).toEqual([null, A]);
  });
});

describe('mapTable', () => {
  it('emits one row per value, with where it came from, and skips rows with no value', () => {
    const result = mapTable(
      table(
        ['Period', 'Downloads', 'Active users'],
        [
          ['2026-01', '5', ''],
          ['', '', ''],
          ['2026-02', '6', '7'],
        ],
      ),
      set,
    );
    expect(result.problems).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.rows).toEqual([
      {
        indicator: A,
        period: '2026-01',
        value: '5',
        origin: { row: 2, column: 2, periodColumn: 1 },
      },
      {
        indicator: A,
        period: '2026-02',
        value: '6',
        origin: { row: 4, column: 2, periodColumn: 1 },
      },
      {
        indicator: B,
        period: '2026-02',
        value: '7',
        origin: { row: 4, column: 3, periodColumn: 1 },
      },
    ]);
  });

  it('says what is missing: the period and each mandatory indicator', () => {
    expect(mapTable(table(['Downloads'], [['1']]), set).missing).toEqual(['period']);
    expect(mapTable(table(['Period', 'Active users'], [['2026-01', '1']]), set).missing).toEqual([
      A,
    ]);
    expect(mapTable(table(['Active users'], [['1']]), set).missing).toEqual(['period', A]);
    const noRows = mapTable(table(['Period', 'Active users'], [['2026-01', '1']]), set);
    expect(noRows.problems).toEqual([{ row: 1, column: 0, code: 'missing-column' }]);
  });

  it('turns a mandatory blank into a problem only in a row that has a value, and a missing period too', () => {
    const result = mapTable(
      table(
        ['Period', 'Downloads', 'Active users'],
        [
          ['2026-01', '', '3'],
          ['', '4', ''],
          ['2026-03', '', ''],
        ],
      ),
      set,
    );
    expect(result.problems).toEqual([
      { row: 2, column: 2, code: 'required-value' },
      { row: 3, column: 1, code: 'period-missing' },
    ]);
  });

  it('takes a given mapping over the header and refuses a bad one', () => {
    const t = table(['a', 'b', 'c'], [['2026-01', '1', '2']]);
    const ok = mapTable(t, set, { '0': 'period', '1': A, '2': B });
    expect(ok.proposed).toBe(false);
    expect(ok.rows.map((row) => row.indicator)).toEqual([A, B]);
    const bad = [
      { '0': 'period', '1': A, '2': A },
      { '0': 'period', '3': A },
      { '0': 'period', '1': 'nope' },
      { '0': 'period', '1': 5 },
      { '-1': A },
      { '0': 'period', '1': 'period' },
    ];
    for (const mapping of bad)
      expect(
        mapTable(t, set, mapping).problems.map((p) => p.code),
        JSON.stringify(mapping),
      ).toContain('mapping-invalid');
    // an unmapped column is ignored, and null or '' clear a target
    expect(mapTable(t, set, { '0': 'period', '1': A, '2': null }).problems).toEqual([]);
  });

  it('cuts what it shows at 64 characters', () => {
    expect(echo('x'.repeat(64))).toHaveLength(64);
    expect(echo('x'.repeat(65))).toHaveLength(65);
    expect(echo('x'.repeat(65)).endsWith('…')).toBe(true);
  });
});

describe('uniqueProblems', () => {
  it('keeps each row, column and code once, in order, and at most the limit', () => {
    const p = { row: 2, column: 3, code: 'value-invalid' as const };
    expect(uniqueProblems([p, p, { ...p, column: 4 }])).toEqual([p, { ...p, column: 4 }]);
    const many = Array.from({ length: 300 }, (_, i) => ({ ...p, row: i }));
    expect(uniqueProblems(many)).toHaveLength(100);
    expect(uniqueProblems(many, 5)).toHaveLength(5);
  });
});

describe('chooseFileAdapter', () => {
  const adapters = indexAdapters([formAdapter, csvAdapter, xlsxAdapter] as AdapterEntry[]);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);
  const text = new TextEncoder().encode('a,b\n1,2\n');
  const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]);
  it.each([
    ['a workbook, asked for as csv', 'csv', zip, 'xlsx'],
    ['a workbook, asked for as xlsx', 'xlsx', zip, 'xlsx'],
    ['text, asked for as xlsx', 'xlsx', text, 'csv'],
    ['text, asked for as csv', 'csv', text, 'csv'],
    ['text, asked for nothing', undefined, text, 'csv'],
    ['a workbook, asked for nothing', undefined, zip, 'xlsx'],
    ['text, asked for the form (not a file adapter)', 'form', text, 'csv'],
  ])('reads %s as %s', (_name, requested, bytes, expected) => {
    expect(chooseFileAdapter(adapters, requested, bytes)?.id).toBe(expected);
  });
  it('finds nothing for binary that is neither', () => {
    expect(chooseFileAdapter(adapters, 'csv', binary)).toBeUndefined();
  });
});
