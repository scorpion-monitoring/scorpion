// Approval: a pending account becomes active (approved) or is rejected, which soft-deletes it.
// Approving also gives the account its role, in the same transaction as the status change and the
// event: if the role cannot be given (unknown role, the approver may not assign roles), the account
// stays pending. The route checks the permission, and the service checks it again with
// `core.authz` and the approval resource, so nobody approves or rejects their own account, Admin
// included. The mail to the person is queued in the same transaction, before the event, so a
// rollback sends nothing (core.notifications, ADR 0019).
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { Conflict, NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { ModuleContext } from '@scorpion/kernel';
import { user } from '../db/schema.ts';
import type { User } from '../public.ts';
import type { IdentityMail } from './identity-mail.ts';
import type { MailLinks } from './mail-links.ts';
import { requireUser } from './require-user.ts';
import { DEFAULT_ROLE } from './roles.ts';
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
  /**
   * Pending → active, and gives the account `options.role` (default `user`) in the same transaction.
   * 404 for an unknown account or role, 409 when it is not pending, 403 for your own account or when
   * the caller may not assign roles (`core.authz.role.assign`).
   */
  approve(actor: Actor, userId: string, options?: { role?: string }): Promise<User['status']>;
  /** Pending → rejected, and soft-deleted. Same refusals as `approve`. */
  reject(actor: Actor, userId: string): Promise<User['status']>;
}

export function createApprovalService(
  ctx: ModuleContext,
  deps: { sessions: SessionService; authz: AuthzService; mail: IdentityMail; links: MailLinks },
): ApprovalService {
  const { authz, mail, links } = deps;

  async function decide(
    actor: Actor,
    userId: string,
    verb: 'approve' | 'reject',
    role: string = DEFAULT_ROLE,
  ): Promise<User['status']> {
    const { userId: deciderId } = requireUser(actor);
    // The account is the request: the built-in protection of core.authz refuses a decision on your
    // own request whatever roles you hold (403), before anything is looked up.
    await authz.require(actor, `core.identity.user.${verb}`, {
      type: 'user',
      id: userId,
      approval: true,
      requestedBy: userId,
    });
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
        .returning({ id: user.id, username: user.username, email: user.email });
      if (changed.length === 0) {
        const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId));
        if (!existing) throw new NotFound('There is no such user.');
        throw new Conflict('This account is not waiting for approval.');
      }
      // The person hears in their own language when they chose one; an account with no address
      // (an OIDC provider that sent none) gets no mail.
      const recipient = changed[0]!.email ? { address: changed[0]!.email, userId } : undefined;
      const locale = recipient ? await mail.preferredLocale(userId) : undefined;
      if (verb === 'approve') {
        // Joins this transaction: a role that cannot be given undoes the approval.
        await authz.assignRole(actor, { userId, roleKey: role });
        if (recipient) {
          await mail.send(
            tx,
            'identity.approved',
            { username: changed[0]!.username, signInUrl: links.signIn() },
            recipient,
            locale,
          );
        }
        await ctx.events.emit('identity.user.approved@1', {
          userId,
          username: changed[0]!.username,
          approvedBy: deciderId,
          role,
        });
      } else {
        if (recipient) {
          await mail.send(
            tx,
            'identity.rejected',
            { username: changed[0]!.username },
            recipient,
            locale,
          );
        }
        await ctx.events.emit('identity.user.rejected@1', {
          userId,
          username: changed[0]!.username,
          rejectedBy: deciderId,
        });
      }
    });
    if (verb === 'reject') await deps.sessions.revokeAll(userId); // a pending account has none; belt and braces
    return status;
  }

  return {
    async listPending(actor, { page, pageSize }) {
      requireUser(actor);
      await authz.require(actor, 'core.identity.user.list-pending');
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
    approve: (actor, userId, options) => decide(actor, userId, 'approve', options?.role),
    reject: (actor, userId) => decide(actor, userId, 'reject'),
  };
}
