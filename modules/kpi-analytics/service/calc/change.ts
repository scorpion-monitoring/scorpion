import { finiteOrNull, present, type Maybe } from './numbers.ts';

/**
 * The change from the oldest to the newest value of a window, in percent: `(newest - oldest) / |oldest| * 100`. The oldest and the newest are
 * the first and the last month that **have** a value (a gap at either end is not a zero). `null`, shown "n/a", when fewer than two values
 * exist or the oldest is 0 (a change from nothing has no percentage). The absolute value in the denominator keeps the sign meaning "up" or "down"
 * also when the values are negative.
 */
export function changePercent(values: readonly Maybe[]): number | null {
  const found = present(values);
  if (found.length < 2) return null;
  const oldest = found[0]!;
  const newest = found[found.length - 1]!;
  if (oldest === 0) return null;
  return finiteOrNull(((newest - oldest) / Math.abs(oldest)) * 100);
}
