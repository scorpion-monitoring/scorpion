// The pages of bibliometrics: none. The section "Publications" is drawn by the service page of registry.services (`index.ts`
// forwards it), and the settings are edited on the generic settings page of core.ui-shell, with the indicator picker this
// module contributes as a field widget. Apart from `index.ts`, so a test in node reads the texts without the Svelte components.
import type { UiRoute, UiWidgets } from '@scorpion/contracts';

export { messages } from './messages.ts';

/** No dashboard card. */
export const widgets: UiWidgets = {};

const routes: UiRoute[] = [];

export default routes;
