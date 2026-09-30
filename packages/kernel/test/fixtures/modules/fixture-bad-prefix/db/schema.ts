import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

// Broken fixture: the second table does not carry the module's prefix.
export const fine = pgTable('fixture_bad_prefix_fine', { id: uuid().primaryKey() });
export const stray = pgTable('stray_table', { id: uuid().primaryKey(), note: text() });
