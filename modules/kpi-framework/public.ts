// The only file other modules may import. It offers what a contributing or consuming module needs: the
// registry of value types with its entry shape and the pure parsers (`kpi.ingestion` and `kpi.analytics`
// use the same entries), the IRI builder, and the names of the vocabularies.
export {
  boundsProblem,
  formatDuration,
  parseDuration,
  parseFloatValue,
  parseInteger,
  parsePercentage,
  parseText,
  QUALITATIVE_VALUE_TYPE,
  SEED_VALUE_TYPES,
  VALUE_TYPE_REGISTRY,
  valueTypeEntrySchema,
  type ParseResult,
  type ValueTypeConfig,
  type ValueTypeEntry,
} from './service/value-types.ts';
export {
  iriBaseProblem,
  iriFor,
  IRI_KINDS,
  resolveIriBase,
  type IriKind,
  type IriRequest,
} from './service/iri.ts';
export {
  AGGREGATE_VOCABULARY,
  AUTOMATION_TOOL_VOCABULARY,
  MEASURED_BY_VOCABULARY,
  NECESSITY_VOCABULARY,
  SERVICE_CATEGORY_VOCABULARY,
  THEMATIC_CATEGORY_VOCABULARY,
  UNIT_VOCABULARY,
} from './service/vocabularies.ts';
export { SEED_UNITS, unitMetadata, type UnitSeed } from './config/units.ts';

import type { KpiFrameworkService } from './module.ts';

export type KpiFrameworkPublic = KpiFrameworkService;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'kpi.framework': KpiFrameworkPublic;
  }
}
