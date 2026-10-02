// Pure rules for which permissions a set of roles grants. No database, no clock: table-driven tests
// cover it (`permissions.test.ts`).

/** The seeded role that holds every declared permission, resolved at check time (ADR 0014). */
export const ADMIN_ROLE_KEY = 'admin';

/** The roles every instance has. Created by the seed, never deleted. */
export const SYSTEM_ROLES = [
  { key: ADMIN_ROLE_KEY, label: 'Admin' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'user', label: 'User' },
] as const;

export const ROLE_KEY_FORMAT = /^[a-z][a-z0-9-]{0,62}$/;

/** A role a user holds, with the permissions stored for it. */
export interface RoleGrant {
  key: string;
  permissions: readonly string[];
}

export interface EffectivePermissions {
  /** What the roles grant, limited to permissions a loaded manifest declares. */
  granted: ReadonlySet<string>;
  /** Stored permissions that no loaded manifest declares: ignored, to be logged by the caller. */
  unknown: readonly string[];
}

/**
 * The permissions the given roles grant. Admin grants every declared permission whatever is stored
 * for it; any other role grants its stored permissions that are declared. A stored permission that
 * is not declared grants nothing.
 */
export function effectivePermissions(
  roles: readonly RoleGrant[],
  declared: ReadonlySet<string>,
): EffectivePermissions {
  const granted = new Set<string>();
  const unknown = new Set<string>();
  for (const role of roles) {
    if (role.key === ADMIN_ROLE_KEY) {
      for (const permission of declared) granted.add(permission);
      continue;
    }
    for (const permission of role.permissions) {
      if (declared.has(permission)) granted.add(permission);
      else unknown.add(permission);
    }
  }
  return { granted, unknown: [...unknown].sort() };
}

/** The permissions of `wanted` that no manifest declares, in the order given, without repeats. */
export function undeclared(wanted: readonly string[], declared: ReadonlySet<string>): string[] {
  return [...new Set(wanted)].filter((permission) => !declared.has(permission));
}

/** How a caller proved who they are, and what a token may do. A session has no scopes. */
export interface Caller {
  via: 'session' | 'token';
  scopes?: readonly string[];
}

/**
 * Whether a token may use `permission` at all. A scope is the id of a permission, compared exactly
 * (ADR 0015); a token without scopes may use nothing. A session is not limited by scopes.
 */
export function withinScopes(caller: Caller, permission: string): boolean {
  return caller.via !== 'token' || (caller.scopes?.includes(permission) ?? false);
}

/**
 * Whether the caller holds `permission`: the owner must hold it (`held`, from their roles) and,
 * for a token, a scope must name it. The effective permissions of a token are scope ∩ owner.
 */
export function grants(held: ReadonlySet<string>, caller: Caller, permission: string): boolean {
  return held.has(permission) && withinScopes(caller, permission);
}
