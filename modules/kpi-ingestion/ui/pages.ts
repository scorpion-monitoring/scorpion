// The page of kpi.ingestion (the routes and the texts), apart from `index.ts` so a test in node can read them without the Svelte components.
// Only the web app imports this file (ADR-0027); the server half (who may open it) is `./routes.ts`.
import type { UiRoute, UiWidgets } from '@scorpion/contracts';
import { loadSubmit } from './loaders.ts';
import { SUBMIT_PATH } from './routes.ts';

export { messages } from './messages.ts';

/** No dashboard card yet (the reminder of sprint 5 is a mail). */
export const widgets: UiWidgets = {};

const routes: UiRoute[] = [
  { path: SUBMIT_PATH, load: loadSubmit, component: () => import('./Submit.svelte') },
];

export default routes;
