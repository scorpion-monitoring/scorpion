// The browser half of matomo. Only the web app imports this file (ADR-0027). The module has no page of its own: its
// settings are edited in the settings form of core.settings, and its one widget is the tracker.
import type { UiMessages, UiRoute } from '@scorpion/contracts';

export { widgets } from './widgets.ts';

export const messages: UiMessages = { en: {}, de: {} };

const routes: UiRoute[] = [];

export default routes;
