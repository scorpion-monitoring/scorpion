// The browser half of the widgets of kpi.analytics, by the `component` name of their `ui.widget` entries (`./routes.ts`). The shell knows none
// of them by name.
import type { UiWidgets } from '@scorpion/contracts';

export const widgets: UiWidgets = {
  cards: () => import('./Cards.svelte'),
  trends: () => import('./Trends.svelte'),
  averages: () => import('./Averages.svelte'),
  volatility: () => import('./Volatility.svelte'),
  actions: () => import('./Actions.svelte'),
};
