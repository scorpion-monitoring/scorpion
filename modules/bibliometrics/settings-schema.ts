// The settings of bibliometrics (ADR-0056). Nothing secret lives here: the optional OpenAlex key is the secret
// `bibliometrics.openalex-api-key` of the secrets store, never a setting. There is no `openalex.mailto`: OpenAlex no longer
// documents it and ignores it (sprint 2, plan §1), so the instance sends no address.
import { z } from '@scorpion/contracts';

const indicator = (title: string, description: string, order: number) =>
  z.uuid().optional().meta({
    title,
    description,
    order,
    // The picker of `ui/IndicatorPicker.svelte`; the server checks the choice too (`settings.check`, ADR-0057).
    widget: 'bibliometrics-indicator',
  });

const kpi = z.strictObject({
  citationsIndicatorId: indicator(
    'Citations KPI',
    'A numeric indicator in the category Bibliographic that every citation refresh fills with the new citations of the month: the citation total of the service minus what the indicator holds for earlier months (the whole total the first time), so the months add up to the total. Empty: not written.',
    1,
  ),
  publicationsIndicatorId: indicator(
    'Publications KPI',
    'A numeric indicator in the category Bibliographic that every citation refresh fills with the number of publications issued in each month, from the first publication to now. A service with a publication whose month is not known is skipped until a member of its provider gives it. Empty: not written.',
    2,
  ),
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
