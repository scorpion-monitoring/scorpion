// The only file other modules may import. It offers what a caller of the measurements needs: the permission id, the pure
// period and value functions (the adapters of sprint 3 and the routes of sprint 2 use the same ones), the limits, and the
// service. Nothing reads `kpii_measurement` except through the service (sprint 2 adds the reads).
export { daysInMonth, MIN_YEAR, normalisePeriod, PERIOD_FORMS } from './service/period.ts';
export { PERMISSION_SUBMIT, RESOURCE_SERVICE } from './service/permissions.ts';
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
