// The browser half of the pages of registry.services. Only the web app imports this file (ADR-0027); the
// server half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two agree.
import type { UiRoute, UiWidgets } from '@scorpion/contracts';
import { loadCatalogue, loadNewService } from './loaders.ts';
import { NOT_OFFERED } from './offered.ts';

export { messages } from './messages.ts';

export const widgets: UiWidgets = {};

/** Registered on the server but without a page here yet; the test of the shell reads it (`NOT_OFFERED`). */
export const notOffered = NOT_OFFERED;

const routes: UiRoute[] = [
  {
    path: '/services',
    load: loadCatalogue,
    component: () => import('./Catalogue.svelte'),
  },
  {
    path: '/services/new',
    load: loadNewService,
    component: () => import('./NewService.svelte'),
  },
];

export default routes;
