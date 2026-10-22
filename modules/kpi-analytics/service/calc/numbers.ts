// The calculation library of kpi.analytics (M11 sprint 3, ADR-0043): pure functions over numbers. Every function takes numbers (a series is
// `(number | null)[]`, oldest month first, `null` for a month with no value) and returns a number or `null`. None throws, none returns `NaN`
// or an infinity, and none turns a gap into a zero: a gap is skipped, and a result that is not defined is `null`, which the page shows as "n/a".

/** A month's value: a number, or `null` for a month with no value. Anything else a caller hands over is treated as a gap. */
export type Maybe = number | null | undefined;

/** Whether `value` is a usable number: finite, so `NaN` and the infinities are gaps. */
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The numbers of a series, in order; gaps (and anything that is not a finite number) left out. */
export function present(values: readonly unknown[]): number[] {
  return Array.isArray(values) ? values.filter(isNumber) : [];
}

/** The number itself, or `null` when it is not finite (an overflow). Also turns `-0` into `0`, so a result never prints as "-0". */
export function finiteOrNull(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}
