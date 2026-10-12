// The two registries this module declares (ADR-0033). The loader validates every entry against these
// schemas and lets only this module and its dependants contribute.
import { z } from '@scorpion/contracts';
import type { DbTx } from '@scorpion/kernel';

export const ORG_TYPE_REGISTRY = 'org.type';
export const ORG_USAGE_REGISTRY = 'org.usage';

/** The schema.org subtypes of `Organization` a type may name (ADR-0033); anything else is refused at start. */
export const SCHEMA_TYPES = [
  'Organization',
  'ResearchOrganization',
  'FundingAgency',
  'NGO',
  'GovernmentOrganization',
  'EducationalOrganization',
] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

const labelSchema = z.string().min(1).max(100);

/**
 * One organisation type. A code registry, not a vocabulary: a type carries behaviour. `id` is the
 * stored value of `org_organisation.type`; `membership` says whether people may become members of an
 * organisation of this type; `schemaType` names the schema.org class of its profile.
 */
export const orgTypeEntrySchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a lower-case key')
    .max(32),
  labels: z.strictObject({ en: labelSchema, de: labelSchema.optional() }),
  membership: z.boolean(),
  schemaType: z.enum(SCHEMA_TYPES).default('Organization'),
  order: z.number().int().min(0).max(100_000),
});
export type OrgTypeEntry = z.output<typeof orgTypeEntrySchema>;

/** Counts the references to an organisation that a delete or a change of type would break. */
export type OrgUsageCount = (tx: DbTx, organisationId: string) => Promise<number>;

export const orgUsageEntrySchema = z.strictObject({
  /** The contributing module's id; it is what the 409 problem names. */
  id: z.string().min(1).max(100),
  count: z.custom<OrgUsageCount>((value) => typeof value === 'function', 'expected a function'),
});
export type OrgUsageEntry = z.output<typeof orgUsageEntrySchema>;

/** The types this module contributes itself. A second module adds `funder` and the like. */
export const SEED_TYPES: OrgTypeEntry[] = [
  {
    id: 'provider',
    labels: { en: 'Provider', de: 'Anbieter' },
    membership: true,
    schemaType: 'Organization',
    order: 10,
  },
  {
    id: 'consortium',
    labels: { en: 'Consortium', de: 'Konsortium' },
    membership: true,
    schemaType: 'Organization',
    order: 20,
  },
];
