// The tables of core.authz. Every name starts with `authz_` (the manifest's `tablePrefix`, ADR 0004).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/core-authz`.
//
// The module is user-agnostic (ADR 0014): `user_id` is an opaque id with no foreign key to the
// user table of core.identity, so a purge of a user is never blocked by an assignment and authz
// needs no identity.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A named set of permissions. `admin`, `reviewer` and `user` are seeded with `system = true`. */
export const role = pgTable(
  'authz_role',
  {
    id: uuid().primaryKey(), // UUIDv7
    /** Lower-case letters, digits and `-`; what code and URLs use. Unique. */
    key: text().notNull(),
    /** What the interface shows: `Admin`. */
    label: text().notNull(),
    /** Seeded roles. They cannot be deleted; Admin cannot be edited. */
    system: boolean().notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('authz_role_key_uidx').on(table.key),
    check('authz_role_key_format', sql`${table.key} ~ '^[a-z][a-z0-9-]{0,62}$'`),
  ],
);

/**
 * A permission stored for a role. The service accepts only permissions that a loaded manifest
 * declares; one that is stored but no longer declared (its module left the profile) is ignored.
 * Admin has no rows: it holds every declared permission at check time.
 */
export const rolePermission = pgTable(
  'authz_role_permission',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permission] })],
);

/**
 * A default permission that has been applied to a role once. Seeding adds a contributed default
 * only if it is not recorded here, so a permission an administrator took away does not come back at
 * the next start, and a permission a new module contributes later still reaches existing instances.
 */
export const defaultGrant = pgTable(
  'authz_default_grant',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
    appliedAt: timestamptz('applied_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permission] })],
);

/** A user holds a role. No foreign key to the user (ADR 0014). */
export const roleAssignment = pgTable(
  'authz_role_assignment',
  {
    id: uuid().primaryKey(), // UUIDv7
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'restrict' }),
    /** Who made the change; null for a seed or the bootstrap migration. */
    assignedBy: uuid('assigned_by'),
    assignedAt: timestamptz('assigned_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('authz_role_assignment_user_role_uidx').on(table.userId, table.roleId),
    index('authz_role_assignment_role_idx').on(table.roleId),
  ],
);
