// The tables of kpi.framework. Names start with `kpif_` (the manifest's `tablePrefix`; `kpi.ingestion` will use
// `kpii_`). Create a migration after a change: `pnpm db:generate --filter @scorpion/kpi-framework`.
//
// No pg enum: the value type is a key of the registry `kpi.valueType`; the unit, the thematic category, the
// necessity, the aggregate, the means, the tool and the RIMO category are terms of vocabularies. The service
// checks each with `validateTerm`. Foreign keys point only to this module's own tables: a term key is a plain
// column, so a vocabulary change can never be blocked by (or cascade into) this module.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** The slug rule of a service (ADR-0035): a path-safe key that never changes. */
const slugCheck = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`char_length(${column}) between 1 and 64 and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'`,
  );

/**
 * One indicator (`rimo:KPI`, ADR-0040). The values it takes are M10's; here are its type, unit and bounds.
 * A qualitative indicator has the value type `text` and no bounds.
 */
export const indicator = pgTable(
  'kpif_indicator',
  {
    id: uuid().primaryKey(), // UUIDv7
    /** Unique without case. Never changes: the IRI is built from it. */
    slug: text().notNull(),
    /** Unique without case. */
    name: text().notNull(),
    /** Plain text, never HTML. */
    description: text(),
    example: text(),
    qualitative: boolean().notNull().default(false),
    /** A key of the registry `kpi.valueType`, checked in the service. */
    valueType: text('value_type').notNull(),
    /** A term of the vocabulary `kpi.unit`, or none. */
    unit: text(),
    minValue: numeric('min_value'),
    maxValue: numeric('max_value'),
    /** A term of the vocabulary `thematic-category`. */
    thematic: text().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** User ids, kept as written. */
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    uniqueIndex('kpif_indicator_slug_idx').on(sql`lower(${table.slug})`),
    uniqueIndex('kpif_indicator_name_idx').on(sql`lower(${table.name})`),
    index('kpif_indicator_thematic_idx').on(table.thematic),
    index('kpif_indicator_unit_idx').on(table.unit),
    slugCheck('kpif_indicator_slug_check', table.slug),
    check('kpif_indicator_name_check', sql`char_length(${table.name}) between 1 and 200`),
    check(
      'kpif_indicator_description_check',
      sql`${table.description} is null or char_length(${table.description}) <= 4000`,
    ),
    check(
      'kpif_indicator_example_check',
      sql`${table.example} is null or char_length(${table.example}) <= 1000`,
    ),
    check('kpif_indicator_value_type_check', sql`char_length(${table.valueType}) between 1 and 64`),
    // Whether a value type is numeric is registry data, so only the bounds' order and the qualitative rule
    // (Decision 11: a qualitative indicator is a `text` indicator without bounds) live here.
    check(
      'kpif_indicator_bounds_check',
      sql`${table.minValue} is null or ${table.maxValue} is null or ${table.minValue} <= ${table.maxValue}`,
    ),
    check(
      'kpif_indicator_qualitative_check',
      sql`not ${table.qualitative} or (${table.valueType} = 'text' and ${table.minValue} is null and ${table.maxValue} is null)`,
    ),
  ],
);

/** The means of measurement of an indicator (`rimo:measuredBy`): terms of `kpi.measured-by`. */
export const indicatorMeans = pgTable(
  'kpif_indicator_means',
  {
    indicatorId: uuid('indicator_id')
      .notNull()
      .references(() => indicator.id, { onDelete: 'cascade' }),
    termKey: text('term_key').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.indicatorId, table.termKey] }),
    // The usage check of the vocabulary asks "is this term linked to an indicator".
    index('kpif_indicator_means_term_idx').on(table.termKey),
  ],
);

/** The tools that can automate an indicator (`rimo:canBeAutomatedBy`): terms of `kpi.automation-tool`. */
export const indicatorTool = pgTable(
  'kpif_indicator_tool',
  {
    indicatorId: uuid('indicator_id')
      .notNull()
      .references(() => indicator.id, { onDelete: 'cascade' }),
    termKey: text('term_key').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.indicatorId, table.termKey] }),
    index('kpif_indicator_tool_term_idx').on(table.termKey),
  ],
);

/** A KPI set: the old "category", named by an administrator and assigned to services (sprint 3). */
export const kpiSet = pgTable(
  'kpif_kpi_set',
  {
    id: uuid().primaryKey(), // UUIDv7
    /** Unique without case. Never changes. */
    slug: text().notNull(),
    /** Unique without case. */
    name: text().notNull(),
    description: text(),
    /** A key of the vocabulary `kpi.service-category` (a `rimo:ServiceCategory`), or none. */
    rimoCategory: text('rimo_category'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    uniqueIndex('kpif_kpi_set_slug_idx').on(sql`lower(${table.slug})`),
    uniqueIndex('kpif_kpi_set_name_idx').on(sql`lower(${table.name})`),
    index('kpif_kpi_set_rimo_category_idx').on(table.rimoCategory),
    slugCheck('kpif_kpi_set_slug_check', table.slug),
    check('kpif_kpi_set_name_check', sql`char_length(${table.name}) between 1 and 200`),
    check(
      'kpif_kpi_set_description_check',
      sql`${table.description} is null or char_length(${table.description}) <= 4000`,
    ),
  ],
);

/**
 * An indicator in a set, with its necessity (a term of the vocabulary `necessity`). The necessity is never
 * the empty string (defect 14); the service checks that it is an active term.
 */
export const kpiSetIndicator = pgTable(
  'kpif_kpi_set_indicator',
  {
    setId: uuid('set_id')
      .notNull()
      .references(() => kpiSet.id, { onDelete: 'cascade' }),
    // An indicator that a set uses is not deleted from under it: the service answers 409 first.
    indicatorId: uuid('indicator_id')
      .notNull()
      .references(() => indicator.id, { onDelete: 'restrict' }),
    necessity: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.setId, table.indicatorId] }),
    index('kpif_kpi_set_indicator_indicator_idx').on(table.indicatorId),
    index('kpif_kpi_set_indicator_necessity_idx').on(table.necessity),
    check('kpif_kpi_set_indicator_necessity_check', sql`char_length(${table.necessity}) > 0`),
  ],
);

/**
 * The headline of a set: one of its indicators and an aggregate (a term of the vocabulary `aggregate`). The
 * indicator must be in the set (a composite foreign key). `no action` (checked at the end of the statement)
 * lets a delete of the set remove its rows and its evaluation in one statement, whichever goes first.
 */
export const evaluation = pgTable(
  'kpif_evaluation',
  {
    setId: uuid('set_id')
      .primaryKey()
      .references(() => kpiSet.id, { onDelete: 'cascade' }),
    indicatorId: uuid('indicator_id').notNull(),
    aggregate: text().notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    foreignKey({
      name: 'kpif_evaluation_set_indicator_fk',
      columns: [table.setId, table.indicatorId],
      foreignColumns: [kpiSetIndicator.setId, kpiSetIndicator.indicatorId],
    })
      .onDelete('no action')
      .onUpdate('no action'),
    index('kpif_evaluation_aggregate_idx').on(table.aggregate),
    check('kpif_evaluation_aggregate_check', sql`char_length(${table.aggregate}) > 0`),
  ],
);
