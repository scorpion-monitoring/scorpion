// The only file other modules may import. A module that contributes pages, links, cards or themes
// does not call a service: it lists them under `contributes` in its manifest (`ui.routes`, `ui.nav`,
// `ui.widget`, `ui.theme`) and names `@scorpion/core-ui-shell` as an optional peer dependency, so that
// it still starts in a profile without the shell. These are the shapes of the entries. The browser half
// of a page (`UiRoute`) is typed in `@scorpion/contracts`.
export type { NavEntry, RouteEntry, ThemeEntry, WidgetEntry } from './registries.ts';
export type {
  Navigation,
  NavigationItem,
  NavigationService,
  WidgetItem,
} from './service/navigation.ts';

/** The registries the shell declares. */
export const UI_REGISTRIES = ['ui.routes', 'ui.nav', 'ui.widget', 'ui.theme'] as const;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.ui-shell': import('./service/navigation.ts').NavigationService;
  }
}
