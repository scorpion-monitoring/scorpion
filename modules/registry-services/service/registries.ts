// The five registries this module declares (ADR-0035). The loader validates every entry against these
// schemas and names the contributing module when one fails; only this module and its dependants may
// contribute. The seeded entries of the module itself are in `field-types.ts`, `facets.ts` and below.
import { z } from '@scorpion/contracts';
import type { Db } from '@scorpion/kernel';
import type { SQL } from 'drizzle-orm';

export const ORG_ROLE_REGISTRY = 'service.orgRole';
export const FIELD_TYPE_REGISTRY = 'service.fieldType';
export const WIZARD_STEP_REGISTRY = 'service.wizardStep';
export const FACET_REGISTRY = 'service.facet';
export const PROFILE_CONTRIBUTOR_REGISTRY = 'service.profileContributor';

const key = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a lower-case key')
  .max(32);
const labelSchema = z.string().min(1).max(100);
const labels = z.strictObject({ en: labelSchema, de: labelSchema.optional() });
const order = z.number().int().min(0).max(100_000);
/** A message key of the UI catalogue, `services.field.slug.label`. */
export const messageKey = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$/, 'must be a dotted message key')
  .max(120);
const fn = <T>() =>
  z.custom<T>((value) => typeof value === 'function', { message: 'expected a function' });

/** Where a configured field's value is stored (ADR-0035). */
export const STORAGE_KINDS = ['column', 'organisations', 'value', 'icon'] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

/** The properties of a Schema.org `Service` that a configured field may map to (plan §3). */
export const FIELD_SCHEMA_ORG_PROPERTIES = [
  'termsOfService',
  'areaServed',
  'audience',
  'slogan',
] as const;
export type FieldSchemaOrgProperty = (typeof FIELD_SCHEMA_ORG_PROPERTIES)[number];

// ----- service.orgRole ---------------------------------------------------------------------------

/**
 * A role an organisation can play on a service. `orgTypes` are the `org.type` ids an organisation must
 * have to play it; `min` and `max` bound how many organisations hold the role on one service.
 */
export const orgRoleEntrySchema = z
  .strictObject({
    id: key,
    labels,
    orgTypes: z.array(z.string().min(1).max(32)).min(1).max(20),
    min: z.number().int().min(0).max(20),
    max: z.number().int().min(1).max(100),
    order,
  })
  .refine((role) => role.min <= role.max, { message: 'min must not exceed max', path: ['min'] });
export type OrgRoleEntry = z.output<typeof orgRoleEntrySchema>;

/** The roles this module contributes itself. */
export const SEED_ORG_ROLES: OrgRoleEntry[] = [
  {
    id: 'provider',
    labels: { en: 'Provider', de: 'Anbieter' },
    orgTypes: ['provider'],
    min: 1,
    max: 1,
    order: 10,
  },
  {
    id: 'consortium',
    labels: { en: 'Consortium', de: 'Konsortium' },
    orgTypes: ['consortium'],
    min: 0,
    max: 20,
    order: 20,
  },
];

// ----- service.fieldType -------------------------------------------------------------------------

/** What a `check` may ask about other data: only what a value can refer to. */
export interface FieldEnv {
  /** Whether `key` is an active term of the vocabulary. */
  vocabularyHas(vocabulary: string, key: string): Promise<boolean>;
  /** The SPDX licence with this id (any case): its canonical id, or `undefined`. */
  findLicence(id: string): Promise<{ id: string } | undefined>;
}

/** What a `check` answers: a problem text, a replacement for the value (a canonical form), or nothing. */
export type FieldCheckResult = { problem: string } | { value: unknown } | undefined;

/**
 * A kind of field. `schema(config)` validates one value of the field in the browser and on the server
 * (the same Zod schema, `jsonSchema(config)` is what the browser gets); `configSchema` validates the
 * `config` of a field of this type when the server starts; `check` answers the questions that need other
 * data (a licence id, a vocabulary term) with a problem or a canonical value; `storages` lists where a value may live.
 */
export const fieldTypeEntrySchema = z.strictObject({
  id: key,
  labels,
  /** The widget the UI maps the type to (`SchemaForm`). */
  widget: z.string().min(1).max(64),
  storages: z.array(z.enum(STORAGE_KINDS)).min(1),
  configSchema: z.custom<z.ZodType>((value) => value instanceof z.ZodType, {
    message: 'expected a Zod schema',
  }),
  schema: fn<(config: Record<string, unknown>) => z.ZodType>(),
  jsonSchema: fn<(config: Record<string, unknown>) => Record<string, unknown>>(),
  check:
    fn<
      (value: unknown, config: Record<string, unknown>, env: FieldEnv) => Promise<FieldCheckResult>
    >().optional(),
  /** Maps the validated value to what is stored (`svc_field_value.value`); the identity when absent. */
  toValue: fn<(value: unknown, config: Record<string, unknown>) => unknown>().optional(),
  /** Whether a value of this type may map to a Schema.org property (a string or a URL). */
  schemaOrg: z.boolean().optional(),
});
export type FieldTypeEntry = z.output<typeof fieldTypeEntrySchema>;

// ----- service.wizardStep ------------------------------------------------------------------------

/** A field of a configured or contributed step: `config/fields.ts` documents the parts. */
export const fieldConfigSchema = z.strictObject({
  /** The key of the value: a column name for `column` storage, the key in `svc_field_value` for `value`. */
  key: z
    .string()
    .regex(/^[a-z][A-Za-z0-9]*$/, 'must be a camel-case key')
    .max(64),
  /** A JSON pointer into the one nested form object: `/name`, `/contact/type`. */
  path: z
    .string()
    .regex(/^(\/[A-Za-z][A-Za-z0-9]*)+$/, 'must be a JSON pointer such as /name or /contact/type')
    .max(120),
  type: z.string().min(1).max(32),
  label: messageKey,
  help: messageKey.optional(),
  required: z.boolean().optional(),
  /** Used when a create leaves the field out. */
  default: z.unknown().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  storage: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('column'), column: z.string().min(1).max(64) }),
    z.strictObject({ kind: z.literal('organisations'), role: z.string().min(1).max(32) }),
    z.strictObject({ kind: z.literal('value') }),
    z.strictObject({ kind: z.literal('icon') }),
  ]),
  /** The Schema.org property the value maps to; one of {@link FIELD_SCHEMA_ORG_PROPERTIES}. */
  schemaOrg: z.string().min(1).max(32).optional(),
});
export type FieldConfig = z.output<typeof fieldConfigSchema>;

/** A step another module contributes: its fields are defined inline. */
export const wizardStepEntrySchema = z.strictObject({
  id: key,
  order,
  /** The message key of the step's title. */
  title: messageKey,
  /** Message keys of the paragraphs shown above the fields (the legacy `texts`). */
  intro: z.array(messageKey).max(10).default([]),
  fields: z.array(fieldConfigSchema).max(50).default([]),
  /** The name of a UI component for a step that is not a list of fields. */
  component: z.string().min(1).max(64).optional(),
  /** Whether the step is shown for this form state; the browser asks it, the server ignores it. */
  applies: fn<(form: Record<string, unknown>) => boolean>().optional(),
});
export type WizardStepEntry = z.output<typeof wizardStepEntrySchema>;

// ----- service.facet -----------------------------------------------------------------------------

/** One value of a facet with the number of services that have it; `key: null` counts the services with none. */
export interface FacetValue {
  key: string | null;
  count: number;
}

/**
 * A facet of the catalogue (sprint 4). `where(selected)` is the condition on `svc_service` rows (an alias
 * is not needed) for the selected values (OR within the facet); `values(scope, db)` counts the values over
 * the services that match `scope` (the search and the other facets' conditions, already built).
 */
export const facetEntrySchema = z.strictObject({
  id: key,
  labels,
  order,
  /** The label of the services that have no value (`Unknown`, `Uncategorized`). */
  emptyLabel: labels.optional(),
  where: fn<(selected: readonly string[]) => SQL>(),
  values: fn<(scope: SQL | undefined, db: Db) => Promise<FacetValue[]>>(),
});
export type FacetEntry = z.output<typeof facetEntrySchema>;

// ----- service.profileContributor ----------------------------------------------------------------

/** What a contributor may read of a service: the stored record, never the contact point. */
export interface ProfileSubject {
  id: string;
  slug: string;
  name: string;
  /** The values of the configured fields stored in `svc_field_value`, by field key. */
  values: Readonly<Record<string, unknown>>;
}

/** The properties a contributor adds to the Schema.org profile; the builder (sprint 3) enforces the allow-list. */
export const profileContributorEntrySchema = z.strictObject({
  id: key,
  contribute:
    fn<
      (
        service: ProfileSubject,
        ctx: { db: Db },
      ) => Promise<Record<string, unknown>> | Record<string, unknown>
    >(),
});
export type ProfileContributorEntry = z.output<typeof profileContributorEntrySchema>;
