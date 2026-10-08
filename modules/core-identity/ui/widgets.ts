// The browser half of the widgets of core.identity, by the `component` name of their `ui.widget` entries
// (`./routes.ts`): a card of the dashboard.
import type { UiWidgets } from '@scorpion/contracts';

export const widgets: UiWidgets = {
  'pending-approvals': () => import('./PendingApprovalsCard.svelte'),
};
