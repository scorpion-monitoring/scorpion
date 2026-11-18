// The mapping file: what the legacy data does not say, decided by a person (JSON, checked here). `plan` writes a first
// one with every gap marked: a gap is a `null` where a value is needed, and a line in `open` that says what to decide.
// `run` treats a gap as undecided: the record it belongs to is reported and not migrated.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const MAPPING_FORMAT = 'scorpion-legacy-mapping/1';

const key = z.string().max(2000);
const organisation = z.strictObject({
  /** The new abbreviation; `null` is a gap. */
  abbreviation: z.string().max(200).nullable().optional(),
  /** The new name, when the legacy one is refused or taken. */
  name: z.string().max(400).optional(),
  /** Not migrated (reported). */
  drop: z.boolean().optional(),
  /** For a legacy provider: migrate it as a consortium (decision 15; the legacy workaround for consortia). */
  type: z.enum(['provider', 'consortium']).optional(),
});

export const mappingSchema = z.strictObject({
  format: z.literal(MAPPING_FORMAT),
  /** By the legacy provider abbreviation. */
  providers: z.record(key, organisation).default({}),
  /** By the legacy consortium name (what the API gives). */
  consortia: z.record(key, organisation).default({}),
  /** By the legacy service abbreviation. */
  services: z
    .record(
      key,
      z.strictObject({
        /** Overrides the slug derived from the abbreviation (decision 7). */
        slug: z.string().max(200).optional(),
        /** A stage key for this service, before the spellings and `missingStage`. */
        stage: z.string().max(64).optional(),
        drop: z.boolean().optional(),
      }),
    )
    .default({}),
  /** A legacy stage spelling → a key of the vocabulary `stage`; `null` is a gap. */
  stages: z.record(key, z.string().max(64).nullable()).default({}),
  /** The stage of a service with none (decision 14); `null` is a gap. */
  missingStage: z.string().max(64).nullable().default(null),
  /** A legacy licence spelling → an SPDX id; `null` leaves the licence empty (reported). */
  licences: z.record(key, z.string().max(64).nullable()).default({}),
  /**
   * The id of the OIDC provider the migrated users sign in with (decision 3): the id in the instance's setting "Sign-in
   * providers". `null` takes the only provider configured in the target; none or several is a gap that stops the users part.
   */
  oidcProvider: z.string().max(63).nullable().default(null),
  /** By the legacy KPI name. `thematic` is required for a run that writes (§3); a `null` is a gap. */
  indicators: z
    .record(
      key,
      z.strictObject({
        /** A key of the vocabulary `thematic-category`; `null` is a gap that stops a run that writes. */
        thematic: z.string().max(64).nullable().optional(),
        /** A value type id; the default is `integer`, since every legacy value is one. */
        valueType: z.string().max(64).optional(),
        /** A key of the vocabulary `kpi.unit`; `null` or none leaves the unit empty. */
        unit: z.string().max(64).nullable().optional(),
        /** The slug, when the one derived from the name is not wanted. */
        slug: z.string().max(200).optional(),
        /** Not migrated; its measurements are dropped (reported). */
        drop: z.boolean().optional(),
      }),
    )
    .default({}),
  /** By the legacy category name: the KPI set it becomes. */
  kpiSets: z
    .record(
      key,
      z.strictObject({
        slug: z.string().max(200).optional(),
        /** A key of the vocabulary `kpi.service-category`. */
        rimoCategory: z.string().max(64).nullable().optional(),
        drop: z.boolean().optional(),
      }),
    )
    .default({}),
  /** A legacy necessity spelling → a key of the vocabulary `necessity`; `null` is a gap. */
  necessities: z.record(key, z.string().max(64).nullable()).default({}),
  /** The necessity of a KPI that a category lists without defining one (decision 6); reported. */
  missingNecessity: z.string().max(64).default('mandatory'),
  /**
   * Decision 13: the legacy API leaves out every value of 0, so a month missing between a KPI's first and last point of a
   * service is written as 0 (reported per service and KPI). `false` leaves those months empty.
   */
  fillMissingMonths: z.boolean().default(true),
  /** By the legacy username: what the rules refuse (a username, an address that is shared or not one) or a user not migrated. */
  users: z
    .record(
      key,
      z.strictObject({
        username: z.string().max(200).optional(),
        email: z.string().max(400).optional(),
        drop: z.boolean().optional(),
      }),
    )
    .default({}),
  /** What `plan` found to decide, for the person; `run` reports how many lines are left. */
  open: z.array(z.string().max(2000)).max(10_000).default([]),
});
export type Mapping = z.infer<typeof mappingSchema>;

export const emptyMapping = (): Mapping => mappingSchema.parse({ format: MAPPING_FORMAT });

export class MappingError extends Error {}

export async function readMapping(path: string): Promise<Mapping> {
  const text = await readFile(path, 'utf8').catch(() => {
    throw new MappingError(`The mapping ${path} cannot be read.`);
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MappingError(`The mapping ${path} is not JSON.`);
  }
  const result = mappingSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new MappingError(
      `The mapping ${path} is not valid (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid'}).`,
    );
  }
  return result.data;
}
