// The ranges of the analytics reads (M11 sprint 3, ADR-0043 Decision 6): `3m`, `6m`, `1y`, `2y` and `all`, counted back from the **current
// month by the injected clock**. A range is always applied: `all` is a value (the most months one read serves), and a missing range is
// repaired to the default, which is the fix of defect 10 (the legacy page took no duration to mean no date filter).
import { monthsBack } from './calc/index.ts';
import { MAX_SERIES_MONTHS } from '@scorpion/kpi-ingestion/public';

export const RANGES = ['3m', '6m', '1y', '2y', 'all'] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = '1y';

/** How many months each range covers; `all` is the 120 months a series read is bounded to. */
const MONTHS: Record<Range, number> = {
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '2y': 24,
  all: MAX_SERIES_MONTHS,
};

export const isRange = (value: unknown): value is Range =>
  typeof value === 'string' && (RANGES as readonly string[]).includes(value);

/** The range a value names, or `undefined` when it names none. */
export function parseRange(value: unknown): Range | undefined {
  return isRange(value) ? value : undefined;
}

/** The range, or the default for a missing or unknown one: a window is never left open. Never throws. */
export function repairRange(value: unknown): Range {
  return parseRange(value) ?? DEFAULT_RANGE;
}

/** The months of a range ending with the month of `now`, oldest first, each as its last day. */
export function windowOf(range: Range, now: Date): string[] {
  return monthsBack(now, MONTHS[range]);
}
