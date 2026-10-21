// What the widgets of kpi.analytics keep in their tile (`config` of the stored dashboard, at most 400 bytes as JSON; M11 sprint 4, ADR-0044). A
// Zod schema per widget: the dashboard validates and defaults the configuration with it, the navigation lists its JSON Schema for the settings
// form, and a configuration that fails is replaced by the widget's defaults (`parseWidgetConfig`, which never throws).
//
// `service` **absent** means the tile was never set up: the widget then shows the person's defaults and, in edit mode, takes them
// (a new widget starts with the defaults). `service: null` is a choice that was made: "Choose a service". `range` and `category` are always applied.
//
// The per-series states of the trends chart (cumulative, hidden, on the second axis) are lists of **short ids**: the last 12 hex digits of the
// KPI's id (48 random bits, so no two KPIs of one service share one in practice). Full ids would not fit 400 bytes for more than a few KPIs.
import { z } from '@scorpion/contracts';
import { RANGES } from './range.ts';
import { MAX_CATEGORY_LENGTH, MAX_SERIES_STATES, SHORT_ID } from './widget-limits.ts';

export { MAX_CATEGORY_LENGTH, MAX_SERIES_STATES };

const shortId = z.string().regex(SHORT_ID, 'must be 12 lower-case hexadecimal digits');
const states = z
  .array(shortId)
  .max(MAX_SERIES_STATES)
  .default([])
  .refine((list) => new Set(list).size === list.length, 'must not repeat a KPI');

const filter = {
  service: z
    .uuid()
    .nullable()
    .optional()
    .describe(
      'The service the widget shows; `null` means "Choose a service"; absent means never set up.',
    ),
  range: z.enum(RANGES).default('1y').describe('The window; always applied.'),
  category: z
    .string()
    .min(1)
    .max(MAX_CATEGORY_LENGTH)
    .default('all')
    .describe('A key of the vocabulary `thematic-category`, or `all`.'),
};

/** The KPI cards, the averages and the volatility bars: the dashboard's filter only. */
export const filterConfigSchema = z.strictObject(filter);

/** The trends chart: the filter and, per KPI, whether it is cumulative, hidden or on the second axis. */
export const trendsConfigSchema = z
  .strictObject({ ...filter, cumulative: states, hidden: states, secondary: states })
  .refine(
    (config) =>
      config.cumulative.length + config.hidden.length + config.secondary.length <=
      MAX_SERIES_STATES,
    `at most ${MAX_SERIES_STATES} series options in all`,
  );

export type FilterConfig = z.output<typeof filterConfigSchema>;
export type TrendsConfig = z.output<typeof trendsConfigSchema>;

/**
 * Whatever is stored, as a valid configuration of the schema: the input if it fits, else the schema's defaults. Pure; never throws, and the
 * result always fits the schema (so parsing it again changes nothing).
 */
export function parseWidgetConfig<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : schema.parse({});
}
