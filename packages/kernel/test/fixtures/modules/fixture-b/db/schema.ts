import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const thing = pgTable('fixture_b_thing', {
  id: uuid().primaryKey(),
  name: text().notNull(),
});
