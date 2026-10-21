// The browser half of kpi.analytics. Only the web app imports this file (ADR-0027); the server half (who may see the widgets) is `./routes.ts`,
// and `ui.test.ts` checks that the two agree.
export { default, messages, widgets } from './pages.ts';
