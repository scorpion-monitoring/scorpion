// The table an exporter writes (M11 sprint 5): the union of the months, a gap that stays empty, and every text escaped. Table-driven.
import { describe, expect, it } from 'vitest';
import { buildTable, type ExportRow } from './export-table.ts';

const point = (period: string, value: number | null, text: string | null = null) => ({
  period,
  value,
  text,
});
const row = (name: string, points: ExportRow['points'], unit: string | null = null): ExportRow => ({
  name,
  unit,
  points,
});

describe('buildTable', () => {
  it('has the headings and no row for no KPI', () => {
    expect(buildTable([])).toEqual({ header: ['KPI', 'Unit'], rows: [] });
  });

  it('puts every value under its own month when the KPIs have different months (the legacy bug)', () => {
    const table = buildTable([
      row('A', [point('2026-01-31', 1), point('2026-02-28', 2)]),
      // the legacy export read the months of the first KPI only: B's values would have moved under January and February
      row('B', [point('2026-03-31', 30), point('2026-04-30', 40)]),
      row('C', [point('2026-02-28', 200), point('2026-04-30', 400)]),
    ]);
    expect(table.header).toEqual(['KPI', 'Unit', '2026-01', '2026-02', '2026-03', '2026-04']);
    expect(table.rows).toEqual([
      ['A', '', 1, 2, null, null],
      ['B', '', null, null, 30, 40],
      ['C', '', null, 200, null, 400],
    ]);
  });

  it('sorts the months though the points arrive in any order, and takes a month once', () => {
    const table = buildTable([
      row('A', [point('2026-03-31', 3), point('2026-01-31', 1)]),
      row('B', [point('2026-02-28', 2), point('2026-03-31', 33)]),
    ]);
    expect(table.header.slice(2)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(table.rows[1]).toEqual(['B', '', null, 2, 33]);
  });

  it('leaves a KPI with no value empty: a gap is never a zero', () => {
    const table = buildTable([
      row('Has', [point('2026-01-31', 0), point('2026-02-28', null)]),
      row('None', [point('2026-01-31', null), point('2026-02-28', null)]),
    ]);
    // a real 0 stays 0, a gap is null
    expect(table.rows).toEqual([
      ['Has', '', 0, null],
      ['None', '', null, null],
    ]);
  });

  it('writes a text value as text, and treats a value that is not a finite number as a gap', () => {
    const table = buildTable([
      row('Note', [point('2026-01-31', null, 'all well'), point('2026-02-28', null, '')]),
      row('Odd', [point('2026-01-31', Number.NaN), point('2026-02-28', Infinity)]),
    ]);
    expect(table.rows).toEqual([
      ['Note', '', 'all well', null],
      ['Odd', '', null, null],
    ]);
  });

  it('keeps umlauts and the unit as given', () => {
    const table = buildTable([
      row('Größe der Nutzer:innen', [point('2026-01-31', 1.5)], 'Prozent (%)'),
    ]);
    expect(table.rows).toEqual([['Größe der Nutzer:innen', 'Prozent (%)', 1.5]]);
  });

  // The cells that start with a character a spreadsheet reads as a formula. A number is not text: a negative value stays a number.
  it.each([
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@cmd', "'@cmd"],
    ['\tTab', "'\tTab"],
    ['\rCarriage', "'\rCarriage"],
    ['=', "'="],
    ['Safe = fine', 'Safe = fine'],
    ["'quoted", "'quoted"],
  ])('escapes the name, the unit and a text value %j as %j', (raw, escaped) => {
    const table = buildTable([row(raw, [point('2026-01-31', null, raw)], raw)]);
    expect(table.rows).toEqual([[escaped, escaped, escaped]]);
  });

  it('keeps a negative number a number', () => {
    expect(buildTable([row('Delta', [point('2026-01-31', -5)])]).rows).toEqual([['Delta', '', -5]]);
  });

  it('does not change the rows it is given', () => {
    const rows = [row('=x', [point('2026-01-31', 1)])];
    const before = JSON.stringify(rows);
    buildTable(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
