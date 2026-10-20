// The browser half of kpi.ingestion. Only the web app imports this file (ADR-0027); the server half (who may open the page) is `./routes.ts`,
// and `ui.test.ts` checks that the two agree.
export { default, messages, widgets } from './pages.ts';
