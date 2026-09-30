import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const note = pgTable('fixture_a_note', {
  id: uuid().primaryKey(),
  // A reference to a fixture.b thing. Not a foreign key here: fixture.a may not import b's tables.
  thingId: uuid('thing_id').notNull(),
  body: text().notNull(),
});
