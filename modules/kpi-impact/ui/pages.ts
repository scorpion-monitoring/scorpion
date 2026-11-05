// The page of kpi.impact (the route and the texts), apart from `index.ts` so a test in node can read them without the Svelte component. Only the
// web app imports this file (ADR-0027); the server half (who may open it) is `./routes.ts`.
import type { UiRoute, UiWidgets } from '@scorpion/contracts';
import { loadEvaluate } from './loaders.ts';
import { EVALUATE_PATH } from './routes.ts';

export { messages } from './messages.ts';

/** No dashboard card: the figures are for people who open the page. */
export const widgets: UiWidgets = {};

const routes: UiRoute[] = [
  { path: EVALUATE_PATH, load: loadEvaluate, component: () => import('./Evaluate.svelte') },
];

export default routes;
