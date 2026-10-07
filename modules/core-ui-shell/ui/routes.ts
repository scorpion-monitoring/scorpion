// The server half of the shell's own pages: who may open them. Plain data, so the manifest can use it
// without loading Svelte. The browser half (`./index.ts`) lists the same paths with their components,
// and a test checks that the two agree.
import type { NavEntry, RouteEntry } from '../registries.ts';

/**
 * The administration pages of roles and settings. They are the shell's because `core.authz` and `core.settings`
 * cannot contribute pages: the shell depends on both, and an optional peer counts as an edge of the module
 * graph, so a contribution from either would be a cycle. Each needs the permission of the routes it reads; a
 * change is checked again by the route it calls.
 */
export const ADMIN_ROUTES: RouteEntry[] = [
  { path: '/admin/roles', permission: 'core.authz.role.read' },
  { path: '/admin/settings', permission: 'core.settings.read' },
  { path: '/admin/settings/branding', permission: 'core.settings.read' },
  { path: '/admin/settings/secrets', permission: 'core.settings.read' },
  // Reading terms is self-service (forms need them); this page is for changing them.
  { path: '/admin/settings/vocabularies', permission: 'core.settings.vocabulary.write' },
  { path: '/admin/settings/:module', permission: 'core.settings.read' },
];

export const SHELL_ROUTES: RouteEntry[] = [
  ...ADMIN_ROUTES,
  {
    path: '/',
    public: true,
    publicReason: 'The start page is the first thing a visitor sees, signed in or not.',
  },
  {
    path: '/legal/:page',
    public: true,
    publicReason: 'Terms, privacy policy and imprint must be readable without signing in.',
  },
  {
    path: '/docs',
    public: true,
    publicReason: 'The documentation of the public API is public by design.',
  },
];

export const SHELL_NAV: NavEntry[] = [
  {
    id: 'home',
    label: 'nav.home',
    path: '/',
    icon: 'home',
    section: 'main',
    order: 0,
    public: true,
  },
  {
    id: 'docs',
    label: 'nav.docs',
    path: '/docs',
    icon: 'book',
    section: 'main',
    order: 900,
    public: true,
  },
  {
    id: 'admin.roles',
    label: 'nav.admin.roles',
    path: '/admin/roles',
    icon: 'lock',
    section: 'admin',
    order: 30,
    permission: 'core.authz.role.read',
  },
  {
    id: 'admin.settings',
    label: 'nav.admin.settings',
    path: '/admin/settings',
    icon: 'cog',
    section: 'admin',
    order: 40,
    permission: 'core.settings.read',
  },
];
