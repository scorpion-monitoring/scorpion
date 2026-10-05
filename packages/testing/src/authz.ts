// Factories for the tables of `core.authz`. They insert rows directly, so a test can set up a role
// or an assignment without going through the service it is not testing. They know the column
// names: a change to the schema breaks the authz integration tests, which is the point. They need
// the module's migrations to have run; the seeded roles (`admin`, `reviewer`, `user`) exist once its
// service has been built.
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let sequence = 0;
const next = () => ++sequence;

export interface MakeRole {
  /** Default: a unique `role-<n>`. */
  key?: string;
  label?: string;
  system?: boolean;
  /** Stored permissions; not checked against any manifest. */
  permissions?: string[];
}

/** A role, with its stored permissions. */
export async function makeRole(db: Queryable, overrides: MakeRole = {}) {
  const key = overrides.key ?? `role-${next()}`;
  const { rows } = await db.query<{ id: string; key: string; label: string; system: boolean }>(
    'insert into authz_role (id, key, label, system) values ($1, $2, $3, $4) returning *',
    [randomUUID(), key, overrides.label ?? key, overrides.system ?? false],
  );
  const created = rows[0]!;
  for (const permission of overrides.permissions ?? []) {
    await db.query('insert into authz_role_permission (role_id, permission) values ($1, $2)', [
      created.id,
      permission,
    ]);
  }
  return created;
}

export interface MakeRoleAssignment {
  /** Who made the change (default: nobody). */
  assignedBy?: string | null;
}

/**
 * Gives a user a role. The role is a row from `makeRole` or the key of an existing one (`admin`).
 * The user is only an id: authz has no user table.
 */
export async function makeRoleAssignment(
  db: Queryable,
  user: { id: string },
  role: { id: string } | string,
  overrides: MakeRoleAssignment = {},
) {
  let roleId: string;
  if (typeof role === 'string') {
    const { rows } = await db.query<{ id: string }>('select id from authz_role where key = $1', [
      role,
    ]);
    if (!rows[0]) throw new Error(`makeRoleAssignment: there is no role "${role}"`);
    roleId = rows[0].id;
  } else {
    roleId = role.id;
  }
  const { rows } = await db.query<{ id: string; user_id: string; role_id: string }>(
    'insert into authz_role_assignment (id, user_id, role_id, assigned_by) values ($1, $2, $3, $4) returning *',
    [randomUUID(), user.id, roleId, overrides.assignedBy ?? null],
  );
  return rows[0]!;
}
