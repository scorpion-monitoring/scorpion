// The two registries of kpi.analytics (M11 sprint 3, ADR-0043): the functions that combine the values of a period (`analytics.aggregate`) and
// the scores that describe a series (`analytics.score`). The module contributes its own entries; another module adds one by contributing.
// Entries are validated by a Zod schema at start, and two with one id stop the start.
import { z } from '@scorpion/contracts';
import { avg, band, mape, max, min, sum, type Maybe } from './calc/index.ts';
import type { AnalyticsSettings } from '../settings-schema.ts';

export const AGGREGATE_REGISTRY = 'analytics.aggregate';
export const SCORE_REGISTRY = 'analytics.score';

const key = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a lower-case key')
  .max(32);
const fn = <T>() =>
  z.custom<T>((value) => typeof value === 'function', { message: 'expected a function' });
const labels = z.strictObject({
  en: z.string().min(1).max(100),
  de: z.string().min(1).max(100).optional(),
});

/** What a score says about a series: the number and, when it has bands, the band's name. Both `null` when it is not defined. */
export interface ScoreResult {
  value: number | null;
  band: string | null;
}

/**
 * An aggregate: `id` is the key of a term of the vocabulary `aggregate` (the terms are data, the functions are code). `apply` takes the values
 * of a period, gaps as `null`, and returns a number or `null`; it never throws.
 */
export const aggregateEntrySchema = z.strictObject({
  id: key,
  labels,
  apply: fn<(values: readonly Maybe[]) => number | null>(),
});
export type AggregateEntry = z.output<typeof aggregateEntrySchema>;

/** A score of a series, with the module's settings for its bands. `compute` never throws. */
export const scoreEntrySchema = z.strictObject({
  id: key,
  labels,
  compute: fn<(values: readonly Maybe[], settings: AnalyticsSettings) => ScoreResult>(),
});
export type ScoreEntry = z.output<typeof scoreEntrySchema>;

/** The entries by id; two with the same id stop the start. */
export function indexEntries<T extends { id: string }>(
  what: string,
  entries: readonly T[],
): Map<string, T> {
  const index = new Map<string, T>();
  for (const entry of entries) {
    if (index.has(entry.id))
      throw new Error(`kpi.analytics: two ${what} entries have the id "${entry.id}"`);
    index.set(entry.id, entry);
  }
  return index;
}

// The four functions the terms of the vocabulary `aggregate` map to. The terms themselves are data of `core.settings`.
export const BUILTIN_AGGREGATES: AggregateEntry[] = [
  { id: 'sum', labels: { en: 'Sum', de: 'Summe' }, apply: sum },
  { id: 'avg', labels: { en: 'Average', de: 'Durchschnitt' }, apply: avg },
  { id: 'min', labels: { en: 'Minimum', de: 'Minimum' }, apply: min },
  { id: 'max', labels: { en: 'Maximum', de: 'Maximum' }, apply: max },
];

/** The id of the aggregate the summary shows as the average, and of the score it shows as the volatility. */
export const AGGREGATE_AVERAGE = 'avg';
export const SCORE_VOLATILITY = 'volatility';

export const BUILTIN_SCORES: ScoreEntry[] = [
  {
    id: SCORE_VOLATILITY,
    labels: { en: 'Volatility', de: 'Volatilität' },
    compute(values, settings) {
      const value = mape(values);
      return { value, band: band(value, settings.volatility.thresholds) };
    },
  },
];
