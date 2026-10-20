// The server half of the Data Submission page: who may open it. Plain data, so the manifest can use it without loading Svelte. The browser
// half (`./pages.ts`) lists the same path with its component, and `ui.test.ts` checks that the two agree. The page needs the plain permission
// of the reads it makes; whether the person may submit for a service is decided by the API (the picker lists only those they may), so a person
// with no service sees the page say so. The navigation entry has the same permission, so nobody who cannot open the page sees a dead link.
import type { NavEntry, RouteEntry } from '@scorpion/core-ui-shell/public';
import { PERMISSION_MEASUREMENT_READ } from '../service/permissions.ts';

/** The page of the sprint: `?service=<id>` opens it on a service, `&period=YYYY-MM` on a month (the link of the reminder, sprint 5). */
export const SUBMIT_PATH = '/submit';

export const INGESTION_ROUTES: RouteEntry[] = [
  { path: SUBMIT_PATH, permission: PERMISSION_MEASUREMENT_READ },
];

export const INGESTION_NAV: NavEntry[] = [
  {
    id: 'services.submit',
    label: 'nav.submit',
    path: SUBMIT_PATH,
    icon: 'upload',
    section: 'main',
    order: 21,
    permission: PERMISSION_MEASUREMENT_READ,
  },
];
