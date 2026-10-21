// How the widgets write what the reads give them. Pure: no browser, no Svelte. The numbers come from the reads (a widget calculates nothing and
// never turns a text value into a number); this only chooses the words and the way a number is written.

/** A number the way the person's language writes it: at most two decimals, so a ratio does not print twelve. */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** `12` and `-3.5` are plain decimals; `01-02-03` (a duration) and `all well` are not. The test of a shape, not a conversion. */
const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/;

/**
 * The latest value as shown: a number that the server gave as a number and wrote as a plain decimal is written in the person's language
 * (`1234.5` → `1,234.5`); anything else (a duration as `HH-MM-SS`, a text) is shown as the server wrote it, the data's own. The text is never
 * read as a number.
 */
export function formatLatest(
  latest: { value: number | null; text: string },
  locale: string,
): string {
  return latest.value !== null && PLAIN_DECIMAL.test(latest.text)
    ? formatNumber(latest.value, locale)
    : latest.text;
}

export type Direction = 'up' | 'down' | 'flat' | 'none';

export interface ChangeView {
  direction: Direction;
  /** The arrow: ▲ ▼, `=` for no change, and a dash where it is not defined. Never the only signal: the words go with it. */
  arrow: string;
  /** The size of the change without its sign (`12.5 %`), empty where it is not defined. */
  amount: string;
}

/**
 * The change in percent as an arrow, a direction (the component says "up" or "down" in words next to it) and the amount. `null` is "not defined"
 * (fewer than two values, or the oldest is 0), which is `none` and never a zero. A change that rounds to nothing at one decimal is `flat`.
 */
export function changeView(change: number | null, locale: string): ChangeView {
  if (change === null || !Number.isFinite(change))
    return { direction: 'none', arrow: '–', amount: '' };
  const amount = `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(change))} %`;
  if (Math.round(Math.abs(change) * 10) === 0) return { direction: 'flat', arrow: '=', amount };
  return change > 0
    ? { direction: 'up', arrow: '▲', amount }
    : { direction: 'down', arrow: '▼', amount };
}

/** `2026-03-31` → `Mar 2026` in the person's language, for an axis and a table; a string that is not a date is left as it is. */
export function monthLabel(period: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(period);
  if (!match) return period;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), month - 1, 1)));
}

/** The volatility as a percentage: `0.1234` → `12.3 %`. */
export function formatPercent(fraction: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(fraction * 100)} %`;
}

/** How full the bar of a volatility is: the score up to 100 %, so a score above it is a full bar (the number says the rest). */
export function barFill(fraction: number | null): number {
  return fraction === null || !Number.isFinite(fraction) || fraction < 0
    ? 0
    : Math.min(fraction, 1);
}
