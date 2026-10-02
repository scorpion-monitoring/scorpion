// Approval: a pending account becomes active (approved) or is rejected, which soft-deletes it.
// Only the status changes here; roles are assigned by core.authz in M3. The routes check the
// permission; until `ctx.authz` exists (M3) the service refuses an anonymous caller and the
// two things no permission may allow: approving or rejecting your own account.
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { Conflict, Forbidden, NotFound, type Actor } from '@scorpion/contracts';
import type { ModuleContext } from '@scorpion/kernel';
import { user } from '../db/schema.ts';
import type { User } from '../public.ts';
import { requireUser } from './require-user.ts';
import type { SessionService } from './sessions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PendingUser {
  id: string;
  username: string;
  email: string | null;
  createdAt: Date;
}

export interface ApprovalService {
  /** Lists accounts waiting for a decision, oldest first. */
  listPending(
    actor: Actor,
    page: { page: number; pageSize: number },
  ): Promise<{ users: PendingUser[]; total: number }>;
  /** Pending → active. 404 for an unknown account, 409 when it is not pending, 403 for your own. */
  approve(actor: Actor, userId: string): Promise<User['status']>;
  /** Pending → rejected, and soft-deleted. Same refusals as `approve`. */
  reject(actor: Actor, userId: string): Promise<User['status']>;
}

export function createApprovalService(
  ctx: ModuleContext,
  deps: { sessions: SessionService },
): ApprovalService {
  async function decide(
    actor: Actor,
    userId: string,
    verb: 'approve' | 'reject',
  ): Promise<User['status']> {
    const { userId: deciderId } = requireUser(actor);
    if (deciderId === userId) {
      throw new Forbidden(`You cannot ${verb} your own account.`);
    }
    if (!UUID.test(userId)) throw new NotFound('There is no such user.');

    const status = verb === 'approve' ? 'active' : 'rejected';
    await ctx.db.tx(async (tx) => {
      const changed = await tx
        .update(user)
        .set({
          status,
          // Rejecting soft-deletes: the row stays and the username stays reserved.
          deletedAt: verb === 'reject' ? sql`now()` : undefined,
          updatedAt: sql`now()`,
        })
        .where(and(eq(user.id, userId), eq(user.status, 'pending'), isNull(user.deletedAt)))
        .returning({ id: user.id, username: user.username });
      if (changed.length === 0) {
        const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
        if (!existing) throw new NotFound('There is no such user.');
        throw new Conflict('This account is not waiting for approval.');
      }
      await ctx.events.emit(
        verb === 'approve' ? 'identity.user.approved@1' : 'identity.user.rejected@1',
        {
          userId,
          username: changed[0]!.username,
          [verb === 'approve' ? 'approvedBy' : 'rejectedBy']: deciderId,
        },
      );
    });
    if (verb === 'reject') await deps.sessions.revokeAll(userId); // a pending account has none; belt and braces
    return status;
  }

  return {
    async listPending(actor, { page, pageSize }) {
      requireUser(actor);
      const waiting = and(eq(user.status, 'pending'), isNull(user.deletedAt));
      const users = await ctx.db
        .select({
          id: user.id,
          username: user.username,
          email: user.email,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(waiting)
        .orderBy(asc(user.createdAt), asc(user.id))
        .limit(pageSize)
        .offset(page * pageSize);
      const [total] = await ctx.db.select({ value: count() }).from(user).where(waiting);
      return { users, total: total?.value ?? 0 };
    },
    approve: (actor, userId) => decide(actor, userId, 'approve'),
    reject: (actor, userId) => decide(actor, userId, 'reject'),
  };
}
