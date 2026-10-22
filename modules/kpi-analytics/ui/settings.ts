// What the widgets do with their configuration, in the browser. Pure, and free of Zod (the schemas are the server's, `service/widget-config.ts`;
// a widget receives a configuration the server has already repaired).
import { cumulative } from '../service/calc/cumulative.ts';
import { MAX_SERIES_STATES } from '../service/widget-limits.ts';

export const DEFAULT_RANGE = '1y';
export const ALL = 'all';

export interface Filter {
  service: string | null;
  range: string;
  category: string;
}

export interface ResolvedConfig extends Filter {
  /** The tile was never set up (no `service` key): it shows the person's defaults and, in edit mode, takes them. */
  fresh: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The filter a widget reads with. A configuration with a `service` (an id, or `null` for "Choose a service") is its own; one without is fresh and
 * is read as the person's defaults (`null` when they have none). Never an arbitrary service. `defaults` is `undefined` until it has loaded.
 */
export function resolveConfig(
  config: unknown,
  defaults: Filter | undefined,
): ResolvedConfig | undefined {
  const own = isRecord(config) ? config : {};
  const fresh = !('service' in own);
  const own3 = {
    range: typeof own.range === 'string' ? own.range : DEFAULT_RANGE,
    category: typeof own.category === 'string' ? own.category : ALL,
  };
  if (!fresh)
    return { service: typeof own.service === 'string' ? own.service : null, ...own3, fresh };
  return defaults ? { ...defaults, fresh } : undefined;
}

/** The configuration a fresh tile takes in edit mode: its own keys with the defaults for the filter. */
export function seeded(config: Record<string, unknown>, defaults: Filter): Record<string, unknown> {
  return {
    ...config,
    service: defaults.service,
    range: defaults.range,
    category: defaults.category,
  };
}

/** The 12 hex digits that stand for a KPI in a configuration: the end of its id, which is the random part. */
export function shortId(indicatorId: string): string {
  return indicatorId.replaceAll('-', '').slice(-12).toLowerCase();
}

export type SeriesState = 'cumulative' | 'hidden' | 'secondary';

const list = (config: Record<string, unknown>, state: SeriesState): string[] =>
  Array.isArray(config[state])
    ? (config[state] as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];

export const hasState = (
  config: Record<string, unknown>,
  state: SeriesState,
  indicatorId: string,
) => list(config, state).includes(shortId(indicatorId));

/** How many states a configuration holds in all its lists. */
export const stateCount = (config: Record<string, unknown>) =>
  list(config, 'cumulative').length +
  list(config, 'hidden').length +
  list(config, 'secondary').length;

export type Toggled = { ok: true; config: Record<string, unknown> } | { ok: false; reason: 'full' };

/**
 * Switches one KPI's state on or off. Switching **off** always works; switching **on** is refused (`full`) when the configuration would hold
 * more than `MAX_SERIES_STATES` states in all, which is what keeps it within the 400 bytes the dashboard allows a tile.
 */
export function toggleState(
  config: Record<string, unknown>,
  state: SeriesState,
  indicatorId: string,
  on: boolean,
): Toggled {
  const id = shortId(indicatorId);
  const current = list(config, state);
  const has = current.includes(id);
  if (on === has) return { ok: true, config };
  if (on && stateCount(config) >= MAX_SERIES_STATES) return { ok: false, reason: 'full' };
  return {
    ok: true,
    config: { ...config, [state]: on ? [...current, id] : current.filter((entry) => entry !== id) },
  };
}

export interface TrendRow {
  indicatorId: string;
  name: string;
  unit: string | null;
  points: { period: string; value: number | null; text: string | null }[];
}

export interface TrendSeries {
  indicatorId: string;
  name: string;
  /** One value per month; `null` is a gap. Cumulative where the configuration says so. */
  values: (number | null)[];
  hidden: boolean;
  secondary: boolean;
  cumulative: boolean;
}

/**
 * The lines of the trends chart: one per KPI that has a number in the window (a KPI that holds only text has no line; the table says so), with
 * the states of the configuration applied. A cumulative line is the library's running total; a hidden one is still here (the controls list it)
 * and the chart leaves it out.
 */
export function trendSeries(
  rows: readonly TrendRow[],
  config: Record<string, unknown>,
): TrendSeries[] {
  return rows
    .filter((row) => row.points.some((point) => point.value !== null))
    .map((row) => {
      const raw = row.points.map((point) => point.value);
      const isCumulative = hasState(config, 'cumulative', row.indicatorId);
      return {
        indicatorId: row.indicatorId,
        name: row.name,
        values: isCumulative ? cumulative(raw) : raw,
        hidden: hasState(config, 'hidden', row.indicatorId),
        secondary: hasState(config, 'secondary', row.indicatorId),
        cumulative: isCumulative,
      };
    });
}
