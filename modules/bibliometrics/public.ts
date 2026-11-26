// The only file other modules may import. Nothing depends on bibliometrics yet; this offers the permission ids, the limits,
// the names of the job, the event, the registry and the secret, and the route definitions (for their contract tests in
// apps/server). Nothing reads `biblio_*` except through the service.
export { PERMISSION_READ, PERMISSION_WRITE, RESOURCE_SERVICE } from './service/permissions.ts';
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './service/publications.ts';
export { DEMO_PUBLICATIONS } from './service/demo-seed.ts';
export {
  addPublicationRoute,
  datePublicationRoute,
  historyPointSchema,
  listPublicationsRoute,
  publicationHistoryRoute,
  publicationHistorySchema,
  publicationListSchema,
  publicationMetadataSchema,
  publicationSchema,
  refreshAcceptedSchema,
  refreshCitationsRoute,
  removePublicationRoute,
  serviceCitationsSchema,
} from './routes.ts';
export {
  HISTORY_MAX_POINTS,
  MANUAL_COOLDOWN_SECONDS,
  REFRESH_JOB,
  CITATIONS_UPDATED_EVENT,
} from './service/citations.ts';
export { CITATION_SOURCE_REGISTRY, OPENALEX_KEY_SECRET } from './service/sources.ts';

import type { BibliometricsService } from './module.ts';

export type BibliometricsPublic = BibliometricsService;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    bibliometrics: BibliometricsPublic;
  }
}
