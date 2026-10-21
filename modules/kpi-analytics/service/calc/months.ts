import { daysInMonth } from '@scorpion/kpi-ingestion/public';
import { isNumber, type Maybe } from './numbers.ts';

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/** The last day of a month as `YYYY-MM-DD`: 29 February in a leap year, the 28th in 1900. `null` for a year or month that is no month. */
export function monthEnd(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(daysInMonth(year, month), 2)}`;
}

/** The `months` months that end with the month of `now` (UTC), oldest first, each as its last day. `[]` for a count that is no whole number from 1. */
export function monthsBack(now: Date, months: number): string[] {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return [];
  if (!Number.isInteger(months) || months < 1) return [];
  const last = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const found: string[] = [];
  for (let at = last - months + 1; at <= last; at++) {
    const end = monthEnd(Math.floor(at / 12), (at % 12) + 1);
    if (end !== null) found.push(end);
  }
  return found;
}

/**
 * Lays points out on the months of a window: one entry per month, the value of the point of that month or `null`. A point of a month outside
 * the window is left out (a window that starts in the middle of a series does not see the months before it), a month with no point is a gap,
 * and two points for one month leave the later one.
 */
export function alignToMonths(
  months: readonly string[],
  points: readonly { period: string; value: Maybe }[],
): (number | null)[] {
  const byMonth = new Map<string, number | null>();
  for (const point of listOf(points)) {
    if (typeof point !== 'object' || point === null) continue;
    byMonth.set(point.period, isNumber(point.value) ? point.value : null);
  }
  return listOf(months).map((month) => byMonth.get(month) ?? null);
}

/** The list itself, or an empty one for anything that is not a list (the library never throws for a caller that hands over the wrong thing). */
function listOf<T>(value: readonly T[]): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}
