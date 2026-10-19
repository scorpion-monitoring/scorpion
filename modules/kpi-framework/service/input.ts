// The bodies and queries of the internal routes, as Zod schemas. Every string and array has a size limit; an
// unknown key is a 422. The service parses with the same schemas (`parseInput`), so a caller that is not a
// route (a job, the migration tool) is held to the same rules. Vocabulary terms are checked later, against
// their vocabularies, never here (CLAUDE.md rule 8).
import { Invalid, paginationQuery, z, type FieldProblem } from '@scorpion/contracts';
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from './text.ts';

export const MAX_NAME = 200;
export const MAX_DESCRIPTION = 4000;
export const MAX_EXAMPLE = 1000;
export const MAX_KEY = 64;
export const MAX_TERMS = 50;
export const MAX_SET_ROWS = 500;
export const MAX_EXTRAS = 200;

/** Text that is trimmed; an empty text is "none" (`null`). */
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2) // a generous cap before trimming, so a huge body is refused cheaply
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const name = z
  .string()
  .max(MAX_NAME * 2)
  .transform((value) => value.trim())
  .pipe(z.string().min(1, 'must not be empty').max(MAX_NAME));

const slug = z
  .string()
  .max(MAX_SLUG_LENGTH)
  .regex(
    SLUG_PATTERN,
    'must be 1 to 64 letters, digits, "." "_" or "-", starting with a letter or digit',
  )
  .optional();

const key = z.string().min(1).max(MAX_KEY);
const optionalKey = key.nullable().optional();

/** Keys listed once, in the order given. */
const keys = z
  .array(key)
  .max(MAX_TERMS)
  .transform((list) => [...new Set(list)])
  .optional();

const bound = z.number().finite().nullable().optional();

const indicatorFields = {
  name,
  description: optionalText(MAX_DESCRIPTION),
  example: optionalText(MAX_EXAMPLE),
  qualitative: z.boolean().optional(),
  valueType: key,
  unit: optionalKey,
  min: bound,
  max: bound,
  thematic: key,
  measuredBy: keys,
  canBeAutomatedBy: keys,
};

/** A new indicator. The slug is made from the name when it is not given, and never changes afterwards. */
export const createIndicatorSchema = z.strictObject({ slug, ...indicatorFields });
/** A change replaces the editable fields: what is left out is cleared. The slug is not here: it never changes. */
export const updateIndicatorSchema = z.strictObject(indicatorFields);
export type CreateIndicatorInput = z.output<typeof createIndicatorSchema>;
export type UpdateIndicatorInput = z.output<typeof updateIndicatorSchema>;

const setFields = {
  name,
  description: optionalText(MAX_DESCRIPTION),
  rimoCategory: optionalKey,
};
export const createSetSchema = z.strictObject({ slug, ...setFields });
export const updateSetSchema = z.strictObject(setFields);
export type CreateSetInput = z.output<typeof createSetSchema>;
export type UpdateSetInput = z.output<typeof updateSetSchema>;

export const setIndicatorsSchema = z.strictObject({
  indicators: z
    .array(
      z.strictObject({
        indicatorId: z.uuid(),
        // No `min(1)`: an empty necessity must reach the vocabulary check, which names the path (defect 14).
        necessity: z.string().max(MAX_KEY),
      }),
    )
    .max(MAX_SET_ROWS),
});
export type SetIndicatorsInput = z.output<typeof setIndicatorsSchema>;

/**
 * What a service's KPIs are set to: its KPI set (`null` for none) and the indicators it opted into beyond the
 * set. The same body is the value of the wizard's field. An indicator listed twice counts once; one that the
 * set contains is dropped by the service, not refused.
 */
export const serviceKpisSchema = z.strictObject({
  setId: z.uuid().nullable(),
  extras: z
    .array(z.uuid())
    .max(MAX_EXTRAS)
    .transform((list) => [...new Set(list)]),
});
export type ServiceKpisInput = z.output<typeof serviceKpisSchema>;

export const evaluationSchema = z.strictObject({
  indicatorId: z.uuid(),
  aggregate: z.string().max(MAX_KEY),
});
export type EvaluationInput = z.output<typeof evaluationSchema>;

const q = z
  .string()
  .max(100)
  .optional()
  .describe('Matches the name, slug or description, without case.');
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const INDICATOR_SORTS = ['name', 'thematic', 'unit', 'valueType'] as const;
export const indicatorListQuery = paginationQuery().extend({
  q,
  thematic: key.optional(),
  unit: key.optional(),
  qualitative: flag
    .optional()
    .describe('`true` for qualitative indicators only, `false` for the others.'),
  sort: z
    .enum(INDICATOR_SORTS)
    .optional()
    .describe('The first sort key; ties are broken by name, then id.'),
});

export const SET_SORTS = ['name', 'rimoCategory'] as const;
export const setListQuery = paginationQuery().extend({
  q,
  rimoCategory: key.optional(),
  sort: z
    .enum(SET_SORTS)
    .optional()
    .describe('The first sort key; ties are broken by name, then id.'),
});

export interface IndicatorFilter {
  q?: string | undefined;
  thematic?: string | undefined;
  unit?: string | undefined;
  qualitative?: boolean | undefined;
  sort?: (typeof INDICATOR_SORTS)[number] | undefined;
}
export interface SetFilter {
  q?: string | undefined;
  rimoCategory?: string | undefined;
  sort?: (typeof SET_SORTS)[number] | undefined;
}

/** Parses `input` with `schema`; a failure is one `Invalid` that names every bad path. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const problems: FieldProblem[] = parsed.error.issues.map((issue) => ({
    in: 'body',
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw new Invalid('The request is not valid.', problems);
}

/** An id that is no UUID is a bad request (422), never a database error (500). */
export function requireId(id: string, what = 'id'): void {
  if (!z.uuid().safeParse(id).success) {
    throw new Invalid('The request is not valid.', [
      { in: 'path', path: what, message: 'The id must be a UUID.' },
    ]);
  }
}
