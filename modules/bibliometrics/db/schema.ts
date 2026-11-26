// The tables of bibliometrics. Names start with `biblio_` (the manifest's `tablePrefix`, ADR-0056 Decision 1).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/bibliometrics`.
//
// No pg enum. `service_id` is a plain column, not a foreign key: this module holds no reference into registry.services'
// tables (the service asks `registry.services/public` whether a service exists, as kpi.ingestion does).
// `biblio_citation_run` and `biblio_citation_snapshot` hold the citation counts over time; snapshots belong to the DOI, not to
// a service, so a DOI that two services list is asked once.
// `biblio_doi_metadata` is a cache of the DOI resolver shared by every service that lists the DOI; it has no foreign key to
// `biblio_publication` and outlives its rows.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
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

/**
 * One refresh of one citation source (`source`, the id of a `biblio.citationSource` entry), for one slice of the weekly job
 * or one "check now". A manual run names its service (`service_id`, which the 10-minute rule reads); a scheduled run names
 * none. `finished_at` is null while the run waits for the job. `error` is a fixed text, never a key or a URL.
 */
export const citationRun = pgTable(
  'biblio_citation_run',
  {
    id: uuid().primaryKey(), // UUIDv7
    trigger: text().notNull(),
    source: text().notNull(),
    serviceId: uuid('service_id'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    asked: integer().notNull().default(0),
    found: integer().notNull().default(0),
    failed: integer().notNull().default(0),
    error: text(),
  },
  (table) => [
    index('biblio_citation_run_service_idx').on(table.serviceId, table.startedAt),
    check('biblio_citation_run_trigger_check', sql`${table.trigger} in ('schedule', 'manual')`),
    check('biblio_citation_run_source_check', sql`${table.source} ~ '^[a-z][a-z0-9-]{0,31}$'`),
    check(
      'biblio_citation_run_counts_check',
      sql`${table.asked} >= 0 and ${table.found} >= 0 and ${table.failed} >= 0 and ${table.found} + ${table.failed} <= ${table.asked}`,
    ),
    check(
      'biblio_citation_run_error_check',
      sql`${table.error} is null or char_length(${table.error}) between 1 and 500`,
    ),
  ],
);

/**
 * The count a source gave for a DOI in a run. Only a DOI the source knows has a row: an unknown count is the absence of a
 * row, never a zero. The history of a publication is the snapshots of its DOI in time order.
 */
export const citationSnapshot = pgTable(
  'biblio_citation_snapshot',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => citationRun.id, { onDelete: 'cascade' }),
    doi: text().notNull(),
    source: text().notNull(),
    citedByCount: integer('cited_by_count').notNull(),
    takenAt: timestamptz('taken_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('biblio_citation_snapshot_run_doi_key').on(table.runId, table.doi),
    index('biblio_citation_snapshot_doi_idx').on(table.doi, table.source, table.takenAt),
    check(
      'biblio_citation_snapshot_doi_check',
      sql`char_length(${table.doi}) between 4 and 256 and ${table.doi} = lower(${table.doi})`,
    ),
    check('biblio_citation_snapshot_count_check', sql`${table.citedByCount} >= 0`),
  ],
);
