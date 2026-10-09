// The browser half of the pages of registry.organisations. Only the web app imports this file
// (ADR-0027); the server half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two
// agree.
import type { UiRoute, UiWidgets } from '@scorpion/contracts';
import { loadOrganisation } from './loaders.ts';

export { messages } from './messages.ts';

export const widgets: UiWidgets = {};

const routes: UiRoute[] = [
  {
    path: '/organisations/:id',
    load: loadOrganisation,
    component: () => import('./Organisation.svelte'),
  },
];

export default routes;
