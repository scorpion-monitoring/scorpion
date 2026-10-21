import { finiteOrNull, present, type Maybe } from './numbers.ts';

/** The sum of the values that exist; `null` when there are none, or when the sum does not fit a number. A gap adds nothing, it is not a zero. */
export function sum(values: readonly Maybe[]): number | null {
  const found = present(values);
  if (found.length === 0) return null;
  return finiteOrNull(found.reduce((total, value) => total + value, 0));
}

/** The smallest value that exists, or `null`. */
export function min(values: readonly Maybe[]): number | null {
  const found = present(values);
  return found.length === 0 ? null : finiteOrNull(found.reduce((a, b) => (b < a ? b : a)));
}

/** The largest value that exists, or `null`. */
export function max(values: readonly Maybe[]): number | null {
  const found = present(values);
  return found.length === 0 ? null : finiteOrNull(found.reduce((a, b) => (b > a ? b : a)));
}

/**
 * The mean of the values that exist, or `null` when there are none. The sum divided by the count; when the sum does not fit a number, the sum of
 * the values each divided by the count (so a series of large numbers still has its mean). Held between the smallest and the largest value, so
 * that rounding never leaves the range.
 */
export function avg(values: readonly Maybe[]): number | null {
  const found = present(values);
  if (found.length === 0) return null;
  const count = found.length;
  let mean = found.reduce((total, value) => total + value, 0) / count;
  if (!Number.isFinite(mean)) mean = found.reduce((total, value) => total + value / count, 0);
  const low = min(found)!;
  const high = max(found)!;
  return finiteOrNull(Math.min(Math.max(mean, low), high));
}
