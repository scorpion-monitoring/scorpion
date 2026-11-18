// The measurement rules of plan §3 as tables: month end, the latest point of the month, 1899, the future, the months a 0
// left out (decision 13), and the batches of at most 120 months. Pure: the clock is a parameter.
import { describe, expect, it } from 'vitest';
import { parseLegacyDate } from './dates.ts';
import { batchesOf, transformService, type MeasurementRow } from './measurements.ts';
import type { MeasurementPoint } from './snapshot.ts';
import type { Finding } from './transform.ts';

const NOW = new Date('2026-11-18T10:00:00Z');
const point = (kpi: string, date: string, value: number): MeasurementPoint => ({
  kpi,
  value,
  date,
  parsed: parseLegacyDate(date),
});
const run = (points: MeasurementPoint[], fill = false) => {
  const findings: Finding[] = [];
  const plan = transformService(
    'GeneFlow',
    points,
    { now: NOW, fillMissingMonths: fill },
    findings,
  );
  return { plan, findings, rows: plan.batches.flat() };
};
const row = (kpi: string, period: string, value: number): MeasurementRow => ({
  kpi,
  period,
  value,
});

describe('month end and the latest point of the month', () => {
  it.each([
    [
      'a point on the 1st',
      [point('Users', '2023-01-01 00:00:00+00:00', 5)],
      [row('Users', '2023-01', 5)],
    ],
    [
      'a point on the 15th',
      [point('Users', '2023-01-15 00:00:00+00:00', 5)],
      [row('Users', '2023-01', 5)],
    ],
    [
      'two in one month: the later instant wins, whatever the order of the file',
      [
        point('Users', '2023-01-20 00:00:00+00:00', 7),
        point('Users', '2023-01-05 00:00:00+00:00', 3),
      ],
      [row('Users', '2023-01', 7)],
    ],
    [
      'the same instant twice (one month under two provider names): the later point of the file wins',
      [
        point('Users', '2023-01-01 00:00:00+00:00', 3),
        point('Users', '2023-01-01 00:00:00+00:00', 9),
      ],
      [row('Users', '2023-01', 9)],
    ],
    [
      'the last second of a month stays in it',
      [point('Users', '2023-01-31 23:59:59+00:00', 4)],
      [row('Users', '2023-01', 4)],
    ],
    [
      'an offset moves the point to the month of its UTC instant',
      [point('Users', '2023-01-31 23:30:00-02:00', 4)],
      [row('Users', '2023-02', 4)],
    ],
    [
      'two KPIs of one month are two rows, in the order of the month and then the KPI',
      [point('B', '2023-02-01 00:00:00+00:00', 1), point('A', '2023-02-01 00:00:00+00:00', 2)],
      [row('A', '2023-02', 2), row('B', '2023-02', 1)],
    ],
  ])('%s', (_name, points, expected) => {
    expect(run(points).rows).toEqual(expected);
  });

  it('reports the points it dropped for being in the same month, and counts them as merged', () => {
    const { plan, findings } = run([
      point('Users', '2023-01-05 00:00:00+00:00', 3),
      point('Users', '2023-01-20 00:00:00+00:00', 7),
    ]);
    expect(plan.points).toEqual({ read: 2, kept: 1, merged: 1, dropped: 0, filled: 0 });
    expect(findings.map((f) => f.rule)).toEqual(['measurement.duplicate-in-month']);
  });
});

describe('what is dropped, and why', () => {
  it.each([
    ['a year before 1900', '1899-12-01 00:00:00+00:00', 'measurement.before-1900'],
    ['a month after the current one', '2026-12-01 00:00:00+00:00', 'measurement.future-month'],
    ['a date that does not parse', '2023-13-01 00:00:00+00:00', 'measurement.date-invalid'],
  ])('%s', (_name, date, rule) => {
    const { plan, findings, rows } = run([
      point('Users', date, 1),
      point('Users', '2023-01-01 00:00:00+00:00', 2),
    ]);
    expect(rows).toEqual([row('Users', '2023-01', 2)]);
    expect(findings.map((f) => f.rule)).toEqual([rule]);
    expect(plan.points).toMatchObject({ read: 2, kept: 1, dropped: 1 });
  });

  it.each([
    ['1900-01 is the first month accepted', '1900-01-01 00:00:00+00:00', 1],
    ['the current month is accepted', '2026-11-01 00:00:00+00:00', 1],
    ['the month before the current one is accepted', '2026-10-31 23:59:59+00:00', 1],
  ])('%s', (_name, date, kept) => {
    expect(run([point('Users', date, 1)]).plan.points.kept).toBe(kept);
  });
});

describe('the months a 0 left out (decision 13)', () => {
  const points = [
    point('Users', '2023-01-01 00:00:00+00:00', 5),
    point('Users', '2023-04-01 00:00:00+00:00', 8),
    point('Other', '2023-02-01 00:00:00+00:00', 1),
  ];
  it('fills between the first and the last point of each KPI, never before or after', () => {
    const { rows, plan, findings } = run(points, true);
    expect(rows.filter((r) => r.kpi === 'Users')).toEqual([
      row('Users', '2023-01', 5),
      row('Users', '2023-02', 0),
      row('Users', '2023-03', 0),
      row('Users', '2023-04', 8),
    ]);
    expect(rows.filter((r) => r.kpi === 'Other')).toEqual([row('Other', '2023-02', 1)]);
    expect(plan.points.filled).toBe(2);
    expect(findings.map((f) => `${f.rule}`)).toEqual(['measurement.gap-filled']);
  });
  it('leaves the months empty when the mapping says so', () => {
    const { rows, plan } = run(points, false);
    expect(rows.map((r) => `${r.kpi}${r.period}`)).toEqual([
      'Users2023-01',
      'Other2023-02',
      'Users2023-04',
    ]);
    expect(plan.points.filled).toBe(0);
  });
  it('fills across a year end', () => {
    const { rows } = run(
      [
        point('Users', '2022-11-01 00:00:00+00:00', 1),
        point('Users', '2023-02-01 00:00:00+00:00', 1),
      ],
      true,
    );
    expect(rows.map((r) => r.period)).toEqual(['2022-11', '2022-12', '2023-01', '2023-02']);
  });
});

describe('batches', () => {
  const months = (n: number): MeasurementRow[] =>
    Array.from({ length: n }, (_, i) =>
      row('Users', `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, i),
    );
  it.each([
    [0, []],
    [1, [1]],
    [120, [120]],
    [121, [120, 1]],
    [240, [120, 120]],
    [241, [120, 120, 1]],
  ])('%i month(s) of one KPI → batches of %j', (n, sizes) => {
    expect(batchesOf(months(n)).map((b) => b.length)).toEqual(sizes);
  });
  it('never splits the rows of one month', () => {
    const rows = months(121).flatMap((r) => [r, { ...r, kpi: 'Other' }]);
    const batches = batchesOf(rows);
    expect(batches.map((b) => new Set(b.map((r) => r.period)).size)).toEqual([120, 1]);
  });
});
