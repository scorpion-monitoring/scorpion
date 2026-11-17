// The yearly figure of one headline (M12 sprint 2): twelve months, each a number or a gap, and the aggregate function of the evaluation give the
// year's value and the number of months it is over. Pure. The function comes from the registry `analytics.aggregate` by id and the arithmetic is
// the library of kpi.analytics; nothing here names an aggregate or does its own sums. A gap is `null`, never zero (decision 18 of the M12 plan).
import { monthEnd, present, type Maybe } from '@scorpion/kpi-analytics/public';

export interface YearFigure {
  /** The aggregate over the months that have a value; `null` when none has. */
  yearly: number | null;
  /** How many of the twelve months have a value: the "n of 12" a page shows next to the figure. */
  monthsWithValue: number;
}

/** The function of an `analytics.aggregate` entry: the values of a period, gaps as `null`, a number or `null`. */
export type AggregateFn = (values: readonly Maybe[]) => number | null;

/** The last day of each month of a year, January first (`YYYY-MM-DD`). Empty for a year that is no year. */
export function monthEnds(year: number): string[] {
  const found = Array.from({ length: 12 }, (_, index) => monthEnd(year, index + 1));
  return found.every((end): end is string => end !== null) ? found : [];
}

/** The year of twelve months (the months stay in the order given and are never changed). */
export function yearFigure(months: readonly Maybe[], apply: AggregateFn): YearFigure {
  const monthsWithValue = present(months).length;
  if (monthsWithValue === 0) return { yearly: null, monthsWithValue };
  const yearly = apply(months);
  return {
    yearly: typeof yearly === 'number' && Number.isFinite(yearly) ? yearly : null,
    monthsWithValue,
  };
}
