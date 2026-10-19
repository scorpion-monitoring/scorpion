// The period of a measurement: always the last day of a month (a check constraint says so). `normalisePeriod` turns what a
// form, a file or the API gives into that day, or says what is wrong in words that name the accepted forms. Pure: the
// clock is a parameter (the current month decides what "the future" is), so no test depends on the day it runs.
import type { ParseResult } from '@scorpion/kpi-framework/public';

/** The accepted forms, for every message that refuses a period. */
export const PERIOD_FORMS = 'a month (YYYY-MM) or a date (YYYY-MM-DD)';
/** The first year accepted; the table's `date` allows more, a measurement from before this is a typo. */
export const MIN_YEAR = 1900;

const PERIOD = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

/** The number of days of a month (`month` 1 to 12) with the Gregorian rule: 1900 was no leap year, 2000 was, 2024 was. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/**
 * `YYYY-MM` or `YYYY-MM-DD` (any day of the month, surrounding spaces ignored) to the last day of that month as
 * `YYYY-MM-DD`. Refused: anything else (a time, another separator, a two-digit year, an empty text), a month that does
 * not exist, a day that is not in its month (`2026-02-30`), a year before {@link MIN_YEAR}, and a month after the current
 * one in UTC (`now`). The problem is a sentence for the person who typed the value; it never repeats the input.
 */
export function normalisePeriod(input: unknown, now: Date): ParseResult<string> {
  const bad = (problem: string): ParseResult<never> => ({ ok: false, problem });
  if (typeof input !== 'string') return bad(`must be ${PERIOD_FORMS}`);
  const match = PERIOD.exec(input.trim());
  if (!match) return bad(`must be ${PERIOD_FORMS}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return bad('is not a month: the month is 01 to 12');
  const length = daysInMonth(year, month);
  if (match[3] !== undefined) {
    const day = Number(match[3]);
    if (day < 1 || day > length) return bad(`is not a date: that month has ${length} days`);
  }
  if (year < MIN_YEAR) return bad(`is too early: the year is ${MIN_YEAR} or later`);
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  if (year * 12 + (month - 1) > current)
    return bad('is in the future: use the current month or an earlier one');
  return { ok: true, value: `${pad(year, 4)}-${pad(month, 2)}-${pad(length, 2)}` };
}
