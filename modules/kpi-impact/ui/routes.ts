// The server half of the impact page: who may open it. Plain data, so the manifest can use it without loading Svelte. The browser half
// (`./pages.ts`) lists the same path with its component, and `ui.test.ts` checks that the two agree. The page, its navigation entry and the routes it
// calls name the same plain permission, so nobody who cannot read the figures sees a link to the page, and the shell refuses the page for them.
import type { NavEntry, RouteEntry } from '@scorpion/core-ui-shell/public';
import { PERMISSION_READ } from '../service/permissions.ts';

/** The path of the legacy page (FEATURES §3.9), which the Reviewers' bookmarks and the old documentation name. */
export const EVALUATE_PATH = '/services/evaluate';

export const IMPACT_ROUTES: RouteEntry[] = [{ path: EVALUATE_PATH, permission: PERMISSION_READ }];

export const IMPACT_NAV: NavEntry[] = [
  {
    id: 'services.impact',
    label: 'nav.impact',
    path: EVALUATE_PATH,
    icon: 'chart',
    section: 'main',
    order: 22,
    permission: PERMISSION_READ,
  },
];
