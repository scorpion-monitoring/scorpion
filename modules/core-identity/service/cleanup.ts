// The hourly cleanup (ADR 0013): rows that can never be used again, and the purge of accounts that
// were soft-deleted long enough ago. It is a job, not a service anyone calls: no route, no actor,
// nothing to authorise. One run is one transaction, so a failure (a subscriber's rule, a database
// error) leaves everything as it was and the next run does it again.
import { and, inArray, isNotNull, lt, or } from 'drizzle-orm';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { BlobService } from '@scorpion/core-blob/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { ModuleContext } from '@scorpion/kernel';
import { firstRunToken, loginState, session, token, user } from '../db/schema.ts';
import { avatarReference } from './avatar-reference.ts';
import { deleteSpentMailTokens } from './mail-tokens.ts';
import { daysToMs, type IdentitySettings } from './settings.ts';

export interface CleanupResult {
  sessions: number;
  loginStates: number;
  mailTokens: number;
  accessTokens: number;
  firstRunTokens: number;
  purgedUsers: number;
}

export interface CleanupService {
  /** Deletes what is spent or expired as of `now`. Returns how many rows of each kind went. */
  run(now?: Date): Promise<CleanupResult>;
}

export function createCleanupService(
  ctx: ModuleContext,
  deps: {
    authz: Pick<AuthzService, 'removeAllAssignments'>;
    blob: Pick<BlobService, 'setReference'>;
    notifications: Pick<NotificationsService, 'removeInboxOfUser'>;
    settings: IdentitySettings;
  },
): CleanupService {
  return {
    async run(now = new Date()) {
      // Read first, outside the transaction: the retention numbers are settings (README, "Settings").
      const { retention } = await deps.settings.get();
      return ctx.db.tx(async (tx) => {
        const sessions = await tx
          .delete(session)
          // A revoked session is as dead as an expired one: the lookup is by hash and finds nothing.
          .where(
            or(
              lt(session.expiresAt, now),
              lt(session.absoluteExpiresAt, now),
              isNotNull(session.revokedAt),
            ),
          )
          .returning({ id: session.id });
        const loginStates = await tx
          .delete(loginState)
          .where(lt(loginState.expiresAt, now))
          .returning({ id: loginState.id });
        const mailTokens = await deleteSpentMailTokens(tx, now);
        const grace = new Date(now.getTime() - daysToMs(retention.tokenGraceDays));
        const accessTokens = await tx
          .delete(token)
          .where(or(lt(token.expiresAt, grace), lt(token.revokedAt, grace)))
          .returning({ id: token.id });
        const firstRunTokens = await tx
          .delete(firstRunToken)
          .where(lt(firstRunToken.expiresAt, now))
          .returning({ id: firstRunToken.id });

        // The purge: accounts soft-deleted (rejected) before the cutoff, oldest first.
        const cutoff = new Date(now.getTime() - daysToMs(retention.purgeAfterDays));
        const due = await tx
          .select({ id: user.id, username: user.username })
          .from(user)
          .where(and(isNotNull(user.deletedAt), lt(user.deletedAt, cutoff)))
          .orderBy(user.deletedAt, user.id)
          .limit(retention.purgeBatch);
        for (const gone of due) {
          // Other modules clean up their rows for this user from this event (ADR 0013).
          await ctx.events.emit('identity.user.purged@1', {
            userId: gone.id,
            username: gone.username,
          });
          // core.authz cannot subscribe to the event (ADR 0003), so its rows go from here, in this
          // transaction and before the user row: a purge that fails leaves the roles in place too.
          await deps.authz.removeAllAssignments(tx, gone.id);
          // The same for the avatar: the file is released with the user row and removed later.
          await deps.blob.setReference(avatarReference(gone.id), null);
          // And the inbox: core.notifications cannot subscribe to identity's events (ADR 0019), so the
          // purge calls it, in this transaction (ADR 0023).
          await deps.notifications.removeInboxOfUser(tx, gone.id);
        }
        if (due.length > 0) {
          // The auth methods, sessions, tokens, mail tokens and login states go with the user (cascade).
          await tx.delete(user).where(
            inArray(
              user.id,
              due.map((row) => row.id),
            ),
          );
        }

        return {
          sessions: sessions.length,
          loginStates: loginStates.length,
          mailTokens,
          accessTokens: accessTokens.length,
          firstRunTokens: firstRunTokens.length,
          purgedUsers: due.length,
        };
      });
    },
  };
}
