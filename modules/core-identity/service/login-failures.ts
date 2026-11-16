// The audit of failed sign-ins (ASVS 6.3.1; ADR 0026, M12a): the throttle counts every failure per name and audit window
// (`identity_login_failure`, one row with a count, written in the transaction of the throttle record), and this service turns
// a closed window into **one** `identity.login.failed@1` event and deletes the row, in one transaction. A thousand failures
// against one name in one window are one row and one audit entry with `count: 1000`; there is no lockout and no row per attempt.
//
// The event holds the count and the window, never the name: a user id when the name was an account, else the first sixteen
// characters of the name's hash (so the same unknown name can be told from another in the trail, and not read).
import { and, asc, sql } from 'drizzle-orm';
import type { ModuleContext } from '@scorpion/kernel';
import { loginFailure } from '../db/schema.ts';

/** How many closed windows one transaction turns into events (a job takes as many rounds as it needs). */
export const FLUSH_BATCH = 500;
/** The part of a key hash the audit shows: enough to tell names apart, too little to try names against. */
export const NAME_KEY_LENGTH = 16;

export interface LoginFailureAudit {
  /**
   * Writes the event of every window that has closed at `now`, oldest first, and removes its row, `FLUSH_BATCH` at a time.
   * Safe to run on several nodes at once: a row is locked while it is turned into its event. Returns counts only.
   */
  flush(now?: Date): Promise<{ windows: number; failures: number }>;
}

export function createLoginFailureAudit(ctx: ModuleContext): LoginFailureAudit {
  async function round(now: Date): Promise<{ windows: number; failures: number }> {
    return ctx.db.tx(async (tx) => {
      const closed = await tx
        .select()
        .from(loginFailure)
        .where(
          and(
            sql`${loginFailure.windowStart} + ${loginFailure.windowSeconds} * interval '1 second' <= ${now}`,
          ),
        )
        .orderBy(asc(loginFailure.windowStart), asc(loginFailure.keyHash))
        .limit(FLUSH_BATCH)
        .for('update', { skipLocked: true });
      let failures = 0;
      for (const row of closed) {
        await ctx.events.emit('identity.login.failed@1', {
          userId: row.userId,
          nameKey: row.keyHash.slice(0, NAME_KEY_LENGTH),
          count: row.failures,
          windowStart: row.windowStart.toISOString(),
          windowSeconds: row.windowSeconds,
        });
        await tx
          .delete(loginFailure)
          .where(
            and(
              sql`${loginFailure.keyHash} = ${row.keyHash}`,
              sql`${loginFailure.windowStart} = ${row.windowStart}`,
            ),
          );
        failures += row.failures;
      }
      return { windows: closed.length, failures };
    });
  }

  return {
    async flush(now = new Date()) {
      let windows = 0;
      let failures = 0;
      for (;;) {
        const done = await round(now);
        windows += done.windows;
        failures += done.failures;
        if (done.windows < FLUSH_BATCH) return { windows, failures };
      }
    },
  };
}
