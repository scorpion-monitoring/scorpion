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
export type { ConsortiumView, ImpactService, SummaryQuery } from './service/impact.ts';
export { getConsortiaRoute, getSummaryRoute } from './routes.ts';

import type { KpiImpactService } from './module.ts';

export type KpiImpactPublic = KpiImpactService;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'kpi.impact': KpiImpactPublic;
  }
}
