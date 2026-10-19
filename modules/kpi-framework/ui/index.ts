// The browser half of kpi.framework. Only the web app imports this file (ADR-0027); the server half (who may open
// the pages) is `./routes.ts`, and `ui.test.ts` checks that the two agree. Three exports: the pages and their texts
// (`pages.ts`), and what the module adds to the services wizard and the service page.
import type { WizardExtensions } from '@scorpion/ui-kit';
import KpiSetWidget from './KpiSetWidget.svelte';
import ServiceKpis from './ServiceKpis.svelte';

export { default, messages, widgets } from './pages.ts';

/**
 * What the module adds to the services wizard and the service page (ADR-0040 addendum): the widget of its field
 * type, the section of the page. The shell forwards it; the step needs no `applies` (it is always offered).
 */
export const wizardExtensions: WizardExtensions = {
  widgets: { 'kpi-set': KpiSetWidget },
  applies: {},
  sections: { kpis: ServiceKpis },
};
