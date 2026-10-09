// Users as an administrator sees them: the list (with a status filter, a search and a sort), one
// account, and deactivation. Reading needs `core.identity.user.read`; deactivating needs
// `core.identity.user.deactivate`. The fields are the ones of `docs/security/authorization.md`: a person's
// own profile text (bio) and avatar stay with the person, and nothing here carries a secret or a hash.
//
// Deactivating closes the account without deleting it: it cannot sign in, its sessions end in the same
// transaction (ASVS 7.4.2), its access tokens stop working (a token of a user who is not active is
// refused), and its data stays. It is not a soft delete, so the purge job leaves it alone.
import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { Conflict, Forbidden, NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { DbTx, ModuleContext } from '@scorpion/kernel';
import { user } from '../db/schema.ts';
import type { UserStatus } from '../public.ts';
import { requireUser } from './require-user.ts';
import { ADMIN_ROLE, countActiveAdmins, PERMISSION_USER_READ } from './roles.ts';
import type { SessionService } from './sessions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PERMISSION_USER_DEACTIVATE = 'core.identity.user.deactivate';

/** The columns a list can be sorted by. */
export const USER_SORTS = ['username', 'email', 'status', 'createdAt'] as const;
export type UserSort = (typeof USER_SORTS)[number];

export interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  status: UserStatus;
  createdAt: Date;
}

export interface UserListQuery {
  page: number;
  pageSize: number;
  /** Only accounts with this status. Without it: pending, active and deactivated ones (not the rejected). */
  status?: UserStatus;
  /** Accounts whose username or address starts with this text (case-insensitive). */
  q?: string;
  sort?: UserSort;
  direction?: 'asc' | 'desc';
}

export interface UserAdminService {
  /** Needs `core.identity.user.read`. Sorted by the column, then by id, so a page never repeats or skips a row. */
  list(actor: Actor, query: UserListQuery): Promise<{ users: AdminUser[]; total: number }>;
  /** Needs `core.identity.user.read`. 404 for an unknown account. */
  get(actor: Actor, userId: string): Promise<AdminUser>;
  /**
   * Needs `core.identity.user.deactivate`. An active account becomes `deactivated` and every one of its
   * sessions ends in the same transaction. 403 for your own account, 404 for an unknown one, 409 when the
   * account is not active or is the last active Admin.
   */
  deactivate(actor: Actor, userId: string): Promise<AdminUser>;
}

/** `%` and `_` in a search text are letters, not wildcards. */
export const escapeLike = (text: string) =>
  text.replace(/[\\%_]/g, (character) => `\\${character}`);

const columns = {
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  email: user.email,
  emailVerifiedAt: user.emailVerifiedAt,
  status: user.status,
  createdAt: user.createdAt,
};

type Row = {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  status: string;
  createdAt: Date;
};

const toAdminUser = (row: Row): AdminUser => ({
  id: row.id,
  username: row.username,
  displayName: row.displayName,
  email: row.email,
  emailVerified: row.emailVerifiedAt !== null,
  status: row.status as UserStatus,
  createdAt: row.createdAt,
});

const sortColumn = {
  username: user.username,
  email: sql`lower(${user.email})`,
  status: user.status,
  createdAt: user.createdAt,
} as const;

export function createUserAdminService(
  ctx: ModuleContext,
  deps: { authz: AuthzService; sessions: SessionService },
): UserAdminService {
  const { authz, sessions } = deps;

  async function found(userId: string): Promise<AdminUser> {
    if (!UUID.test(userId)) throw new NotFound('There is no such user.');
    const [row] = await ctx.db.select(columns).from(user).where(eq(user.id, userId)).limit(1);
    if (!row) throw new NotFound('There is no such user.');
    return toAdminUser(row);
  }

  return {
    async list(actor, query) {
      requireUser(actor);
      await authz.require(actor, PERMISSION_USER_READ);
      const filters: (SQL | undefined)[] = [];
      if (query.status === 'rejected') {
        filters.push(eq(user.status, 'rejected'));
      } else if (query.status) {
        filters.push(eq(user.status, query.status), isNull(user.deletedAt));
      } else {
        filters.push(ne(user.status, 'rejected'), isNull(user.deletedAt));
      }
      const text = query.q?.trim();
      if (text) {
        const prefix = `${escapeLike(text)}%`;
        filters.push(or(ilike(user.username, prefix), ilike(user.email, prefix)));
      }
      const where = and(...filters);
      const column = sortColumn[query.sort ?? 'username'];
      const order = query.direction === 'desc' ? desc(column) : asc(column);
      const rows = await ctx.db
        .select(columns)
        .from(user)
        .where(where)
        .orderBy(order, query.direction === 'desc' ? desc(user.id) : asc(user.id))
        .limit(query.pageSize)
        .offset(query.page * query.pageSize);
      const [total] = await ctx.db.select({ value: count() }).from(user).where(where);
      return { users: rows.map(toAdminUser), total: total?.value ?? 0 };
    },

    async get(actor, userId) {
      requireUser(actor);
      await authz.require(actor, PERMISSION_USER_READ);
      return found(userId);
    },

    async deactivate(actor, userId) {
      const caller = requireUser(actor);
      await authz.require(actor, PERMISSION_USER_DEACTIVATE);
      if (caller.userId === userId.toLowerCase()) {
        throw new Forbidden('You cannot deactivate your own account.');
      }
      if (!UUID.test(userId)) throw new NotFound('There is no such user.');

      const deactivated = await ctx.db.tx(async (tx) => {
        // Deactivations and role removals of Admin take turns, so two administrators cannot each
        // deactivate the other and leave nobody.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('identity.admin-set'))`);
        const [target] = await tx
          .select(columns)
          .from(user)
          .where(eq(user.id, userId))
          .for('update');
        if (!target) throw new NotFound('There is no such user.');
        if (target.status !== 'active') {
          throw new Conflict('Only an active account can be deactivated.');
        }
        if (await isAdmin(tx, userId)) {
          const others = await countActiveAdmins(authz, tx, userId);
          if (others === 0) throw new Conflict('The last Admin cannot be deactivated.');
        }
        const [changed] = await tx
          .update(user)
          .set({ status: 'deactivated', updatedAt: sql`now()` })
          .where(eq(user.id, userId))
          .returning(columns);
        // The sessions end in the transaction that closes the account (ASVS 7.4.2).
        const ended = await sessions.revokeAll(userId, tx);
        await ctx.events.emit('identity.user.deactivated@1', {
          userId,
          username: target.username,
          deactivatedBy: caller.userId,
          count: ended,
        });
        return toAdminUser(changed!);
      });
      // After the commit, so a request that raced with the transaction cannot refill the cache.
      await sessions.revokeAll(userId);
      return deactivated;
    },
  };

  async function isAdmin(tx: DbTx, userId: string) {
    return (await authz.listHoldersAsSystem(tx, ADMIN_ROLE)).includes(userId);
  }
}
