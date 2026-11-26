// The browser half of bibliometrics. Only the web app imports this file (ADR-0027). It has no page of its own (`pages.ts`); what it
// adds is the section "Publications" of the service page and the indicator picker of its settings, both forwarded by the shell.
import type { WizardExtensions } from '@scorpion/ui-kit';
import IndicatorPicker from './IndicatorPicker.svelte';
import ServicePublications from './ServicePublications.svelte';

export { default, messages, widgets } from './pages.ts';

/** The widget name the setting `kpi.indicatorId` asks for (`settings-schema.ts`). */
export const INDICATOR_WIDGET = 'bibliometrics-indicator';

/**
 * What the module adds to the service page and the settings form (ADR-0040 addendum, ADR-0057): the section `publications`,
 * drawn after the KPIs (profile order), and the field widget of the indicator picker.
 */
export const wizardExtensions: WizardExtensions = {
  widgets: { [INDICATOR_WIDGET]: IndicatorPicker },
  sections: { publications: ServicePublications },
};
