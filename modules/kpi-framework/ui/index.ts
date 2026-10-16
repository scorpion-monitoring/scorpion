// The browser half of the pages of kpi.framework. Only the web app imports this file (ADR-0027); the server half
// (who may open them) is `./routes.ts`, and `ui.test.ts` checks that the two agree.
import type { UiRoute, UiWidgets } from '@scorpion/contracts';
import {
  loadIndicator,
  loadIndicators,
  loadNewIndicator,
  loadNewSet,
  loadSet,
  loadSets,
} from './loaders.ts';

export { messages } from './messages.ts';

/** No dashboard card yet. */
export const widgets: UiWidgets = {};

const routes: UiRoute[] = [
  {
    path: '/kpi/indicators',
    load: loadIndicators,
    component: () => import('./Indicators.svelte'),
  },
  {
    path: '/kpi/indicators/new',
    load: loadNewIndicator,
    component: () => import('./IndicatorEdit.svelte'),
  },
  {
    path: '/kpi/indicators/:id',
    load: loadIndicator,
    component: () => import('./IndicatorEdit.svelte'),
  },
  { path: '/kpi/sets', load: loadSets, component: () => import('./Sets.svelte') },
  { path: '/kpi/sets/new', load: loadNewSet, component: () => import('./SetEdit.svelte') },
  { path: '/kpi/sets/:id', load: loadSet, component: () => import('./SetEdit.svelte') },
];

export default routes;
