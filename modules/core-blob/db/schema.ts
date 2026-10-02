// The tables of core.blob. Every name starts with `blob_` (the manifest's `tablePrefix`, ADR 0004).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/core-blob`.
//
// Like core.authz and core.settings the module is user-agnostic (ADR 0014): a reference names its
// owner with an opaque text key, never a foreign key into another module.
import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * One stored file, addressed by the SHA-256 of what is stored. The same bytes are stored once. What
 * is stored is never what was uploaded: rasters are re-encoded and SVG is sanitised (ADR 0018), so
 * `mime` is the type we determined, not the one the client claimed.
 */
export const blob = pgTable(
  'blob_blob',
  {
    id: uuid().primaryKey(), // UUIDv7
    /** Lower-case hex SHA-256 of `data`. The public name of the file (`GET /files/{hash}`). */
    hash: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    data: bytea().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /**
     * Since when nothing refers to the file; `null` while something does. A file stays for the grace
     * period after that (an upload comes before the reference that keeps it) and is then removed by
     * the cleanup job.
     */
    unreferencedSince: timestamptz('unreferenced_since'),
  },
  (table) => [
    uniqueIndex('blob_blob_hash_uidx').on(table.hash),
    index('blob_blob_unreferenced_idx').on(table.unreferencedSince),
  ],
);

/**
 * Who keeps a file alive. `ref` names the owner and the purpose (`core.identity:avatar:<user id>`),
 * so one owner holds at most one file per purpose and replacing it releases the old one.
 */
export const reference = pgTable(
  'blob_reference',
  {
    ref: text().primaryKey(),
    blobId: uuid('blob_id')
      .notNull()
      .references(() => blob.id),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [index('blob_reference_blob_idx').on(table.blobId)],
);
