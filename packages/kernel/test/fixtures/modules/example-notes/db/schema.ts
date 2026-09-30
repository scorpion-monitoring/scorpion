import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Every table starts with the module's prefix: `example.notes` → `example_notes_`.
export const note = pgTable('example_notes_note', {
  id: uuid().primaryKey(),
  text: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
