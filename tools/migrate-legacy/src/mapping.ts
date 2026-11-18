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
