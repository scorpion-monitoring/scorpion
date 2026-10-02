// Roles of users, seen from core.identity: list the roles, give one to a user, take one away, and
// the default role of an account that becomes active. The roles themselves are data owned by
// core.authz; this service only adds identity's own permission and the check that the user exists.
//
// Two permissions guard a role change, on purpose (ADR 0015): the route and this service check
// `core.identity.role.assign`/`.read` (who may administer users here), and core.authz checks
// `core.authz.role.*` again inside its own methods (who may change roles at all, for any caller
// including jobs and other modules). Admin holds both. Nobody changes their own roles and the last
// Admin stays: those rules live in core.authz and hold for Admin too.
import { NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService, RoleInfo } from '@scorpion/core-authz/public';
import type { DbTx } from '@scorpion/kernel';
import type { UserService } from '../public.ts';

/** The role an approved account gets unless the approver names another. A seeded role of core.authz. */
export const DEFAULT_ROLE = 'user';
/** The role the first administrator gets. Seeded by core.authz. */
export const ADMIN_ROLE = 'admin';

export const PERMISSION_ROLE_READ = 'core.identity.role.read';
export const PERMISSION_ROLE_ASSIGN = 'core.identity.role.assign';

export interface RoleService {
  /** Needs `core.identity.role.read` and `core.authz.role.read`. */
  list(actor: Actor): Promise<RoleInfo[]>;
  /**
   * Needs `core.identity.role.assign` and `core.authz.role.assign`. 404 for an unknown user or role,
   * 403 for your own roles. Returns `false` when the user already held the role.
   */
  assign(actor: Actor, userId: string, roleKey: string): Promise<boolean>;
  /**
   * Same permissions. 409 for the last Admin, 403 for your own roles. Returns `false` when the user
   * did not hold the role.
   */
  remove(actor: Actor, userId: string, roleKey: string): Promise<boolean>;
}

export function createRoleService(deps: { authz: AuthzService; users: UserService }): RoleService {
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

    async assign(actor, userId, roleKey) {
      await authz.require(actor, PERMISSION_ROLE_ASSIGN);
      await existing(userId);
      return authz.assignRole(actor, { userId, roleKey });
    },

    async remove(actor, userId, roleKey) {
      await authz.require(actor, PERMISSION_ROLE_ASSIGN);
      await existing(userId);
      return authz.removeRole(actor, { userId, roleKey });
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
  account: { id: string; status: 'pending' | 'active' | 'rejected' },
): Promise<void> {
  if (account.status === 'active') {
    await authz.assignRoleAsSystem(tx, { userId: account.id, roleKey: DEFAULT_ROLE });
  }
}
