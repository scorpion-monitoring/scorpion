// The tables of registry.organisations. Names start with `org_` (the manifest's `tablePrefix`, ADR 0004).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/registry-organisations`.
//
// No pg enum and no list of types here: `type` is plain text that the service checks against the
// registry `org.type`, so a new type needs no migration. No foreign key to a user or to the blob
// table: ids are kept as written, so a purge or the blob cleanup cannot be blocked.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** One organisation (provider, consortium, ...). Its type is an entry of the registry `org.type`. */
export const organisation = pgTable(
  'org_organisation',
  {
    id: uuid().primaryKey(), // UUIDv7
    type: text().notNull(),
    abbreviation: text().notNull(),
    name: text().notNull(),
    /** Plain text, never HTML. */
    description: text(),
    website: text(),
    /** The bare ROR id (`02skbsp27`), not the URL. */
    rorId: text('ror_id'),
    sameAs: text('same_as')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The organisation's role address, not a user's. Set together with `contactType`, or not at all. */
    contactEmail: text('contact_email'),
    contactType: text('contact_type'),
    /** Filled by the logo routes of sprint 2. No foreign key. */
    logoBlobId: uuid('logo_blob_id'),
    logoHash: text('logo_hash'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** User ids, kept as written. */
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    uniqueIndex('org_organisation_type_abbreviation_idx').on(
      table.type,
      sql`lower(${table.abbreviation})`,
    ),
    uniqueIndex('org_organisation_type_name_idx').on(table.type, sql`lower(${table.name})`),
    uniqueIndex('org_organisation_ror_id_idx')
      .on(table.rorId)
      .where(sql`${table.rorId} is not null`),
    // The list sorts by abbreviation, then id, and searches abbreviation and name without case.
    index('org_organisation_sort_idx').on(sql`lower(${table.abbreviation})`, table.id),
    index('org_organisation_name_idx').on(sql`lower(${table.name})`),
    check(
      'org_organisation_abbreviation_check',
      sql`char_length(${table.abbreviation}) between 1 and 64 and ${table.abbreviation} !~ '[[:space:]/]'`,
    ),
    check('org_organisation_name_check', sql`char_length(${table.name}) between 1 and 200`),
    check(
      'org_organisation_description_check',
      sql`${table.description} is null or char_length(${table.description}) <= 4000`,
    ),
    check(
      'org_organisation_website_check',
      sql`${table.website} is null or (char_length(${table.website}) <= 500 and ${table.website} ~* '^https?://')`,
    ),
    check(
      'org_organisation_ror_id_check',
      sql`${table.rorId} is null or ${table.rorId} ~ '^0[a-hj-km-np-tv-z0-9]{6}[0-9]{2}$'`,
    ),
    check('org_organisation_same_as_check', sql`cardinality(${table.sameAs}) <= 20`),
    check(
      'org_organisation_contact_check',
      sql`(${table.contactEmail} is null) = (${table.contactType} is null)
        and (${table.contactEmail} is null or char_length(${table.contactEmail}) <= 254)
        and (${table.contactType} is null or char_length(${table.contactType}) between 1 and 64)`,
    ),
    check(
      'org_organisation_logo_check',
      sql`(${table.logoBlobId} is null) = (${table.logoHash} is null)`,
    ),
  ],
);
