// The server half of the pages of registry.organisations: who may open them. Plain data, so the manifest
// can use it without loading Svelte. The browser half (`./index.ts`) lists the same paths with their
// components, and `ui.test.ts` checks that the two agree. A page needs the permission of the routes it
// calls first; what a caller may change on it is decided by the API (`editableFields`), not by the page.
import type { NavEntry, RouteEntry, WidgetEntry } from '@scorpion/core-ui-shell/public';

export const ORGANISATION_ROUTES: RouteEntry[] = [
  { path: '/organisations/:id', permission: 'registry.organisations.organisation.read' },
  { path: '/admin/organisations', permission: 'registry.organisations.organisation.manage' },
  { path: '/admin/organisations/new', permission: 'registry.organisations.organisation.manage' },
  { path: '/admin/organisations/:id', permission: 'registry.organisations.organisation.manage' },
  // The member and manager screens. Every signed-in person may open the profile page; the manager section
  // draws itself only when `GET /memberships/summary` says `manages: true`.
  { path: '/account/organisations', permission: 'registry.organisations.organisation.read' },
  { path: '/admin/memberships', permission: 'registry.organisations.organisation.manage' },
];

export const ORGANISATION_NAV: NavEntry[] = [
  {
    id: 'account.organisations',
    label: 'nav.account.organisations',
    path: '/account/organisations',
    icon: 'users',
    section: 'account',
    order: 25,
    permission: 'registry.organisations.organisation.read',
  },
  {
    id: 'admin.organisations',
    label: 'nav.admin.organisations',
    path: '/admin/organisations',
    icon: 'users',
    section: 'admin',
    order: 45,
    permission: 'registry.organisations.organisation.manage',
  },
  {
    id: 'admin.memberships',
    label: 'nav.admin.memberships',
    path: '/admin/memberships',
    icon: 'inbox',
    section: 'admin',
    order: 46,
    permission: 'registry.organisations.organisation.manage',
  },
];

/** The card of the dashboard: the requests waiting for a decision of this caller (nothing is drawn at zero). */
export const ORGANISATION_WIDGETS: WidgetEntry[] = [
  {
    id: 'organisations.membership-requests',
    slot: 'dashboard',
    component: 'membership-requests',
    order: 30,
    permission: 'registry.organisations.organisation.read',
  },
];
