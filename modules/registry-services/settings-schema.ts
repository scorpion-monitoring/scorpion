// The settings of registry.services. Nothing secret lives here.
import { z } from '@scorpion/contracts';

/**
 * The looks of the catalogues' faceted search (the kit's `FacetSearch`), all three permanent (sprint 3 of M12a).
 * `combined` is offered, and the default, because its screen-reader gate passes (`.github/workflows/screen-reader.yml`).
 */
export const CATALOGUE_FILTERS = ['sidebar', 'bar', 'combined'] as const;
export type CatalogueFilters = (typeof CATALOGUE_FILTERS)[number];
/** What an instance gets that has not chosen. */
export const DEFAULT_CATALOGUE_FILTERS: CatalogueFilters = 'combined';

export const settingsSchema = z.strictObject({
  /**
   * Whether every signed-in person sees the contact point of a service. Off: only administrators (and, from
   * sprint 2, the provider's members) do. Never public, never in a list, never in the Schema.org profile.
   */
  exposeContactPoint: z.boolean().default(true).meta({
    title: 'Show service contact points',
    description:
      'A service may enter a shared contact address (not a person’s). On: every signed-in person sees it on the service page. Off: only administrators and the members of the provider do. It is never public and never part of the Schema.org profile.',
  }),
  /** Whether the instance may serve public services at all (sprints 2 and 3). */
  allowPublic: z.boolean().default(true).meta({
    title: 'Allow public services',
    description:
      'On: Reviewers and administrators may make a service public, and anybody may then read its name, description, links, provider and consortia. Off: every public address answers “not found” and publishing is refused. Services already marked public stay marked, and are served again when this is switched back on.',
  }),
  /** The look of the faceted search of both catalogues (`/services` and `/catalog/services`). */
  catalogueFilters: z.enum(CATALOGUE_FILTERS).default(DEFAULT_CATALOGUE_FILTERS).meta({
    title: 'Look of the catalogue filters',
    description:
      'How the search and the filters of the service catalogues look. “combined”: one box for the name and the filters; the chosen filters are chips inside it, and clicking into it lists the filters. “bar”: a search box with a row of filter buttons that open a list, and the chosen filters as chips. “sidebar”: the filters as lists of checkboxes beside the table. All three search as one types and behave the same; the choice applies to the signed-in and the public catalogue. Instances that existed before this setting keep “sidebar”.',
  }),
});

export type ServicesSettings = z.output<typeof settingsSchema>;
