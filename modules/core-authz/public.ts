// The only file other modules may import. It holds the service interface and nothing else.
import type { Actor } from '@scorpion/contracts';
import type { DbTx } from '@scorpion/kernel';
import type { Resource } from './service/registries.ts';

export type { Resource };

export interface RoleInfo {
  key: string;
  label: string;
  /** A seeded role. */
  system: boolean;
  /**
   * Stored permissions that a loaded manifest declares. Admin shows every declared permission,
   * because it holds them all at check time.
   */
  permissions: string[];
}

export interface AuthzService {
  /**
   * Resolves when `actor` holds `permission`, else throws `Unauthorized` (anonymous) or `Forbidden`.
   * With a `resource`, a caller who lacks the permission globally still passes if a policy
   * registered in `authz.resourcePolicy` for the permission's scope allows it. A built-in
   * protection (nobody approves their own request) is checked first and holds for Admin too. A
   * permission that no loaded manifest declares is never granted.
   */
  require(actor: Actor, permission: string, resource?: Resource): Promise<void>;
  /** The same decision as `require`, as a boolean (`false` for anonymous). */
  can(actor: Actor, permission: string, resource?: Resource): Promise<boolean>;

  /** Needs `core.authz.role.read`. Roles by key. */
  listRoles(actor: Actor): Promise<RoleInfo[]>;
  /** The role keys a user holds. Your own are always readable; others need `core.authz.role.read`. */
  rolesOf(actor: Actor, userId: string): Promise<string[]>;
  /**
   * Needs `core.authz.role.assign`. Nobody changes their own roles (403). Unknown role: `NotFound`;
   * `userId` that is not a UUID: `Invalid`. Assigning a role the user holds changes nothing and
   * returns `false`. Called inside the caller's `ctx.db.tx()` it joins that transaction (a
   * savepoint), so a caller can make a role change part of a larger write; the event
   * `authz.role.assigned@1` commits with it.
   */
  assignRole(actor: Actor, input: { userId: string; roleKey: string }): Promise<boolean>;
  /**
   * Needs `core.authz.role.assign`. Nobody changes their own roles (403). The last Admin cannot be
   * removed (`Conflict`), also when two removals run at once. Returns `false` when the user did
   * not hold the role.
   */
  removeRole(actor: Actor, input: { userId: string; roleKey: string }): Promise<boolean>;
  /**
   * For trusted code that acts with no human caller: the bootstrap of the first administrator
   * (`scorpion create-admin`, the first-run token) and the default role of an account that a
   * policy activated. **No permission is checked**, so only a module that may hand out roles calls
   * it (the trust boundary is the profile's module list, as for the authoriser, ADR-0005/0015). It
   * never removes a role. The row has `assigned_by = null`. Call it inside `ctx.db.tx()` with that
   * `tx`: the change and the event `authz.role.assigned@1` (actor `null`) commit together.
   * Unknown role: `NotFound`; `userId` that is not a UUID: `Invalid`. Returns `false` when the user
   * already held the role.
   */
  assignRoleAsSystem(tx: DbTx, input: { userId: string; roleKey: string }): Promise<boolean>;
  /**
   * Removes every role assignment of a user, for the purge of an account (ADR-0014): the caller
   * runs it in the transaction that deletes the user. No permission check, no event, and the
   * last-Admin rule is not applied (a purged account is a rejected one, never an Admin). Returns how
   * many assignments went.
   */
  removeAllAssignments(tx: DbTx, userId: string): Promise<number>;
  /** Whether any user holds the role (no permission check; it names nobody). `tx` reads inside a transaction. */
  hasHolders(roleKey: string, tx?: Pick<DbTx, 'select'>): Promise<boolean>;
  /**
   * Needs `core.authz.role.manage`. Replaces the stored permissions of a role. A permission that no
   * loaded manifest declares is `Invalid` and nothing is stored; Admin cannot be edited (`Forbidden`).
   */
  setRolePermissions(actor: Actor, roleKey: string, permissions: string[]): Promise<RoleInfo>;
}

// Lets `ctx.deps['core.authz']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.authz': AuthzService;
  }
}
