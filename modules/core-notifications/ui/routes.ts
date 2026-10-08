// The server half of the pages of core.notifications: who may open them. Plain data, so the manifest can use
// it without loading Svelte. The browser half (`./index.ts`) lists the same paths with their components,
// and `ui.test.ts` checks that the two agree.
import type { NavEntry, RouteEntry } from '@scorpion/core-ui-shell/public';

export const NOTIFICATION_ROUTES: RouteEntry[] = [
  { path: '/admin/notifications', permission: 'core.notifications.status.read' },
];

export const NOTIFICATION_NAV: NavEntry[] = [
  {
    id: 'admin.notifications',
    label: 'nav.admin.notifications',
    path: '/admin/notifications',
    icon: 'mail',
    section: 'admin',
    order: 55,
    permission: 'core.notifications.status.read',
  },
];
