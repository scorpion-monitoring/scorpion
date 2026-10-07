// The browser half of the shell's own pages. Only the web app imports this file (ADR-0027); the server
// half (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two agree.
import type { UiRoute } from '@scorpion/contracts';
import { loadDocs } from './docs.ts';
import { loadLegal } from './legal.ts';

export { messages } from './messages.ts';

const routes: UiRoute[] = [
  { path: '/', component: () => import('./Home.svelte') },
  { path: '/legal/:page', load: loadLegal, component: () => import('./Legal.svelte') },
  { path: '/docs', load: loadDocs, component: () => import('./Docs.svelte') },
];

export default routes;
