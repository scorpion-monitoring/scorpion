// The tables of bibliometrics. Names start with `biblio_` (the manifest's `tablePrefix`, ADR-0056 Decision 1).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/bibliometrics`.
//
// No pg enum. `service_id` is a plain column, not a foreign key: this module holds no reference into registry.services'
// tables (the service asks `registry.services/public` whether a service exists, as kpi.ingestion does).
// `biblio_doi_metadata` is a cache of the DOI resolver shared by every service that lists the DOI; it has no foreign key to
// `biblio_publication` and outlives its rows.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One publication of one service, by DOI. The DOI is stored normalised (`normaliseDoi` of `packages/integrations`: lower
 * case, no prefix). The unique `(service_id, doi)` is the duplicate detection of FEATURES §3.12.
 */
export const publication = pgTable(
  'biblio_publication',
  {
    id: uuid().primaryKey(), // UUIDv7
    serviceId: uuid('service_id').notNull(),
    doi: text().notNull(),
    /** A user id, kept as written. */
    addedBy: uuid('added_by'),
    addedAt: timestamptz('added_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('biblio_publication_service_doi_key').on(table.serviceId, table.doi),
    index('biblio_publication_doi_idx').on(table.doi),
    check(
      'biblio_publication_doi_check',
      sql`char_length(${table.doi}) between 4 and 256 and ${table.doi} = lower(${table.doi}) and ${table.doi} like '10.%/%'`,
    ),
  ],
);

/**
 * What the DOI resolver answered for a DOI. `ok` carries a title; `not-found` (doi.org does not know the DOI) and `failed`
 * (the lookup did not work: `reason` says why, a fixed code) carry none. `issued` is the first day of the period its
 * precision names (`2020-01-01` for the year 2020).
 */
export const doiMetadata = pgTable(
  'biblio_doi_metadata',
  {
    doi: text().primaryKey(),
    status: text().notNull(),
    reason: text(),
    title: text(),
    authors: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    issued: date({ mode: 'string' }),
    issuedPrecision: text('issued_precision'),
    container: text(),
    type: text(),
    resolvedAt: timestamptz('resolved_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'biblio_doi_metadata_doi_check',
      sql`char_length(${table.doi}) between 4 and 256 and ${table.doi} = lower(${table.doi})`,
    ),
    check(
      'biblio_doi_metadata_status_check',
      sql`${table.status} in ('ok', 'not-found', 'failed')`,
    ),
    check(
      'biblio_doi_metadata_title_check',
      sql`(${table.status} = 'ok') = (${table.title} is not null) and (${table.title} is null or char_length(${table.title}) between 1 and 1000)`,
    ),
    check(
      'biblio_doi_metadata_reason_check',
      sql`(${table.status} = 'failed') = (${table.reason} is not null) and (${table.reason} is null or char_length(${table.reason}) between 1 and 64)`,
    ),
    check(
      'biblio_doi_metadata_authors_check',
      sql`jsonb_typeof(${table.authors}) = 'array' and jsonb_array_length(${table.authors}) <= 100`,
    ),
    check(
      'biblio_doi_metadata_issued_check',
      sql`(${table.issued} is null) = (${table.issuedPrecision} is null) and (${table.issuedPrecision} is null or ${table.issuedPrecision} in ('year', 'month', 'day'))`,
    ),
    check(
      'biblio_doi_metadata_container_check',
      sql`${table.container} is null or char_length(${table.container}) between 1 and 500`,
    ),
    check(
      'biblio_doi_metadata_type_check',
      sql`${table.type} is null or char_length(${table.type}) between 1 and 64`,
    ),
  ],
);
