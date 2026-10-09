// The only file other modules may import. A module that contributes pages, links, cards or themes
// does not call a service: it lists them under `contributes` in its manifest (`ui.routes`, `ui.nav`,
// `ui.widget`, `ui.theme`) and names `@scorpion/core-ui-shell` as an optional peer dependency, so that
// it still starts in a profile without the shell. These are the shapes of the entries. The browser half
// of a page (`UiRoute`) is typed in `@scorpion/contracts`.
export { REGISTRIES } from './registries.ts';
export type { NavEntry, RouteEntry, ThemeEntry, WidgetEntry } from './registries.ts';
export type {
  Navigation,
  NavigationItem,
  NavigationService,
  WidgetItem,
} from './service/navigation.ts';

/**
 * The pages that anyone may open, signed in or not. A public page is declared here and in the module that
 * owns it; `apps/server/src/ui-routes.test.ts` fails for a public page that is missing from this list and
 * for an entry here that no module registers, so a page cannot become public by accident (CLAUDE.md,
 * security rules: public endpoints are listed and justified).
 */
export const PUBLIC_PAGES: readonly string[] = [
  '/',
  '/docs',
  '/legal/:page',
  // core.identity: the sign-in, registration and recovery pages, and the first-admin form of a fresh install.
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/link-sign-in',
  '/setup',
];

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.ui-shell': import('./service/navigation.ts').NavigationService;
  }
}
