import { finiteOrNull, isNumber, type Maybe } from './numbers.ts';

/**
 * The running total of a series, one entry per input entry. A month with no value stays `null` (it is not a zero, and the line has a gap
 * there); the total carries across it, because a gap adds nothing. A total that stops being a number (an overflow) is `null` from there on.
 */
export function cumulative(values: readonly Maybe[]): (number | null)[] {
  if (!Array.isArray(values)) return [];
  let total = 0;
  let broken = false;
  return values.map((value) => {
    if (!isNumber(value)) return null;
    if (broken) return null;
    const next = finiteOrNull(total + value);
    if (next === null) {
      broken = true;
      return null;
    }
    total = next;
    return total;
  });
}
