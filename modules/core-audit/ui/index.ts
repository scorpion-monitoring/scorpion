// The browser half of the pages of core.audit. Only the web app imports this file (ADR-0027); the server
// half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two agree.
import type { UiRoute } from '@scorpion/contracts';
import { loadLogEntry, loadLogs, loadSystem } from './loaders.ts';

export { messages } from './messages.ts';

const routes: UiRoute[] = [
  { path: '/admin/logs', load: loadLogs, component: () => import('./Logs.svelte') },
  { path: '/admin/logs/:id', load: loadLogEntry, component: () => import('./LogEntry.svelte') },
  { path: '/admin/system', load: loadSystem, component: () => import('./System.svelte') },
];

export default routes;
