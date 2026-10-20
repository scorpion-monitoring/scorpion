// The months the page offers. They come from the coverage read, whose last month is the current one **by the server's clock**; the browser's
// date is never asked, so a wrong clock cannot offer a future month. Pure.
import type { CoverageMonth } from './types.ts';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` of a period (`YYYY-MM-DD`, the last day of a month). */
export const monthOf = (period: string): string => period.slice(0, 7);

/** The offered months, newest first (the coverage is oldest first). */
export function offeredMonths(coverage: readonly Pick<CoverageMonth, 'period'>[]): string[] {
  return coverage.map((entry) => monthOf(entry.period)).reverse();
}

/**
 * The month to open: the one asked for when it is offered, or older than everything offered (so certainly not in the future; a person may
 * correct an old month), else the newest offered (the current month). `undefined` when nothing is offered.
 */
export function chooseMonth(
  requested: string | undefined,
  offered: readonly string[],
): string | undefined {
  const newest = offered[0];
  const oldest = offered[offered.length - 1];
  if (newest === undefined || oldest === undefined) return undefined;
  if (requested === undefined || !MONTH.test(requested)) return newest;
  if (offered.includes(requested)) return requested;
  // `YYYY-MM` sorts as text, and an older month than the oldest offered is no later than the current one.
  return requested < oldest ? requested : newest;
}

/** The months to put in a select: the offered ones, and the chosen one when it is older than they are. */
export function monthChoices(offered: readonly string[], chosen: string | undefined): string[] {
  return chosen !== undefined && !offered.includes(chosen) ? [...offered, chosen] : [...offered];
}

/** "May 2026" in the person's language, from `YYYY-MM`, in UTC so that no time zone moves the month. The text itself if it is no month. */
export function monthLabel(month: string, locale: string): string {
  const match = MONTH.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
