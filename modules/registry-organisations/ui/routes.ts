// The server half of the pages of registry.organisations: who may open them. Plain data, so the manifest
// can use it without loading Svelte. The browser half (`./index.ts`) lists the same paths with their
// components, and `ui.test.ts` checks that the two agree. A page needs the permission of the routes it
// calls first; what a caller may change on it is decided by the API (`editableFields`), not by the page.
import type { NavEntry, RouteEntry } from '@scorpion/core-ui-shell/public';

export const ORGANISATION_ROUTES: RouteEntry[] = [
  { path: '/organisations/:id', permission: 'registry.organisations.organisation.read' },
  { path: '/admin/organisations', permission: 'registry.organisations.organisation.manage' },
  { path: '/admin/organisations/new', permission: 'registry.organisations.organisation.manage' },
  { path: '/admin/organisations/:id', permission: 'registry.organisations.organisation.manage' },
];

export const ORGANISATION_NAV: NavEntry[] = [
  {
    id: 'admin.organisations',
    label: 'nav.admin.organisations',
    path: '/admin/organisations',
    icon: 'users',
    section: 'admin',
    order: 40,
    permission: 'registry.organisations.organisation.manage',
  },
];
