// The tables of core.settings. Every name starts with `settings_` (the manifest's `tablePrefix`,
// ADR 0004). Create a migration after a change: `pnpm db:generate --filter @scorpion/core-settings`.
//
// The module is user-agnostic like core.authz (ADR 0014): `user_id` and `updated_by` are opaque ids
// with no foreign key to the user table of core.identity, so a purge of a user is never blocked.
import {
  boolean,
  customType,
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
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * The stored settings of one module: the JSON an administrator saved, validated by the module's
 * own `settings` schema. No row means "all defaults". Never holds a secret (CLAUDE.md).
 */
export const setting = pgTable('settings_setting', {
  /** The module that owns the settings: `core.identity`. */
  moduleId: text('module_id').primaryKey(),
  value: jsonb().notNull(),
  /** Bumped by every write; a write names the version it read (optimistic locking). */
  version: integer().notNull().default(1),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** One preference of one user. The key is registered in `settings.userPreference`. */
export const userPreference = pgTable(
  'settings_user_preference',
  {
    id: uuid().primaryKey(), // UUIDv7
    userId: uuid('user_id').notNull(),
    key: text().notNull(),
    value: jsonb().notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('settings_user_preference_user_key_uidx').on(table.userId, table.key)],
);

/**
 * A secret, encrypted with AES-256-GCM (ADR 0016). `ciphertext` holds the encrypted value followed
 * by the 16-byte authentication tag; `nonce` is 12 random bytes, new for every write. `key_id`
 * names the key that encrypted the row, so a rotation can run while rows of two keys exist.
 */
export const secret = pgTable(
  'settings_secret',
  {
    id: uuid().primaryKey(), // UUIDv7
    name: text().notNull(),
    ciphertext: bytea().notNull(),
    nonce: bytea().notNull(),
    keyId: text('key_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    uniqueIndex('settings_secret_name_uidx').on(table.name),
    index('settings_secret_key_idx').on(table.keyId),
  ],
);

/**
 * A vocabulary: a list of terms that replaces a pg enum (CLAUDE.md rule 8). The id is declared by a
 * module in the registry `vocabulary` (`stage`, `necessity`, ...); rows exist only for vocabularies
 * that a loaded module declares, and are written when the module starts.
 */
export const vocabulary = pgTable('settings_vocabulary', {
  id: text().primaryKey(),
  description: text().notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

/**
 * One term of a vocabulary. `labels` maps a locale to the text people see (`{"en": "Production"}`);
 * `key` is what other modules store and never changes. A term is deactivated, not deleted, once
 * something uses it: it stays valid for what refers to it and cannot be chosen for anything new.
 */
export const vocabularyTerm = pgTable(
  'settings_vocabulary_term',
  {
    id: uuid().primaryKey(), // UUIDv7
    vocabularyId: text('vocabulary_id')
      .notNull()
      .references(() => vocabulary.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    labels: jsonb().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean().notNull().default(true),
    /** Declared by a module (as opposed to added by an administrator): never deleted, only deactivated. */
    seeded: boolean().notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('settings_vocabulary_term_key_uidx').on(table.vocabularyId, table.key)],
);
