// The server half of the pages of core.audit: who may open them. Plain data, so the manifest can use it
// without loading Svelte. The browser half (`./index.ts`) lists the same paths with their components, and
// `ui.test.ts` checks that the two agree. A page needs the permission of the routes it calls first.
import type { NavEntry, RouteEntry } from '@scorpion/core-ui-shell/public';

export const AUDIT_ROUTES: RouteEntry[] = [
  { path: '/admin/logs', permission: 'core.audit.read' },
  { path: '/admin/logs/:id', permission: 'core.audit.read' },
  { path: '/admin/system', permission: 'core.audit.system.read' },
];

export const AUDIT_NAV: NavEntry[] = [
  {
    id: 'admin.logs',
    label: 'nav.admin.logs',
    path: '/admin/logs',
    icon: 'list',
    section: 'admin',
    order: 50,
    permission: 'core.audit.read',
  },
  {
    id: 'admin.system',
    label: 'nav.admin.system',
    path: '/admin/system',
    icon: 'settings',
    section: 'admin',
    order: 60,
    permission: 'core.audit.system.read',
  },
];
