// The five registries this module declares (ADR-0035). The loader validates every entry against these
// schemas and names the contributing module when one fails; only this module and its dependants may
// contribute. The seeded entries of the module itself are in `field-types.ts`, `facets.ts` and below.
import { z } from '@scorpion/contracts';
import type { Db, DbTx } from '@scorpion/kernel';
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

/**
 * Where a configured field's value is stored (ADR-0035). `module` is the field type's own: the type's `store`
 * writes the value in the create transaction, into the tables of the module that contributed it (ADR-0040
 * addendum); nothing goes to `svc_field_value`.
 */
export const STORAGE_KINDS = ['column', 'organisations', 'value', 'icon', 'module'] as const;
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

/** What `choices` may ask about other data: the active terms of a vocabulary, labelled for the caller's locale. */
export interface ChoiceEnv {
  terms(vocabulary: string): Promise<{ key: string; label: string }[]>;
}

/**
 * One option of a choice field. Give `label` (text that is ready to show, a vocabulary term in the caller's
 * language) or `labelKey` (a message key of the UI catalogue, from a fixed list in the config).
 */
export interface Choice {
  value: string;
  label?: string;
  labelKey?: string;
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
  /**
   * The options a choice field offers, for the widget (the schema route sends them with the field). Absent
   * for a type that is not a choice.
   */
  choices: fn<(config: Record<string, unknown>, env: ChoiceEnv) => Promise<Choice[]>>().optional(),
  /**
   * For the storage `module`: writes the validated value inside the transaction that creates the service, so
   * the service and what the value names commit or roll back together. It gets the transaction and the new
   * service's id; a failure undoes the whole create. Not called for a value the body leaves out.
   */
  store: fn<
    (
      tx: DbTx,
      change: {
        serviceId: string;
        value: unknown;
        config: Record<string, unknown>;
        actorId: string | null;
      },
    ) => Promise<void>
  >().optional(),
  /** Maps the validated value to what is stored (`svc_field_value.value`); the identity when absent. */
  toValue: fn<(value: unknown, config: Record<string, unknown>) => unknown>().optional(),
  /** Whether a value of this type may map to a Schema.org property (a string or a URL). */
  schemaOrg: z.boolean().optional(),
});
export type FieldTypeEntry = z.output<typeof fieldTypeEntrySchema>;

// ----- service.wizardStep ------------------------------------------------------------------------

/**
 * A condition that travels (ADR-0040 addendum): the field or step is shown when the value at the JSON pointer
 * `path` of the form equals `equals` or is one of `oneOf` (a deep comparison). A field that is hidden by it
 * is not required and its value is dropped; the browser asks the same question of the same data.
 */
export const showIfSchema = z
  .strictObject({
    path: z
      .string()
      .regex(/^(\/[A-Za-z][A-Za-z0-9]*)+$/, 'must be a JSON pointer such as /name or /contact/type')
      .max(120),
    equals: z.unknown().optional(),
    oneOf: z.array(z.unknown()).min(1).max(50).optional(),
  })
  .refine((condition) => (condition.equals !== undefined) !== (condition.oneOf !== undefined), {
    message: 'give exactly one of "equals" and "oneOf"',
  });
export type ShowIf = z.output<typeof showIfSchema>;

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
    z.strictObject({ kind: z.literal('module') }),
  ]),
  /** Shown only when the condition holds; a hidden field is not required. */
  showIf: showIfSchema.optional(),
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
  /** The same question as data: the server asks it too, so a hidden step may have required fields. */
  showIf: showIfSchema.optional(),
});
export type WizardStepEntry = z.output<typeof wizardStepEntrySchema>;

// ----- service.facet -----------------------------------------------------------------------------

/**
 * The value that stands for "the services that have none" in an address and in an answer (`?license=:none`).
 * It cannot be an id: a colon is in no organisation id, SPDX id or vocabulary key.
 */
export const FACET_EMPTY = ':none';

/** What was chosen in one facet: values (OR) and, with `empty`, the services that have none. */
export interface FacetSelection {
  keys: readonly string[];
  empty: boolean;
}

/** One value of a facet with the number of services that have it; `key: null` counts the services with none. */
export interface FacetValue {
  key: string | null;
  count: number;
}

/** What an entry may ask to name its values: the names of organisations and the terms of a vocabulary. */
export interface FacetEnv {
  /** The locale of the labels asked for. */
  locale: string;
  /** The names of the organisations with these ids (an unknown id is absent). */
  organisationNames(ids: readonly string[]): Promise<Map<string, string>>;
  /** The labels of the terms of a vocabulary, active or not, by key. */
  termLabels(vocabulary: string): Promise<Map<string, string>>;
  /** The SPDX licence with this id (any case): its canonical id, or `undefined`. */
  findLicence(id: string): Promise<{ id: string } | undefined>;
}

/**
 * A facet of the catalogue (ADR-0035). An entry never names a table of this module: the catalogue hands it
 * the column to correlate with and the set of services to count over.
 *
 * - `where(selection, serviceId)`: the condition on a service, `serviceId` being its id column, for the
 *   values chosen (OR within the facet; `empty` adds the services that have none).
 * - `values(matching, db)`: the values of the facet over the services whose id is in `matching` (a
 *   subquery of ids: the search and every *other* facet's condition, already built), with the number of
 *   services that have each, once per service; `key: null` counts the services that have none. A value
 *   no service has in this set is left out: the catalogue adds a selected one with count 0.
 * - `unknownOf(keys, env)`: the keys that name nothing (an organisation that does not exist, a term nobody
 *   declared, a licence SPDX does not list); the catalogue answers 422 for them instead of an empty list
 *   that hides a typo. An entry without it accepts any key.
 * - `labelsOf(keys, env)`: a label for each key it can name (an organisation's name, a term's label); a
 *   key without one is shown as it is.
 *
 * A value kept in `svc_field_value` needs no SQL from the contributor: `fieldValueFacet()` in `public.ts`.
 */
export const facetEntrySchema = z.strictObject({
  id: key,
  labels,
  order,
  /** The label of the services that have no value (`Unknown`, `Uncategorized`). */
  emptyLabel: labels.optional(),
  where: fn<(selection: FacetSelection, serviceId: SQL) => SQL>(),
  values: fn<(matching: SQL, db: Db) => Promise<FacetValue[]>>(),
  unknownOf: fn<(keys: readonly string[], env: FacetEnv, db: Db) => Promise<string[]>>().optional(),
  labelsOf:
    fn<(keys: readonly string[], env: FacetEnv) => Promise<Map<string, string>>>().optional(),
  /**
   * Adds one field to the rows of the public API and a filter of the same name (ADR-0037, additive): the
   * facet's value in words. `valuesOf` gives each service its value (`null` for none), `keysOf` turns the
   * names a client filters by into the facet's keys (a name that names nothing is absent from the map).
   */
  v1: z
    .strictObject({
      field: z.enum(['category']),
      valuesOf:
        fn<(serviceIds: readonly string[], db: Db) => Promise<Map<string, string | null>>>(),
      keysOf: fn<(names: readonly string[], db: Db) => Promise<Map<string, string>>>(),
    })
    .optional(),
});
export type FacetEntry = z.output<typeof facetEntrySchema>;

/**
 * The sorts of the catalogue: the stored columns and the owning organisation's name (`owner`; the API
 * calls it `provider`, as the role is named in the registry `service.orgRole`).
 */
export const CATALOGUE_SORT_KEYS = ['name', 'slug', 'stage', 'provider'] as const;
export type CatalogueSort = (typeof CATALOGUE_SORT_KEYS)[number];
/** The sort by the owning organisation's name. */
export const SORT_BY_OWNER: CatalogueSort = 'provider';

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
