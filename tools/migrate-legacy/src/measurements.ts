// Transform for the measurements (M13 plan §3, sprint 2): the points of a service's measurement file into one value per
// KPI and month, in batches of at most 120 months. Pure: the clock is a parameter. The rules, in this order:
//   1. a point whose date does not parse, is before 1900 or is in a month after the current one is dropped (reported);
//   2. several points of one KPI in one month (full dates, or one month under two provider names): the latest instant
//      wins, and for the same instant the later point of the file (ADR-0041 has no "last one wins", so the tool picks it);
//      the others are dropped (reported);
//   3. decision 13: the legacy API leaves out every value of 0, so a month missing between a KPI's first and last point is
//      written as 0 (reported per service and KPI), unless the mapping turns it off;
//   4. the rows are cut into batches of at most 120 distinct months (`MAX_BATCH_MONTHS`, ADR-0041: "M13 will chunk its
//      history by ten years") and 25 000 rows.
// The month end itself is the new application's: a batch row carries `YYYY-MM` and `upsertBatch` stores the last day.
import { MAX_BATCH_MONTHS, MAX_BATCH_ROWS, MIN_YEAR } from '@scorpion/kpi-ingestion/public';
import type { MeasurementPoint } from './snapshot.ts';
import type { Finding } from './transform.ts';

export interface MeasurementRow {
  /** The legacy KPI name. */
  kpi: string;
  /** `YYYY-MM`. */
  period: string;
  value: number;
  /** A month missing between two points, written as 0 (decision 13). */
  filled?: true;
}

export interface ServiceMeasurements {
  /** The legacy service abbreviation. */
  service: string;
  /** Rows by KPI and month, in batches of at most 120 distinct months. */
  batches: MeasurementRow[][];
  /** Rows that will be written (points kept plus months filled with 0). */
  rows: number;
  /** Points of the file, and what became of them. */
  points: { read: number; kept: number; merged: number; dropped: number; filled: number };
  /** The values per KPI, for the report of a KPI added to the service (decision 9). */
  perKpi: Map<string, number>;
  /** The points rule 1 dropped, per rule and KPI (`compare` explains them with it). */
  dropped: { rule: string; kpi: string; points: number }[];
  /** The months of rule 2 with several points, and how many points were left out of each. */
  merged: { kpi: string; period: string; points: number }[];
}

export interface MeasurementPlan {
  services: ServiceMeasurements[];
  findings: Finding[];
}

const quote = (value: string) => JSON.stringify(value);
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The next month of `YYYY-MM`. */
function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12
    ? `${String(year + 1).padStart(4, '0')}-01`
    : `${month.slice(0, 5)}${String(m + 1).padStart(2, '0')}`;
}

/** Cuts the rows (sorted by month) into batches of at most 120 distinct months and `MAX_BATCH_ROWS` rows. */
export function batchesOf(rows: readonly MeasurementRow[]): MeasurementRow[][] {
  const batches: MeasurementRow[][] = [];
  let current: MeasurementRow[] = [];
  let months = 0;
  let last = '';
  for (const row of rows) {
    const newMonth = row.period !== last;
    if (
      current.length > 0 &&
      ((newMonth && months >= MAX_BATCH_MONTHS) || current.length >= MAX_BATCH_ROWS)
    ) {
      batches.push(current);
      current = [];
      months = 0;
    }
    if (row.period !== last) months += 1;
    last = row.period;
    current.push(row);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * One service's points to its plan. `service` is the legacy abbreviation (the key of the findings); `points` are in the
 * order of the file.
 */
export function transformService(
  service: string,
  points: readonly MeasurementPoint[],
  options: { now: Date; fillMissingMonths: boolean },
  findings: Finding[],
): ServiceMeasurements {
  const nowMonth = `${String(options.now.getUTCFullYear()).padStart(4, '0')}-${String(options.now.getUTCMonth() + 1).padStart(2, '0')}`;
  const counts = { read: points.length, kept: 0, merged: 0, dropped: 0, filled: 0 };
  const finding = (rule: string, effect: Finding['effect'], detail: string) =>
    findings.push({ kind: 'measurement', legacy: service, rule, effect, detail });

  // 1. dates
  const dropped = new Map<string, Map<string, number>>(); // rule → "kpi" → count
  const drop = (rule: string, kpi: string) => {
    const byKpi = dropped.get(rule) ?? new Map<string, number>();
    byKpi.set(kpi, (byKpi.get(kpi) ?? 0) + 1);
    dropped.set(rule, byKpi);
    counts.dropped += 1;
  };
  type Candidate = { index: number; time: number; value: number };
  const groups = new Map<string, Map<string, Candidate[]>>(); // kpi → month → candidates
  points.forEach((point, index) => {
    const date = point.parsed;
    if (date === undefined) return drop('measurement.date-invalid', point.kpi);
    if (date.year < MIN_YEAR) return drop('measurement.before-1900', point.kpi);
    if (date.month > nowMonth) return drop('measurement.future-month', point.kpi);
    const byMonth = groups.get(point.kpi) ?? new Map<string, Candidate[]>();
    byMonth.set(date.month, [
      ...(byMonth.get(date.month) ?? []),
      { index, time: date.time, value: point.value },
    ]);
    groups.set(point.kpi, byMonth);
  });
  for (const [rule, byKpi] of [...dropped].sort(([a], [b]) => byCode(a, b))) {
    for (const [kpi, n] of [...byKpi].sort(([a], [b]) => byCode(a, b))) {
      finding(
        rule,
        'dropped',
        `${n} point(s) of ${quote(kpi)}: ${
          rule === 'measurement.date-invalid'
            ? 'the date does not parse'
            : rule === 'measurement.before-1900'
              ? `the year is before ${MIN_YEAR}`
              : 'the month is after the current one'
        }`,
      );
    }
  }

  // 2. the latest point of the month, 3. the months a 0 left out
  const rows: MeasurementRow[] = [];
  const perKpi = new Map<string, number>();
  const merges: ServiceMeasurements['merged'] = [];
  for (const kpi of [...groups.keys()].sort(byCode)) {
    const byMonth = groups.get(kpi)!;
    const months = [...byMonth.keys()].sort(byCode);
    for (const month of months) {
      const candidates = byMonth.get(month)!;
      const winner = candidates.reduce((a, b) =>
        b.time > a.time || (b.time === a.time && b.index > a.index) ? b : a,
      );
      rows.push({ kpi, period: month, value: winner.value });
      if (candidates.length > 1) {
        counts.merged += candidates.length - 1;
        merges.push({ kpi, period: month, points: candidates.length - 1 });
        finding(
          'measurement.duplicate-in-month',
          'dropped',
          `${quote(kpi)} ${month}: ${candidates.length} points, the latest one (${winner.value}) is kept`,
        );
      }
    }
    counts.kept += months.length;
    perKpi.set(kpi, months.length);
    if (options.fillMissingMonths && months.length > 1) {
      let missing = 0;
      const present = new Set(months);
      for (
        let month = nextMonth(months[0]!);
        month < months[months.length - 1]!;
        month = nextMonth(month)
      ) {
        if (present.has(month)) continue;
        rows.push({ kpi, period: month, value: 0, filled: true });
        missing += 1;
      }
      if (missing > 0) {
        counts.filled += missing;
        perKpi.set(kpi, months.length + missing);
        finding(
          'measurement.gap-filled',
          'adjusted',
          `${quote(kpi)}: ${missing} month(s) between ${months[0]} and ${months[months.length - 1]} written as 0 (the legacy API leaves out zeros)`,
        );
      }
    }
  }
  rows.sort((a, b) => byCode(a.period, b.period) || byCode(a.kpi, b.kpi));
  return {
    service,
    batches: batchesOf(rows),
    rows: rows.length,
    points: counts,
    perKpi,
    dropped: [...dropped]
      .sort(([a], [b]) => byCode(a, b))
      .flatMap(([rule, byKpi]) =>
        [...byKpi].sort(([a], [b]) => byCode(a, b)).map(([kpi, points]) => ({ rule, kpi, points })),
      ),
    merged: merges,
  };
}

/** Every service's points to plans, in the order of the legacy keys. */
export function transformMeasurements(
  measurements: ReadonlyMap<string, readonly MeasurementPoint[]>,
  options: { now: Date; fillMissingMonths: boolean },
): MeasurementPlan {
  const findings: Finding[] = [];
  const services = [...measurements.keys()]
    .sort(byCode)
    .map((service) => transformService(service, measurements.get(service)!, options, findings));
  return { services, findings };
}
