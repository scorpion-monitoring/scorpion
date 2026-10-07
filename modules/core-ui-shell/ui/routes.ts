// The server half of the shell's own pages: who may open them. Plain data, so the manifest can use it
// without loading Svelte. The browser half (`./index.ts`) lists the same paths with their components,
// and a test checks that the two agree.
import type { NavEntry, RouteEntry } from '../registries.ts';

export const SHELL_ROUTES: RouteEntry[] = [
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
];
