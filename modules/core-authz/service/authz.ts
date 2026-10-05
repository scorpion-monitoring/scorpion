// The authorisation service: who holds which permission, roles as data, and the protections that
// hold for everyone. See ADR 0014.
//
// The permissions of a user are cached in process for `PERMISSION_CACHE_TTL_MS` and the cache is
// emptied for the affected user (or everyone, for an edited role) after a change commits in this
// process. Another process learns of a change when its entry expires, so with several server
// processes a demoted user can keep a permission there for at most that long (the bound of
// sessions, ADR 0007). Writes in this service decide from the database, never from the cache.
import {
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type Actor,
  type UserActor,
} from '@scorpion/contracts';
import { ids, type DbTx, type ModuleContext } from '@scorpion/kernel';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { defaultGrant, role, roleAssignment, rolePermission } from '../db/schema.ts';
import type { AuthzService, RoleInfo } from '../public.ts';
import {
  ADMIN_ROLE_KEY,
  effectivePermissions,
  grants,
  SYSTEM_ROLES,
  withinScopes,
  undeclared,
  type RoleGrant,
} from './permissions.ts';
import {
  DEFAULT_ROLE_REGISTRY,
  defaultRoleEntrySchema,
  RESOURCE_POLICY_REGISTRY,
  resourcePolicyEntrySchema,
  type Resource,
  type ResourcePolicyEntry,
} from './registries.ts';

/** How long one process trusts the permissions it has resolved. The staleness bound across processes. */
export const PERMISSION_CACHE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PERMISSION_ROLE_READ = 'core.authz.role.read';
export const PERMISSION_ROLE_ASSIGN = 'core.authz.role.assign';
export const PERMISSION_ROLE_MANAGE = 'core.authz.role.manage';

export interface AuthzInternals extends AuthzService {
  /** Inserts the seeded roles and the contributed default permissions. Idempotent. */
  seed(): Promise<void>;
  /** The decision of the route-level authoriser: 401 for anonymous, 403 for a missing permission. */
  authorizeRoute(actor: Actor, permission: string): Promise<void>;
}

interface CacheEntry {
  permissions: ReadonlySet<string>;
  checkedAt: number;
}

export function createAuthzService(
  ctx: ModuleContext,
  options: { cacheTtlMs?: number; now?: () => number } = {},
): AuthzInternals {
  const ttl = options.cacheTtlMs ?? PERMISSION_CACHE_TTL_MS;
  const clock = options.now ?? Date.now;
  const declaredInfo = new Map(ctx.permissions.map((permission) => [permission.id, permission]));
  const declared: ReadonlySet<string> = new Set(declaredInfo.keys());
  const cache = new Map<string, CacheEntry>();
  /** Bumped by every invalidation; a lookup that raced with one does not cache its result. */
  let generation = 0;
  const warnedUnknown = new Set<string>();

  const invalidate = (userId?: string) => {
    generation += 1;
    if (userId === undefined) cache.clear();
    else cache.delete(userId);
  };

  async function loadGrants(userId: string): Promise<RoleGrant[]> {
    const rows = await ctx.db
      .select({ key: role.key, permission: rolePermission.permission })
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .leftJoin(rolePermission, eq(rolePermission.roleId, role.id))
      .where(eq(roleAssignment.userId, userId));
    const byRole = new Map<string, string[]>();
    for (const row of rows) {
      const list = byRole.get(row.key) ?? [];
      if (row.permission) list.push(row.permission);
      byRole.set(row.key, list);
    }
    return [...byRole].map(([key, permissions]) => ({ key, permissions }));
  }

  /** What a user holds. `fresh` skips the cache (and does not fill it). */
  async function permissionsOf(userId: string, fresh = false): Promise<ReadonlySet<string>> {
    const now = clock();
    const hit = cache.get(userId);
    if (!fresh && hit && now - hit.checkedAt < ttl) return hit.permissions;
    const before = generation;
    // A malformed id cannot be a user id of ours; it holds nothing (and Postgres would throw).
    const grants = UUID.test(userId) ? await loadGrants(userId) : [];
    const { granted, unknown } = effectivePermissions(grants, declared);
    for (const permission of unknown) {
      if (warnedUnknown.has(permission)) continue;
      warnedUnknown.add(permission);
      // The id of a permission is not a secret. It is ignored: never granted.
      ctx.log.warn({ permission }, 'a stored permission is not declared by any loaded module');
    }
    if (!fresh && before === generation) {
      cache.delete(userId);
      cache.set(userId, { permissions: granted, checkedAt: now });
      if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    }
    return granted;
  }

  let policies: ResourcePolicyEntry[] | undefined;
  const policyEntries = () =>
    (policies ??= ctx
      .registry(RESOURCE_POLICY_REGISTRY)
      .map((entry) => resourcePolicyEntrySchema.parse(entry)));

  type Decision = 'allow' | 'unauthenticated' | 'deny';

  async function decide(
    actor: Actor,
    permission: string,
    resource: Resource | undefined,
    fresh: boolean,
  ): Promise<Decision> {
    if (actor.kind !== 'user') return 'unauthenticated';
    const info = declaredInfo.get(permission);
    if (!info) {
      ctx.log.warn({ permission }, 'a permission that no loaded module declares was checked');
      return 'deny';
    }
    // Built-in protection first, so it holds for Admin and no policy can undo it.
    if (resource?.approval && resource.requestedBy === actor.userId) return 'deny';
    // A token passes only for what its scopes name AND its owner holds (scope ∩ owner, ADR 0015).
    // The scope gate also covers resource policies, so a token cannot reach what it was not given.
    if (!withinScopes(actor, permission)) return 'deny';
    if (grants(await permissionsOf(actor.userId, fresh), actor, permission)) return 'allow';
    if (resource && info.scope !== undefined && resource.type === info.scope) {
      const policies = policyEntries().filter((entry) => entry.resourceType === resource.type);
      for (const policy of policies) {
        if (await policy.allows({ actor: actor, permission, resource })) return 'allow';
      }
    }
    return 'deny';
  }

  async function requireNow(
    actor: Actor,
    permission: string,
    resource?: Resource,
    fresh = false,
  ): Promise<void> {
    const decision = await decide(actor, permission, resource, fresh);
    if (decision === 'unauthenticated') throw new Unauthorized();
    if (decision === 'deny') throw new Forbidden();
  }

  /** Checks the permission from the database, then "nobody changes their own roles". */
  async function requireRoleChange(
    actor: Actor,
    rawUserId: string,
  ): Promise<{ caller: UserActor; userId: string }> {
    const userId = rawUserId.toLowerCase();
    await requireNow(actor, PERMISSION_ROLE_ASSIGN, undefined, true);
    const caller = actor as UserActor;
    if (!UUID.test(userId)) {
      throw new Invalid('The user id is not valid.', [{ path: 'userId', message: 'Not a UUID.' }]);
    }
    if (caller.userId.toLowerCase() === userId) {
      throw new Forbidden('You cannot change your own roles.');
    }
    return { caller, userId };
  }

  async function findRole(tx: Pick<DbTx, 'select'>, key: string, lock = false) {
    const query = tx
      .select({ id: role.id, key: role.key, label: role.label, system: role.system })
      .from(role)
      .where(eq(role.key, key));
    const [found] = await (lock ? query.for('update') : query);
    if (!found) throw new NotFound(`There is no role "${key}".`);
    return found;
  }

  async function describeRoles(keys?: string[]): Promise<RoleInfo[]> {
    const roles = await ctx.db
      .select({ id: role.id, key: role.key, label: role.label, system: role.system })
      .from(role)
      .where(keys ? inArray(role.key, keys) : undefined)
      .orderBy(asc(role.key));
    const stored = await ctx.db
      .select({ roleId: rolePermission.roleId, permission: rolePermission.permission })
      .from(rolePermission);
    return roles.map(({ id, key, label, system }) => ({
      key,
      label,
      system,
      permissions:
        key === ADMIN_ROLE_KEY
          ? [...declared].sort()
          : stored
              .filter((row) => row.roleId === id && declared.has(row.permission))
              .map((row) => row.permission)
              .sort(),
    }));
  }

  return {
    async seed() {
      const entries = ctx
        .registry(DEFAULT_ROLE_REGISTRY)
        .map((entry) => defaultRoleEntrySchema.parse(entry));
      await ctx.db.tx(async (tx) => {
        await tx
          .insert(role)
          .values(
            SYSTEM_ROLES.map(({ key, label }) => ({ id: ids.uuidv7(), key, label, system: true })),
          )
          .onConflictDoNothing({ target: role.key });
        const roles = new Map(
          (await tx.select({ id: role.id, key: role.key }).from(role)).map((r) => [r.key, r.id]),
        );
        for (const entry of entries) {
          const roleId = roles.get(entry.role);
          if (!roleId || entry.role === ADMIN_ROLE_KEY) {
            if (entry.role !== ADMIN_ROLE_KEY) {
              ctx.log.warn(
                { role: entry.role },
                'a default permission names a role that does not exist',
              );
            }
            continue; // Admin holds everything already
          }
          for (const permission of new Set(entry.permissions)) {
            if (!declared.has(permission)) {
              ctx.log.warn(
                { permission },
                'a default permission is not declared by any loaded module',
              );
              continue;
            }
            const applied = await tx
              .insert(defaultGrant)
              .values({ roleId, permission })
              .onConflictDoNothing()
              .returning({ permission: defaultGrant.permission });
            if (applied.length > 0) {
              await tx.insert(rolePermission).values({ roleId, permission }).onConflictDoNothing();
            }
          }
        }
      });
      invalidate();
    },

    authorizeRoute: (actor, permission) => requireNow(actor, permission),
    require: (actor, permission, resource) => requireNow(actor, permission, resource),
    async can(actor, permission, resource) {
      return (await decide(actor, permission, resource, false)) === 'allow';
    },

    async listRoles(actor) {
      await requireNow(actor, PERMISSION_ROLE_READ);
      return describeRoles();
    },

    async rolesOf(actor, userId) {
      if (actor.kind !== 'user') throw new Unauthorized();
      if (actor.userId !== userId) await requireNow(actor, PERMISSION_ROLE_READ);
      if (!UUID.test(userId)) return [];
      const rows = await ctx.db
        .select({ key: role.key })
        .from(roleAssignment)
        .innerJoin(role, eq(role.id, roleAssignment.roleId))
        .where(eq(roleAssignment.userId, userId))
        .orderBy(asc(role.key));
      return rows.map((row) => row.key);
    },

    async assignRole(actor, input) {
      const { caller, userId } = await requireRoleChange(actor, input.userId);
      const roleKey = input.roleKey;
      const changed = await ctx.db.tx(async (tx) => {
        const target = await findRole(tx, roleKey);
        const inserted = await tx
          .insert(roleAssignment)
          .values({ id: ids.uuidv7(), userId, roleId: target.id, assignedBy: caller.userId })
          .onConflictDoNothing()
          .returning({ id: roleAssignment.id });
        if (inserted.length === 0) return false;
        await ctx.events.emit('authz.role.assigned@1', {
          userId,
          roleKey: target.key,
          actorId: caller.userId,
        });
        return true;
      });
      invalidate(userId);
      return changed;
    },

    async removeRole(actor, input) {
      const { caller, userId } = await requireRoleChange(actor, input.userId);
      const roleKey = input.roleKey;
      const changed = await ctx.db.tx(async (tx) => {
        // The lock on the role row makes removals of one role take turns, so two at once cannot both
        // see "two Admins left" and remove both.
        const target = await findRole(tx, roleKey, true);
        const [held] = await tx
          .select({ id: roleAssignment.id })
          .from(roleAssignment)
          .where(and(eq(roleAssignment.userId, userId), eq(roleAssignment.roleId, target.id)));
        if (!held) return false;
        if (target.key === ADMIN_ROLE_KEY) {
          const [counted] = await tx
            .select({ holders: sql<number>`count(*)::int` })
            .from(roleAssignment)
            .where(eq(roleAssignment.roleId, target.id));
          if ((counted?.holders ?? 0) <= 1) throw new Conflict('The last Admin cannot be removed.');
        }
        await tx.delete(roleAssignment).where(eq(roleAssignment.id, held.id));
        await ctx.events.emit('authz.role.removed@1', {
          userId,
          roleKey: target.key,
          actorId: caller.userId,
        });
        return true;
      });
      invalidate(userId);
      return changed;
    },

    async assignRoleAsSystem(tx, input) {
      const userId = input.userId.toLowerCase();
      if (!UUID.test(userId)) {
        throw new Invalid('The user id is not valid.', [
          { path: 'userId', message: 'Not a UUID.' },
        ]);
      }
      const target = await findRole(tx, input.roleKey);
      const inserted = await tx
        .insert(roleAssignment)
        .values({ id: ids.uuidv7(), userId, roleId: target.id, assignedBy: null })
        .onConflictDoNothing()
        .returning({ id: roleAssignment.id });
      invalidate(userId);
      if (inserted.length === 0) return false;
      await ctx.events.emit('authz.role.assigned@1', {
        userId,
        roleKey: target.key,
        actorId: null,
      });
      return true;
    },

    async removeAllAssignments(tx, userId) {
      const id = userId.toLowerCase();
      if (!UUID.test(id)) return 0;
      const removed = await tx
        .delete(roleAssignment)
        .where(eq(roleAssignment.userId, id))
        .returning({ id: roleAssignment.id });
      invalidate(id);
      return removed.length;
    },

    async listHoldersAsSystem(tx, roleKey, options = {}) {
      const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000);
      const rows = await tx
        .select({ userId: roleAssignment.userId })
        .from(roleAssignment)
        .innerJoin(role, eq(role.id, roleAssignment.roleId))
        .where(eq(role.key, roleKey))
        .orderBy(roleAssignment.userId)
        .limit(limit);
      return rows.map((row) => row.userId);
    },

    async hasHolders(roleKey, tx = ctx.db) {
      const [found] = await tx
        .select({ id: roleAssignment.id })
        .from(roleAssignment)
        .innerJoin(role, eq(role.id, roleAssignment.roleId))
        .where(eq(role.key, roleKey))
        .limit(1);
      return found !== undefined;
    },

    async setRolePermissions(actor, roleKey, permissions) {
      await requireNow(actor, PERMISSION_ROLE_MANAGE, undefined, true);
      const missing = undeclared(permissions, declared);
      if (missing.length > 0) {
        throw new Invalid(
          'A permission is not declared by any loaded module.',
          missing.map((permission) => ({
            path: 'permissions',
            message: `"${permission}" is not a known permission.`,
          })),
        );
      }
      await ctx.db.tx(async (tx) => {
        const target = await findRole(tx, roleKey, true);
        if (target.key === ADMIN_ROLE_KEY) {
          throw new Forbidden('Admin holds every permission and cannot be edited.');
        }
        await tx.delete(rolePermission).where(eq(rolePermission.roleId, target.id));
        const wanted = [...new Set(permissions)];
        if (wanted.length > 0) {
          await tx
            .insert(rolePermission)
            .values(wanted.map((permission) => ({ roleId: target.id, permission })));
        }
      });
      invalidate();
      return (await describeRoles([roleKey]))[0]!;
    },
  };
}
