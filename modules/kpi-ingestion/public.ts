// The only file other modules may import. It offers what a caller of the measurements needs: the permission ids, the pure
// period, value and name functions (the adapters of sprint 3 and the routes use the same ones), the limits, and the
// service. Nothing reads `kpii_measurement` except through the service.
export {
  daysInMonth,
  MIN_YEAR,
  normalisePeriod,
  normalisePeriodBound,
  PERIOD_FORMS,
} from './service/period.ts';
export {
  PERMISSION_MEASUREMENT_READ,
  PERMISSION_SUBMIT,
  PERMISSION_V1_READ,
  PERMISSION_V1_WRITE,
  RESOURCE_SERVICE,
} from './service/permissions.ts';
export {
  resolveIndicatorRef,
  type IndicatorChoice,
  type IndicatorRefResult,
} from './service/names.ts';
export {
  DEFAULT_COVERAGE_MONTHS,
  MANDATORY_NECESSITY,
  MAX_COVERAGE_MONTHS,
  MAX_INDICATOR_FILTER,
  type CoverageMonth,
  type GridRow,
  type MeasurementRead,
  type MonthGrid,
  type ReadsService,
  type SeriesQuery,
} from './service/reads.ts';
// The route definitions, for their contract tests (`apps/server/src/measurements.contract.test.ts`).
export {
  listMeasurementsV1Route,
  MAX_API_BODY_BYTES,
  MAX_API_ITEMS,
  writeMeasurementsV1Route,
} from './routes-v1.ts';
export { getCoverageRoute, getGridRoute } from './routes.ts';
export {
  MAX_BATCH_MONTHS,
  MAX_BATCH_ROWS,
  MAX_PROBLEMS,
  type MeasurementInput,
  type MeasurementsService,
  type RowResult,
  type UpsertOptions,
  type UpsertResult,
  type Verdict,
} from './service/measurements.ts';
export {
  fromColumns,
  MAX_TEXT_VALUE,
  sameColumns,
  toColumns,
  type ValueColumns,
} from './service/values.ts';

import type { KpiIngestionService } from './module.ts';

export type KpiIngestionPublic = KpiIngestionService;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'kpi.ingestion': KpiIngestionPublic;
  }
}
