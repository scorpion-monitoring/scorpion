// The server half of the UI of matomo: one invisible widget at the end of every page, open to everybody because anonymous
// visitors are counted too. Plain data, so the manifest can use it without loading Svelte. The browser half is `./widgets.ts`.
import type { WidgetEntry } from '@scorpion/core-ui-shell/public';

export const MATOMO_WIDGETS: WidgetEntry[] = [
  { id: 'matomo.tracker', slot: 'page-end', component: 'matomo-tracker', order: 100, public: true },
];
