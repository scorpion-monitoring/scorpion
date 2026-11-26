// The settings of bibliometrics (ADR-0056). Nothing secret lives here: the optional OpenAlex key is the secret
// `bibliometrics.openalex-api-key` of the secrets store, never a setting. There is no `openalex.mailto`: OpenAlex no longer
// documents it and ignores it (sprint 2, plan §1), so the instance sends no address.
import { z } from '@scorpion/contracts';

const kpi = z.strictObject({
  indicatorId: z.uuid().optional().meta({
    title: 'Bibliographic KPI',
    description:
      'The numeric indicator, in the category Bibliographic, that every citation refresh fills with the citation total of a service as the value of the current month, for the services whose KPIs include it. Empty: no KPI is written.',
    // The picker of `ui/IndicatorPicker.svelte`; the server checks the choice too (`settings.check`, ADR-0057).
    widget: 'bibliometrics-indicator',
  }),
});

export const settingsSchema = z.strictObject({
  enabled: z.boolean().default(true).meta({
    title: 'Look up publications',
    description:
      'On: the title, authors and date of a DOI are looked up at doi.org when a publication is added, and citation counts are fetched from OpenAlex. Both are free and need no account. Off: the instance makes no request to them.',
    order: 1,
  }),
  kpi: kpi.default(() => kpi.parse({})).meta({ title: 'KPI', order: 2 }),
});

export type BibliometricsSettings = z.output<typeof settingsSchema>;
