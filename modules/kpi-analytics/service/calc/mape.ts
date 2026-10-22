import { avg } from './aggregate.ts';
import { finiteOrNull, present, type Maybe } from './numbers.ts';

/**
 * How volatile a series is, as the legacy page meant it: the **mean absolute percentage deviation from the mean**,
 * `mean(|value - mean|) / |mean|`, as a fraction (0.4 is 40 %). Over the values that exist. `null` ("n/a") when fewer than two values exist
 * or the mean is 0 (a percentage of nothing). A constant series is exactly 0, not a rounding error near it.
 */
export function mape(values: readonly Maybe[]): number | null {
  const found = present(values);
  if (found.length < 2) return null;
  const first = found[0]!;
  if (found.every((value) => value === first)) return first === 0 ? null : 0;
  const mean = avg(found);
  if (mean === null || mean === 0) return null;
  const deviation =
    found.reduce((total, value) => total + Math.abs(value - mean), 0) / found.length;
  return finiteOrNull(deviation / Math.abs(mean));
}

/** The two limits of the bands of {@link mape}, from the module's settings. */
export interface Thresholds {
  low: number;
  high: number;
}

/** The names of the bands, in order. A closed result of the calculation, not a vocabulary. */
export type Band = 'low' | 'medium' | 'high';

/**
 * The band of a score: below `low` is `low`, from `low` up to but not including `high` is `medium`, from `high` up is `high`. `null` when the
 * score is not defined or the thresholds are not `0 < low < high` (a setting the schema refuses, so only a bad caller reaches this).
 */
export function band(score: number | null, thresholds: Thresholds): Band | null {
  if (!isScore(score)) return null;
  const { low, high } = thresholds ?? {};
  if (!(Number.isFinite(low) && Number.isFinite(high) && low > 0 && low < high)) return null;
  return score < low ? 'low' : score < high ? 'medium' : 'high';
}

const isScore = (score: unknown): score is number =>
  typeof score === 'number' && Number.isFinite(score) && score >= 0;
