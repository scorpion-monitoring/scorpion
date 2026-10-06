// Ending sessions as an administrator (ASVS 7.4.5): every session of one user, or every session of
// everybody. Both need `core.identity.session.manage-any`, revoke in one transaction with their
// event (which core.audit records, with the count and who did it), and empty this process's cache
// at once. Another process's cache follows within its TTL (README, "Sessions").
import { NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { ModuleContext } from '@scorpion/kernel';
import type { UserService } from '../public.ts';
import { requireUser } from './require-user.ts';
import type { SessionService } from './sessions.ts';

export interface SessionAdminService {
  /** Ends every open session of one user; returns how many were open. 404 for an unknown user. */
  revokeUser(actor: Actor, userId: string): Promise<number>;
  /**
   * Ends every open session of every user, **except the caller's own** (so the administrator who
   * does it is not locked out); returns how many were open. A caller who uses an access token has
   * no session to spare.
   */
  revokeEverything(actor: Actor): Promise<number>;
}

export function createSessionAdminService(
  ctx: ModuleContext,
  deps: { sessions: SessionService; users: UserService; authz: AuthzService },
): SessionAdminService {
  const { sessions, users, authz } = deps;
  return {
    async revokeUser(actor, userId) {
      const caller = requireUser(actor);
      await authz.require(actor, 'core.identity.session.manage-any');
      const found = await users.findById(userId);
      if (!found) throw new NotFound('There is no such user.');

      const count = await ctx.db.tx(async (tx) => {
        const revoked = await sessions.revokeAll(found.id, tx);
        await ctx.events.emit('identity.sessions.revoked@1', {
          userId: found.id,
          username: found.username,
          revokedBy: caller.userId,
          count: revoked,
        });
        return revoked;
      });
      // After the commit, so a request that raced with the transaction cannot refill the cache.
      await sessions.revokeAll(found.id);
      return count;
    },

    async revokeEverything(actor) {
      const caller = requireUser(actor);
      await authz.require(actor, 'core.identity.session.manage-any');
      const spared = caller.via === 'session' ? caller.sessionId : undefined;

      const count = await ctx.db.tx(async (tx) => {
        const revoked = await sessions.revokeEveryone(spared, tx);
        await ctx.events.emit('identity.sessions.revokedAll@1', {
          revokedBy: caller.userId,
          count: revoked,
        });
        return revoked;
      });
      await sessions.revokeEveryone(spared);
      return count;
    },
  };
}
