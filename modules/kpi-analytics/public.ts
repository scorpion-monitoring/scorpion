// The only file other modules may import. It offers the permission id, the ranges, the registries and the pure calculation library, and the
// service. Nothing here reads a table: the module has none.
export { PERMISSION_READ } from './service/permissions.ts';
export {
  DEFAULT_RANGE,
  isRange,
  parseRange,
  RANGES,
  repairRange,
  windowOf,
  type Range,
} from './service/range.ts';
export {
  ALL_CATEGORIES,
  DEFAULTS_PREFERENCE,
  parseDefaults,
  storedDefaultsSchema,
  type Defaults,
} from './service/defaults.ts';
export {
  AGGREGATE_REGISTRY,
  aggregateEntrySchema,
  SCORE_REGISTRY,
  scoreEntrySchema,
  type AggregateEntry,
  type ScoreEntry,
  type ScoreResult,
} from './service/registries.ts';
export * from './service/calc/index.ts';
export { getDefaultsRoute, getSeriesRoute, getSummaryRoute } from './routes.ts';
export type {
  AnalyticsQuery,
  AnalyticsService,
  DefaultsView,
  IndicatorInfo,
  Page,
  SeriesPointOut,
  SeriesRow,
  SummaryRow,
} from './service/analytics.ts';

import type { KpiAnalyticsService } from './module.ts';

export type KpiAnalyticsPublic = KpiAnalyticsService;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'kpi.analytics': KpiAnalyticsPublic;
  }
}
