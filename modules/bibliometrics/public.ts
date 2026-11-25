// The only file other modules may import. Nothing depends on bibliometrics in sprint 1; this offers the permission ids,
// the limits and the route definitions (for their contract tests in apps/server). Nothing reads `biblio_*` except through
// the service.
export { PERMISSION_READ, PERMISSION_WRITE, RESOURCE_SERVICE } from './service/permissions.ts';
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './service/publications.ts';
export { DEMO_PUBLICATIONS } from './service/demo-seed.ts';
export {
  addPublicationRoute,
  listPublicationsRoute,
  publicationMetadataSchema,
  publicationSchema,
  removePublicationRoute,
} from './routes.ts';

import type { BibliometricsService } from './module.ts';

export type BibliometricsPublic = BibliometricsService;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    bibliometrics: BibliometricsPublic;
  }
}
