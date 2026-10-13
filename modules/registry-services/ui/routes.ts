// The server half of the pages of registry.services: who may open them. Plain data, so the manifest can use it
// without loading Svelte. The browser half (`./index.ts`) lists the same paths with their components, and
// `ui.test.ts` checks that the two agree, except for the pages that are not offered yet (`./offered.ts`). A page
// needs the permission of the routes it calls first; what a caller may change on it is decided by the API
// (`allowedActions`, `editableFields`), not by the page.
import type { NavEntry, RouteEntry } from '@scorpion/core-ui-shell/public';

export const SERVICE_ROUTES: RouteEntry[] = [
  { path: '/services', permission: 'registry.services.service.read' },
  // The wizard is offered since sprint 5; the service page follows in sprint 6 (`offered.ts`).
  { path: '/services/new', permission: 'registry.services.service.create' },
  { path: '/services/:slug', permission: 'registry.services.service.read' },
];

export const SERVICE_NAV: NavEntry[] = [
  {
    id: 'services',
    label: 'nav.services',
    path: '/services',
    icon: 'list',
    section: 'main',
    order: 20,
    permission: 'registry.services.service.read',
  },
];
