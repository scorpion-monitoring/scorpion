// The server half of the pages of kpi.framework: who may open them. Plain data, so the manifest can use it
// without loading Svelte. The browser half (`./index.ts`) lists the same paths with their components, and
// `ui.test.ts` checks that the two agree. Every page is the administrator's: it calls routes that need
// `manage` (the plain `read` of a signed-in person serves the service pages of sprint 3). What a page draws is
// decided by the API, not by the page.
import type { NavEntry, RouteEntry } from '@scorpion/core-ui-shell/public';

const INDICATOR_MANAGE = 'kpi.framework.indicator.manage';
const SET_MANAGE = 'kpi.framework.set.manage';

export const KPI_ROUTES: RouteEntry[] = [
  { path: '/kpi/indicators', permission: INDICATOR_MANAGE },
  { path: '/kpi/indicators/new', permission: INDICATOR_MANAGE },
  { path: '/kpi/indicators/:id', permission: INDICATOR_MANAGE },
  { path: '/kpi/sets', permission: SET_MANAGE },
  { path: '/kpi/sets/new', permission: SET_MANAGE },
  { path: '/kpi/sets/:id', permission: SET_MANAGE },
];

export const KPI_NAV: NavEntry[] = [
  {
    id: 'admin.kpi.indicators',
    label: 'nav.admin.kpi.indicators',
    path: '/kpi/indicators',
    icon: 'list',
    section: 'admin',
    order: 50,
    permission: INDICATOR_MANAGE,
  },
  {
    id: 'admin.kpi.sets',
    label: 'nav.admin.kpi.sets',
    path: '/kpi/sets',
    icon: 'book',
    section: 'admin',
    order: 51,
    permission: SET_MANAGE,
  },
];
