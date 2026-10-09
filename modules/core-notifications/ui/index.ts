// The browser half of the pages of core.notifications. Only the web app imports this file (ADR-0027); the
// server half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two agree.
import type { UiRoute } from '@scorpion/contracts';
import { loadInbox, loadPreferences, loadStatus } from './loaders.ts';

export { messages } from './messages.ts';
export { widgets } from './widgets.ts';

const routes: UiRoute[] = [
  { path: '/inbox', load: loadInbox, component: () => import('./Inbox.svelte') },
  {
    path: '/profile/notifications',
    load: loadPreferences,
    component: () => import('./Preferences.svelte'),
  },
  {
    path: '/admin/notifications',
    load: loadStatus,
    component: () => import('./Status.svelte'),
  },
];

export default routes;
