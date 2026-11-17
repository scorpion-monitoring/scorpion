// The only file other modules may import. Nothing depends on kpi.impact yet; it offers the permission id, the pure counting and the service type.
export { PERMISSION_READ } from './service/permissions.ts';
export {
  countTiles,
  STAGE_VOCABULARY,
  type LicenceFact,
  type StageLine,
  type StageTerm,
  type TileInput,
  type TileRow,
  type Tiles,
} from './service/tiles.ts';
export {
  DEFAULT_TABLE_PAGE_SIZE,
  MAX_TABLE_PAGE_SIZE,
  YEARS_OFFERED,
  type ConsortiumView,
  type ImpactService,
  type SummaryQuery,
  type TableQuery,
  type TableView,
} from './service/impact.ts';
export {
  ROW_REASONS,
  type ImpactRow,
  type RowHeadline,
  type RowReason,
  type RowState,
} from './service/rows.ts';
export { monthEnds, yearFigure, type AggregateFn, type YearFigure } from './service/year.ts';
export { getConsortiaRoute, getSummaryRoute, getTableRoute } from './routes.ts';

import type { KpiImpactService } from './module.ts';

export type KpiImpactPublic = KpiImpactService;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'kpi.impact': KpiImpactPublic;
  }
}
