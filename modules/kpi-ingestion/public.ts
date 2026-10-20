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
  PERMISSION_INGEST,
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
  getRunRoute,
  listAdaptersRoute,
  listRunsRoute,
  MAX_UPLOAD_BODY_BYTES,
  previewRoute,
  runRoute,
  templateRoute,
} from './routes-ingestion.ts';
// The registry of ways to give values, for a module that contributes one (the form, CSV and XLSX adapters are entries of it).
export {
  ADAPTER_REGISTRY,
  adapterEntrySchema,
  type AdapterContext,
  type AdapterEntry,
  type AdapterInput,
  type AdapterOutput,
} from './service/adapters.ts';
export { escapeCell, unescapeCell } from './service/escape.ts';
export { parseCsv, writeCsv, type CsvResult } from './service/csv.ts';
export { guardXlsx, MAX_INFLATED_BYTES, type GuardResult } from './service/xlsx-guard.ts';
export {
  MAX_FILE_BYTES,
  MAX_FORM_VALUES,
  RUN_LIST_LIMIT,
  sanitiseFileName,
  type AdapterInfo,
  type CellVerdict,
  type IngestInput,
  type IngestionService,
  type PreviewResult,
  type RunRecord,
  type RunResult,
  type TemplateFile,
} from './service/ingestion.ts';
export {
  PROBLEM_MESSAGES,
  type ColumnMapping,
  type ProblemCode,
  type TableProblem,
} from './service/table.ts';
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
