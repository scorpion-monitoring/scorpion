// The settings of kpi.framework. Nothing secret lives here.
import { z } from '@scorpion/contracts';
import { iriBaseProblem } from './service/iri.ts';

export const settingsSchema = z.strictObject({
  /**
   * The base of every IRI this module mints (`<base>/kpi/<kind>/<slug>`, ADR-0040). Empty: the origin and base
   * path of the request, which is right for one deployment and wrong for an IRI that has to survive a move.
   */
  iriBase: z
    .string()
    .trim()
    .max(200)
    .refine((value) => iriBaseProblem(value) === undefined, {
      message:
        'must be empty or an absolute http(s) URL in printable ASCII, without a query, a fragment or credentials',
    })
    .default('')
    .meta({
      title: 'Base of the indicator IRIs',
      description:
        'The URL that the identifiers of indicators, KPI sets, units, means of measurement and tools are built on, for example https://kpi.example.org. Leave it empty to use the address this server is reached at. Set it before you share the identifiers: changing it later changes every identifier.',
    }),
});

export type KpiFrameworkSettings = z.output<typeof settingsSchema>;
