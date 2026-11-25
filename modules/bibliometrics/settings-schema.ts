// The settings of bibliometrics (ADR-0056). Nothing secret lives here: the OpenAlex key (sprint 2) is the secret
// `bibliometrics.openalex-api-key` of the secrets store, never a setting.
import { z } from '@scorpion/contracts';

/** The longest `openalex.mailto` accepted (the longest mail address RFC 5321 allows). */
export const MAX_MAILTO_LENGTH = 254;

const openalex = z.strictObject({
  mailto: z.email().max(MAX_MAILTO_LENGTH).optional().meta({
    title: 'Contact address for OpenAlex',
    description:
      'An address of the operator that the citation refresh sends to OpenAlex with its requests (sprint 2). Optional; it is never taken from the contact settings of the instance.',
  }),
});

const kpi = z.strictObject({
  indicatorId: z.uuid().optional().meta({
    title: 'Bibliographic KPI',
    description:
      'The numeric indicator, in the category Bibliographic, that the weekly citation refresh fills with the citation total of a service (sprint 3). Empty: no KPI is written.',
  }),
});

export const settingsSchema = z.strictObject({
  enabled: z.boolean().default(true).meta({
    title: 'Look up publications',
    description:
      'On: the title, authors and date of a DOI are looked up at doi.org when a publication is added, and citation counts are fetched from OpenAlex. Both are free and need no account. Off: the instance makes no request to them.',
    order: 1,
  }),
  openalex: openalex.default(() => openalex.parse({})).meta({ title: 'OpenAlex', order: 2 }),
  kpi: kpi.default(() => kpi.parse({})).meta({ title: 'KPI', order: 3 }),
});

export type BibliometricsSettings = z.output<typeof settingsSchema>;
