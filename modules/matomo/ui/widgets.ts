// The browser half of the widget of matomo, by the `component` name of its `ui.widget` entry (`./routes.ts`).
import type { UiWidgets } from '@scorpion/contracts';

export const widgets: UiWidgets = {
  'matomo-tracker': () => import('./Tracker.svelte'),
};
