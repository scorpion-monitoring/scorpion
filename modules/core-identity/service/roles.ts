// Roles of users, seen from core.identity: list the roles, give one to a user, take one away, and
// the default role of an account that becomes active. The roles themselves are data owned by
// core.authz; this service only adds identity's own permission and the check that the user exists.
//
// Two permissions guard a role change, on purpose (ADR 0015): the route and this service check
// `core.identity.role.assign`/`.read` (who may administer users here), and core.authz checks
// `core.authz.role.*` again inside its own methods (who may change roles at all, for any caller
// including jobs and other modules). Admin holds both. Nobody changes their own roles and the last
// Admin stays: those rules live in core.authz and hold for Admin too. Identity adds one: "the last
// Admin" is the last one who can still sign in, so a deactivated Admin does not count.
import { Conflict, NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService, RoleInfo } from '@scorpion/core-authz/public';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbTx, ModuleContext } from '@scorpion/kernel';
import type { UserService, UserStatus } from '../public.ts';
import { user } from '../db/schema.ts';

/** The role an approved account gets unless the approver names another. A seeded role of core.authz. */
export const DEFAULT_ROLE = 'user';
/** The role the first administrator gets. Seeded by core.authz. */
export const ADMIN_ROLE = 'admin';

export const PERMISSION_ROLE_READ = 'core.identity.role.read';
export const PERMISSION_ROLE_ASSIGN = 'core.identity.role.assign';
export const PERMISSION_USER_READ = 'core.identity.user.read';

export interface RoleService {
  /** Needs `core.identity.role.read` and `core.authz.role.read`. */
  list(actor: Actor): Promise<RoleInfo[]>;
  /** Needs `core.identity.user.read` and `core.authz.role.read`. The role keys of one user, 404 for an unknown user. */
  rolesOf(actor: Actor, userId: string): Promise<string[]>;
  /**
   * Needs `core.identity.role.assign` and `core.authz.role.assign`. 404 for an unknown user or role,
   * 403 for your own roles. Returns `false` when the user already held the role.
   */
  assign(actor: Actor, userId: string, roleKey: string): Promise<boolean>;
  /**
   * Same permissions. 409 for the last Admin, 403 for your own roles. "The last Admin" is the last
   * account that holds Admin and can sign in: removing Admin from the only active one is refused even
   * while a deactivated account still holds the role. Returns `false` when the user did not hold the role.
   */
  remove(actor: Actor, userId: string, roleKey: string): Promise<boolean>;
}

export function createRoleService(
  ctx: Pick<ModuleContext, 'db'>,
  deps: { authz: AuthzService; users: UserService },
): RoleService {
  const { authz, users } = deps;

  async function existing(userId: string) {
    const found = await users.findById(userId);
    if (!found || found.deletedAt !== null) throw new NotFound('There is no such user.');
  }

  return {
    async list(actor) {
      await authz.require(actor, PERMISSION_ROLE_READ);
      return authz.listRoles(actor);
    },

    async rolesOf(actor, userId) {
      await authz.require(actor, PERMISSION_USER_READ);
      await existing(userId);
      return authz.rolesOf(actor, userId);
    },

    async assign(actor, userId, roleKey) {
      await authz.require(actor, PERMISSION_ROLE_ASSIGN);
      await existing(userId);
      return authz.assignRole(actor, { userId, roleKey });
    },

    async remove(actor, userId, roleKey) {
      await authz.require(actor, PERMISSION_ROLE_ASSIGN);
      await existing(userId);
      if (roleKey !== ADMIN_ROLE) return authz.removeRole(actor, { userId, roleKey });
      return ctx.db.tx(async (tx: DbTx) => {
        // Takes turns with the deactivation of an account, so the two cannot together leave no Admin.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('identity.admin-set'))`);
        const removed = await authz.removeRole(actor, { userId, roleKey });
        // The authz rule counts assignments; here "an Admin" is one who can still sign in. Throwing
        // undoes the removal and its event.
        if (removed && (await countActiveAdmins(authz, tx)) === 0) {
          throw new Conflict('The last Admin cannot be removed.');
        }
        return removed;
      });
    },
  };
}

/**
 * An account that a policy made active (registration, first OIDC sign-in) holds the default role
 * from the start, in the transaction that created it. A pending account gets its role when it is
 * approved.
 */
export async function grantDefaultRole(
  authz: AuthzService,
  tx: DbTx,
  account: { id: string; status: UserStatus },
): Promise<void> {
  if (account.status === 'active') {
    await authz.assignRoleAsSystem(tx, { userId: account.id, roleKey: DEFAULT_ROLE });
  }
}

/**
 * How many accounts hold Admin and can sign in (status `active`, not deleted), leaving `except` out.
 * "The last Admin" means the last one who could still sign in: a deactivated Admin does not count. Reads
 * at most 1000 holders (the cap of `listHoldersAsSystem`), far more than a real installation has.
 */
export async function countActiveAdmins(
  authz: Pick<AuthzService, 'listHoldersAsSystem'>,
  tx: Pick<DbTx, 'select'>,
  except?: string,
): Promise<number> {
  const holders = (await authz.listHoldersAsSystem(tx, ADMIN_ROLE)).filter((id) => id !== except);
  if (holders.length === 0) return 0;
  const [active] = await tx
    .select({ value: count() })
    .from(user)
    .where(and(inArray(user.id, holders), eq(user.status, 'active'), isNull(user.deletedAt)));
  return active?.value ?? 0;
}
