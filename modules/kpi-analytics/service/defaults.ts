// The preference `kpi.analytics.defaults` (M11 sprint 3): the service, range and thematic category that seed a **new** widget. The stored value
// is never trusted: `parseDefaults` turns whatever is stored into a valid value and never throws.
import { z } from '@scorpion/contracts';
import { DEFAULT_RANGE, RANGES, repairRange, type Range } from './range.ts';

export const DEFAULTS_PREFERENCE = 'kpi.analytics.defaults';
/** The category value that means "no filter". A term of the vocabulary `thematic-category` with this key would be shadowed by it. */
export const ALL_CATEGORIES = 'all';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The shape the preference store checks on a write: a bad range or service is refused (422). Every field is optional, so that a value stored
 * before a field existed still reads; whether a category is a term of the vocabulary cannot be checked here (the vocabulary changes), so the
 * reader drops an unknown one.
 */
export const storedDefaultsSchema = z.strictObject({
  service: z.uuid().optional().describe('The id of the default service.'),
  range: z.enum(RANGES).optional().describe('The default range.'),
  category: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('A key of the vocabulary `thematic-category`, or `all`.'),
});

export interface Defaults {
  service?: string;
  range: Range;
  category: string;
}

/**
 * Whatever is stored, as valid defaults: a service that is not an id is dropped, a range that is missing or unknown becomes `1y`, a category
 * that is not `all` and not in `categories` (the active terms of the vocabulary) becomes `all`. Pure; never throws.
 */
export function parseDefaults(raw: unknown, categories: ReadonlySet<string>): Defaults {
  const stored: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const service =
    typeof stored.service === 'string' && UUID.test(stored.service)
      ? stored.service.toLowerCase()
      : undefined;
  const category =
    typeof stored.category === 'string' && categories.has(stored.category)
      ? stored.category
      : ALL_CATEGORIES;
  return {
    ...(service === undefined ? {} : { service }),
    range: repairRange(stored.range ?? DEFAULT_RANGE),
    category,
  };
}
