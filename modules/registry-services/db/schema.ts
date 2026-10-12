// The tables of registry.services. Names start with `svc_` (the manifest's `tablePrefix`, ADR-0035).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/registry-services`.
//
// No pg enum: `stage` is a term of the `stage` vocabulary, `role` a key of the registry `service.orgRole`,
// `field_key` a configured string; the service checks each. No foreign key to `org_organisation`, to a
// user or to the blob table: those ids are plain columns that the service checks, so a purge or the blob
// cleanup cannot be blocked by this module. Foreign keys point only to this module's own tables.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** One service. Its stage is a vocabulary term, its organisations are rows of `svc_service_organisation`. */
export const service = pgTable(
  'svc_service',
  {
    id: uuid().primaryKey(), // UUIDv7
    /** Unique without case; see `svc_slug_history` for the rule across old slugs. */
    slug: text().notNull(),
    name: text().notNull(),
    /** An SPDX licence id (`MIT`, `Apache-2.0`); checked against the SPDX list in the service. */
    license: text(),
    /** A term of the `stage` vocabulary, checked in the service. */
    stage: text().notNull(),
    /** Plain text, never HTML. */
    description: text(),
    url: text(),
    sameAs: text('same_as')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The service's role address, not a user's. Set together with `contactType`, or not at all. */
    contactEmail: text('contact_email'),
    contactType: text('contact_type'),
    /** Filled by the icon routes (sprint 2). No foreign key. */
    iconBlobId: uuid('icon_blob_id'),
    iconHash: text('icon_hash'),
    /** Whether anonymous readers may see the service. Only Reviewers and Admin set it (sprint 2). */
    public: boolean().notNull().default(false),
    publishedAt: timestamptz('published_at'),
    /** User id, kept as written. */
    publishedBy: uuid('published_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** User ids, kept as written. */
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    uniqueIndex('svc_service_slug_idx').on(sql`lower(${table.slug})`),
    // The list sorts by name, slug or stage, then id, and searches slug and name without case.
    index('svc_service_name_idx').on(sql`lower(${table.name})`, table.id),
    index('svc_service_stage_idx').on(table.stage),
    index('svc_service_license_idx').on(table.license),
    check(
      'svc_service_slug_check',
      sql`char_length(${table.slug}) between 1 and 64 and ${table.slug} ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'`,
    ),
    check('svc_service_name_check', sql`char_length(${table.name}) between 1 and 200`),
    check(
      'svc_service_description_check',
      sql`${table.description} is null or char_length(${table.description}) <= 4000`,
    ),
    check(
      'svc_service_url_check',
      sql`${table.url} is null or (char_length(${table.url}) <= 500 and ${table.url} ~* '^https?://')`,
    ),
    check('svc_service_same_as_check', sql`cardinality(${table.sameAs}) <= 20`),
    check(
      'svc_service_contact_check',
      sql`(${table.contactEmail} is null) = (${table.contactType} is null)
        and (${table.contactEmail} is null or char_length(${table.contactEmail}) <= 254)
        and (${table.contactType} is null or char_length(${table.contactType}) between 1 and 64)`,
    ),
    check(
      'svc_service_icon_check',
      sql`(${table.iconBlobId} is null) = (${table.iconHash} is null)`,
    ),
    // `published_*` are set together with `public` (a service that is not public has neither).
    check(
      'svc_service_published_check',
      sql`${table.public} = (${table.publishedAt} is not null)
        and (${table.publishedAt} is null) = (${table.publishedBy} is null)`,
    ),
  ],
);

/** An organisation's role on a service. The organisation id is a plain column; the role is a key of `service.orgRole`. */
export const serviceOrganisation = pgTable(
  'svc_service_organisation',
  {
    id: uuid().primaryKey(), // UUIDv7
    serviceId: uuid('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id').notNull(),
    role: text().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('svc_service_organisation_key').on(
      table.serviceId,
      table.organisationId,
      table.role,
    ),
    // "The services of an organisation" (the usage count, `listByOrganisationAsSystem`).
    index('svc_service_organisation_organisation_idx').on(table.organisationId, table.role),
    check('svc_service_organisation_role_check', sql`char_length(${table.role}) between 1 and 32`),
  ],
);

/** The value of a configured field that is not a column of `svc_service` (ADR-0035). */
export const fieldValue = pgTable(
  'svc_field_value',
  {
    id: uuid().primaryKey(), // UUIDv7
    serviceId: uuid('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    value: jsonb().notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('svc_field_value_key').on(table.serviceId, table.fieldKey),
    check('svc_field_value_key_check', sql`char_length(${table.fieldKey}) between 1 and 64`),
  ],
);

/**
 * Every slug a service has had, the current one included, unique without case: one index decides
 * whether a slug is free, so an old slug is never given to another service and two writers racing for
 * one slug cannot both win (ADR-0035).
 */
export const slugHistory = pgTable(
  'svc_slug_history',
  {
    id: uuid().primaryKey(), // UUIDv7
    slug: text().notNull(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('svc_slug_history_slug_idx').on(sql`lower(${table.slug})`),
    index('svc_slug_history_service_idx').on(table.serviceId),
  ],
);

/** The SPDX list as last fetched: one row (`id = 'spdx'`). The adapter's cache port reads and writes it. */
export const licenseCache = pgTable('svc_license_cache', {
  id: text().primaryKey(),
  /** The licence list as the adapter returns it. */
  licenses: jsonb().notNull(),
  releaseVersion: text('release_version'),
  fetchedAt: timestamptz('fetched_at').notNull(),
});
