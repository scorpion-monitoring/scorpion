// The server half of the pages and widgets of core.notifications: who may open them. Plain data, so the
// manifest can use it without loading Svelte. The browser half (`./index.ts`, `./widgets.ts`) lists the same
// paths and names with their components, and `ui.test.ts` checks that the two agree.
import type { NavEntry, RouteEntry, WidgetEntry } from '@scorpion/core-ui-shell/public';

export const NOTIFICATION_ROUTES: RouteEntry[] = [
  { path: '/inbox', permission: 'core.notifications.inbox.read' },
  { path: '/profile/notifications', permission: 'core.notifications.preference.read' },
  { path: '/admin/notifications', permission: 'core.notifications.status.read' },
];

export const NOTIFICATION_NAV: NavEntry[] = [
  {
    id: 'account.inbox',
    label: 'nav.inbox',
    path: '/inbox',
    icon: 'bell',
    section: 'account',
    order: 20,
    permission: 'core.notifications.inbox.read',
  },
  {
    id: 'account.notifications',
    label: 'nav.notificationSettings',
    path: '/profile/notifications',
    icon: 'settings',
    section: 'account',
    order: 30,
    permission: 'core.notifications.preference.read',
  },
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

export const NOTIFICATION_WIDGETS: WidgetEntry[] = [
  {
    id: 'notifications.bell',
    slot: 'header',
    component: 'inbox-bell',
    order: 10,
    permission: 'core.notifications.inbox.read',
  },
  {
    id: 'notifications.dead-deliveries',
    slot: 'dashboard',
    component: 'dead-deliveries',
    order: 20,
    permission: 'core.notifications.status.read',
  },
];
