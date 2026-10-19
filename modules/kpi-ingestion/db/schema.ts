// The tables of kpi.ingestion. Names start with `kpii_` (the manifest's `tablePrefix`; `kpif_` is kpi.framework's).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/kpi-ingestion`.
//
// No pg enum. `service_id` is a plain column, not a foreign key: this module holds no reference into
// registry.services' tables (the service layer asks `registry.services/public` whether a service exists, the pattern of
// `kpif_service_set`). `indicator_id` points to kpi.framework's `kpif_indicator`, a declared dependency, with `restrict`:
// an indicator with measurements is not deleted (the service answers 409 first through `kpi.indicatorUsage`).
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One run of an ingestion: what a file or a form did (sprint 3 writes it, in the batch's transaction). A dry run is
 * never stored. The file name is sanitised and bounded; the content of a file is never kept. `problems` holds at most
 * 100 entries of `{ row, column, code }`.
 */
export const ingestionRun = pgTable(
  'kpii_ingestion_run',
  {
    id: uuid().primaryKey(), // UUIDv7
    serviceId: uuid('service_id').notNull(),
    /** The id of the adapter (`form`, `csv`, `xlsx`, …), a key of the registry `ingestion.adapter`. */
    adapter: text().notNull(),
    /** A user id, kept as written. */
    actorId: uuid('actor_id'),
    fileName: text('file_name'),
    /** `committed` or `rejected` (checked below; a state of the run, not a vocabulary). */
    status: text().notNull(),
    inserted: integer().notNull().default(0),
    updated: integer().notNull().default(0),
    unchanged: integer().notNull().default(0),
    rejected: integer().notNull().default(0),
    problems: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
  },
  (table) => [
    index('kpii_ingestion_run_service_idx').on(table.serviceId, table.startedAt),
    check('kpii_ingestion_run_adapter_check', sql`char_length(${table.adapter}) between 1 and 64`),
    check(
      'kpii_ingestion_run_file_name_check',
      sql`${table.fileName} is null or char_length(${table.fileName}) between 1 and 120`,
    ),
    check('kpii_ingestion_run_status_check', sql`${table.status} in ('committed', 'rejected')`),
    check(
      'kpii_ingestion_run_counts_check',
      sql`${table.inserted} >= 0 and ${table.updated} >= 0 and ${table.unchanged} >= 0 and ${table.rejected} >= 0`,
    ),
    check(
      'kpii_ingestion_run_problems_check',
      sql`jsonb_typeof(${table.problems}) = 'array' and jsonb_array_length(${table.problems}) <= 100`,
    ),
  ],
);

/**
 * One value of one indicator of one service for one month. `period` is the **last day** of the month (a check says
 * so), so a month has exactly one key. Exactly one of `value_numeric` and `value_text` is set: the registry
 * `kpi.valueType` decides which (`numeric`), and a value is stored in its canonical form (a duration as seconds).
 * The unique `(service_id, indicator_id, period)` is what makes a second submission an update (defect 6).
 */
export const measurement = pgTable(
  'kpii_measurement',
  {
    id: uuid().primaryKey(), // UUIDv7
    serviceId: uuid('service_id').notNull(),
    // An indicator with measurements is not deleted from under them: the service answers 409 first.
    indicatorId: uuid('indicator_id').notNull(),
    period: date({ mode: 'string' }).notNull(),
    valueNumeric: numeric('value_numeric'),
    valueText: text('value_text'),
    /** The adapter id that wrote the value (`form`, `csv`, `xlsx`), or `api` for v1. */
    source: text().notNull(),
    // A run that is deleted leaves its measurements (they are the data); only the pointer goes.
    runId: uuid('run_id').references(() => ingestionRun.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** User ids, kept as written. */
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    uniqueIndex('kpii_measurement_series_idx').on(table.serviceId, table.indicatorId, table.period),
    index('kpii_measurement_service_period_idx').on(table.serviceId, table.period),
    index('kpii_measurement_indicator_idx').on(table.indicatorId),
    index('kpii_measurement_run_idx').on(table.runId),
    check(
      'kpii_measurement_period_check',
      sql`${table.period} = (date_trunc('month', ${table.period}::timestamp) + interval '1 month' - interval '1 day')::date`,
    ),
    check(
      'kpii_measurement_one_value_check',
      sql`(${table.valueNumeric} is null) <> (${table.valueText} is null)`,
    ),
    check(
      'kpii_measurement_numeric_check',
      sql`${table.valueNumeric} is null or (${table.valueNumeric} <> 'NaN'::numeric and ${table.valueNumeric} <> 'Infinity'::numeric and ${table.valueNumeric} <> '-Infinity'::numeric)`,
    ),
    check(
      'kpii_measurement_text_check',
      sql`${table.valueText} is null or char_length(${table.valueText}) between 1 and 4000`,
    ),
    check('kpii_measurement_source_check', sql`char_length(${table.source}) between 1 and 64`),
  ],
);
