// The tables of registry.organisations. Names start with `org_` (the manifest's `tablePrefix`, ADR 0004).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/registry-organisations`.
//
// No pg enum and no list of types here: `type` is plain text that the service checks against the
// registry `org.type`, so a new type needs no migration. No foreign key to a user or to the blob
// table: ids are kept as written, so a purge or the blob cleanup cannot be blocked.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * One person's membership of one organisation, with a state and a role. One row per pair: a later
 * request after a rejection or a leave reopens it, and the history is the audit trail of the events
 * (ADR-0033). The states and roles are closed sets of code with check constraints, never a pg enum.
 * `user_id` has no foreign key, so a purge cannot be blocked; the service removes the rows of an
 * organisation before the organisation (hence `restrict`).
 */
export const membership = pgTable(
  'org_membership',
  {
    id: uuid().primaryKey(), // UUIDv7
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisation.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull(),
    /** `requested`, `approved`, `rejected` or `left` (see `service/membership-state.ts`). */
    state: text().notNull(),
    /** `member` or `manager`; `manager` only while the state is `approved`. */
    role: text().notNull().default('member'),
    /** When the current request was made (reset when a later request reopens the row). */
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    decidedAt: timestamptz('decided_at'),
    decidedBy: uuid('decided_by'),
    endedAt: timestamptz('ended_at'),
    endedBy: uuid('ended_by'),
    roleChangedAt: timestamptz('role_changed_at'),
    roleChangedBy: uuid('role_changed_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('org_membership_organisation_user_key').on(table.organisationId, table.userId),
    // "My memberships".
    index('org_membership_user_idx').on(table.userId),
    // "Pending, oldest first".
    index('org_membership_pending_idx')
      .on(table.requestedAt, table.id)
      .where(sql`${table.state} = 'requested'`),
    // "Members of an organisation" and the grouped member count.
    index('org_membership_members_idx')
      .on(table.organisationId)
      .where(sql`${table.state} = 'approved'`),
    // "Managers of an organisation" (the manager count, the organisations a person manages).
    index('org_membership_managers_idx')
      .on(table.organisationId, table.userId)
      .where(sql`${table.state} = 'approved' and ${table.role} = 'manager'`),
    check(
      'org_membership_state_check',
      sql`${table.state} in ('requested', 'approved', 'rejected', 'left')`,
    ),
    check('org_membership_role_check', sql`${table.role} in ('member', 'manager')`),
    check(
      'org_membership_manager_approved_check',
      sql`${table.role} = 'member' or ${table.state} = 'approved'`,
    ),
  ],
);
