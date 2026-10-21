// The browser half of kpi.analytics, apart from `index.ts` so a test in node can read it without the Svelte components. Only the web app imports
// this (ADR-0027). The module has no page of its own: its widgets sit on the dashboard of core.ui-shell.
import type { UiRoute } from '@scorpion/contracts';

export { messages } from './messages.ts';
export { widgets } from './widgets.ts';

const routes: UiRoute[] = [];

export default routes;
