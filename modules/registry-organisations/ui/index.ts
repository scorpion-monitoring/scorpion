// The browser half of the pages of registry.organisations. Only the web app imports this file
// (ADR-0027); the server half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two
// agree.
import type { UiRoute, UiWidgets } from '@scorpion/contracts';
import {
  loadAccountOrganisations,
  loadAdminMemberships,
  loadAdminOrganisation,
  loadAdminOrganisations,
  loadNewOrganisation,
  loadOrganisation,
  loadPublicOrganisation,
} from './loaders.ts';

export { messages } from './messages.ts';

export const widgets: UiWidgets = {
  'membership-requests': () => import('./MembershipRequestsCard.svelte'),
};

const routes: UiRoute[] = [
  {
    path: '/organisations/:id',
    load: loadOrganisation,
    component: () => import('./Organisation.svelte'),
  },
  {
    path: '/admin/organisations',
    load: loadAdminOrganisations,
    component: () => import('./admin/Organisations.svelte'),
  },
  {
    path: '/admin/organisations/new',
    load: loadNewOrganisation,
    component: () => import('./admin/OrganisationEdit.svelte'),
  },
  {
    path: '/admin/organisations/:id',
    load: loadAdminOrganisation,
    component: () => import('./admin/OrganisationEdit.svelte'),
  },
  {
    path: '/account/organisations',
    load: loadAccountOrganisations,
    component: () => import('./AccountOrganisations.svelte'),
  },
  {
    path: '/public/organisations/:id',
    load: loadPublicOrganisation,
    component: () => import('./PublicOrganisation.svelte'),
  },
  {
    path: '/admin/memberships',
    load: loadAdminMemberships,
    component: () => import('./admin/Memberships.svelte'),
  },
];

export default routes;
