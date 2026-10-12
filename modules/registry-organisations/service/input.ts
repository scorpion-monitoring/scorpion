// The input of a write: one set of Zod schemas for the routes and for the service (and later the
// migration tool), so both normalise and validate the same way. A request that fails is 422.
import { Invalid, z, type FieldProblem } from '@scorpion/contracts';
import {
  abbreviationSchema,
  contactEmailSchema,
  contactTypeSchema,
  descriptionSchema,
  nameSchema,
  rorIdSchema,
  sameAsSchema,
  websiteSchema,
} from './fields.ts';

const typeSchema = z.string().min(1).max(64);

/** Contact email and type go together: both set, both cleared, or neither mentioned. */
const contactTogether = (value: { contactEmail?: unknown; contactType?: unknown }) =>
  (value.contactEmail === undefined) === (value.contactType === undefined) &&
  (value.contactEmail === null) === (value.contactType === null);
const CONTACT_MESSAGE = 'A contact point needs both contactEmail and contactType, or neither.';

export const createOrganisationSchema = z
  .strictObject({
    type: typeSchema,
    abbreviation: abbreviationSchema,
    name: nameSchema,
    description: descriptionSchema.nullish(),
    website: websiteSchema.nullish(),
    rorId: rorIdSchema.nullish(),
    sameAs: sameAsSchema.optional(),
    contactEmail: contactEmailSchema.nullish(),
    contactType: contactTypeSchema.nullish(),
  })
  .refine((value) => (value.contactEmail == null) === (value.contactType == null), {
    message: CONTACT_MESSAGE,
    path: ['contactEmail'],
  });
export type CreateOrganisationInput = z.input<typeof createOrganisationSchema>;
export type CreateOrganisation = z.output<typeof createOrganisationSchema>;

/** A partial body. `null` clears an optional field; at least one field is required. */
export const updateOrganisationSchema = z
  .strictObject({
    type: typeSchema.optional(),
    abbreviation: abbreviationSchema.optional(),
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    website: websiteSchema.nullable().optional(),
    rorId: rorIdSchema.nullable().optional(),
    sameAs: sameAsSchema.optional(),
    contactEmail: contactEmailSchema.nullable().optional(),
    contactType: contactTypeSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field is required.',
  })
  .refine(contactTogether, { message: CONTACT_MESSAGE, path: ['contactEmail'] });
export type UpdateOrganisationInput = z.input<typeof updateOrganisationSchema>;
export type UpdateOrganisation = z.output<typeof updateOrganisationSchema>;

/** Parses `input` with `schema`; a failure is `Invalid` (422) with one entry per field. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const errors: FieldProblem[] = result.error.issues.map((issue) => ({
    in: 'body',
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  throw new Invalid('The request is not valid.', errors);
}

/** An id that is no UUID is a bad request (422), never a database error (500). */
export function requireId(
  id: string,
  location: 'path' | 'query' | 'body' = 'path',
  name = 'id',
): void {
  if (!z.uuid().safeParse(id).success) {
    throw new Invalid('The request is not valid.', [
      { in: location, path: name, message: `The ${name} must be a UUID.` },
    ]);
  }
}
