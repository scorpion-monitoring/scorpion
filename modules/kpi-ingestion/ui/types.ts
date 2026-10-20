// The shapes of what the page reads and sends, taken from the generated types of the typed client, so a change of a route shows up here.
import type { paths } from '@scorpion/contracts/client';

type Answer<Path extends keyof paths, Method extends 'get' | 'post'> =
  paths[Path] extends Record<
    Method,
    { responses: { 200: { content: { 'application/json': infer Body } } } }
  >
    ? Body
    : never;

/** One indicator of the effective KPI set with the value stored for the month. */
export type GridRow = Answer<'/kpi/measurements', 'get'>['result'][number];
export type CoverageMonth = Answer<'/kpi/measurements/coverage', 'get'>['result'][number];
export type RunRecord = Answer<'/kpi/ingestion/runs', 'get'>['result'][number];
export type Adapter = Answer<'/kpi/ingestion/adapters', 'get'>['result'][number];
export type PickerService = Answer<'/kpi/ingestion/services', 'get'>['result'][number];
export type ValueType = Answer<'/kpi/value-types', 'get'>['result'][number];
export type Preview = Answer<'/kpi/ingestion/preview', 'post'>;
export type RunResult = Answer<'/kpi/ingestion/runs', 'post'>;
export type Problem = RunResult['problems'][number];
export type Verdict = RunResult['rows'][number]['verdict'];
