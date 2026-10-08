// The browser half of the widgets of core.notifications, by the `component` name of their `ui.widget` entries
// (`./routes.ts`): the bell in the header and a card of the dashboard.
import type { UiWidgets } from '@scorpion/contracts';

export const widgets: UiWidgets = {
  'inbox-bell': () => import('./Bell.svelte'),
  'dead-deliveries': () => import('./DeadDeliveriesCard.svelte'),
};
