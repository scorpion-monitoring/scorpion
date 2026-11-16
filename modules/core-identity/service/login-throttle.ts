// The throttle on failed password attempts (ASVS 6.3.1, 6.1.1; ADR 0026): exponential delay per
// account, with a ceiling and no lockout. Two keys count each failure: the account together with the
// client's network, and the account alone (which is higher, so an attacker who rotates addresses is
// still slowed). A key over its limit is blocked until a time; while it is blocked the login answers
// 429 with `Retry-After` before it looks at the password and without counting, so hammering a blocked
// key does not extend it.
//
// A key is the SHA-256 of the submitted username (lower case) and, for the first key, the address.
// The username need not exist: an unknown name is counted exactly like a known one, so nothing here
// tells them apart, and the table holds neither a name nor an address.
import { createHash } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DbTx, ModuleContext } from '@scorpion/kernel';
import { loginFailure, loginThrottle } from '../db/schema.ts';
import { TooManyRequests } from './errors.ts';
import type { IdentitySettings, IdentitySettingsValues } from './settings.ts';

type Throttle = IdentitySettingsValues['loginThrottle'];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The two keys of one attempt; the address is left out when there is none to key on. */
export function throttleKeys(username: string, address?: string): string[] {
  const name = username.trim().toLowerCase();
  const keys = [sha256(`account:${name}`)];
  if (address !== undefined) keys.unshift(sha256(`pair:${name}\u0000${address}`));
  return keys;
}

/** The key of the account alone, the one the audit counts by: the hash of the lower-case username. */
export const accountKey = (username: string): string =>
  sha256(`account:${username.trim().toLowerCase()}`);

/** The start of the window `now` is in: windows are aligned to the epoch, so they need no state of their own. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const length = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / length) * length);
}

/** Seconds a key stays blocked after its `failures`-th failure; 0 while it still has free attempts. */
export function delaySeconds(failures: number, free: number, throttle: Throttle): number {
  if (failures <= free) return 0;
  const steps = Math.min(failures - free - 1, 40); // far past the ceiling; keeps 2 ** n a safe number
  return Math.min(throttle.baseDelaySeconds * 2 ** steps, throttle.maxDelaySeconds);
}

export interface LoginThrottle {
  /**
   * Throws a 429 with `Retry-After` when any key of this attempt is blocked at `now`. Cheap: one
   * indexed read. Call it before the password is looked at.
   */
  assertOpen(username: string, address: string | undefined, now?: Date): Promise<void>;
  /**
   * Counts one failed attempt on both keys, in the caller's transaction or its own. With `counted` the
   * failure is also added to the count of its audit window in the same transaction (a failed sign-in,
   * not a wrong current password): `userId` is the account the name belongs to, or `null`.
   */
  recordFailure(
    username: string,
    address: string | undefined,
    now?: Date,
    tx?: DbTx,
    counted?: { userId: string | null },
  ): Promise<void>;
  /** Forgets the keys of a successful login. Run it in the transaction that starts the session. */
  reset(tx: Pick<DbTx, 'delete'>, username: string, address: string | undefined): Promise<void>;
}

export function createLoginThrottle(
  ctx: ModuleContext,
  deps: { settings: IdentitySettings },
): LoginThrottle {
  async function assertOpen(username: string, address: string | undefined, now = new Date()) {
    const rows = await ctx.db
      .select({ blockedUntil: loginThrottle.blockedUntil })
      .from(loginThrottle)
      .where(
        and(
          inArray(loginThrottle.keyHash, throttleKeys(username, address)),
          gt(loginThrottle.blockedUntil, now),
        ),
      );
    if (rows.length === 0) return;
    const until = Math.max(...rows.map((row) => row.blockedUntil!.getTime()));
    const seconds = Math.max(1, Math.ceil((until - now.getTime()) / 1000));
    throw new TooManyRequests(
      `Too many failed sign-in attempts. Try again in ${seconds} seconds.`,
      seconds,
    );
  }

  /** One more failure in the window of `now` for this name: an upsert, so a flood is one row with a count. */
  async function countForAudit(
    tx: DbTx,
    username: string,
    userId: string | null,
    now: Date,
    throttle: Throttle,
  ) {
    await tx
      .insert(loginFailure)
      .values({
        keyHash: accountKey(username),
        windowStart: windowStart(now, throttle.auditWindowSeconds),
        windowSeconds: throttle.auditWindowSeconds,
        failures: 1,
        userId,
      })
      .onConflictDoUpdate({
        target: [loginFailure.keyHash, loginFailure.windowStart],
        set: { failures: sql`least(${loginFailure.failures} + 1, 1000000)` },
      });
  }

  async function count(tx: DbTx, keys: string[], now: Date, throttle: Throttle) {
    const forgetBefore = new Date(now.getTime() - throttle.forgetAfterSeconds * 1000);
    // The last key is the account alone; a pair key comes first when there is an address.
    for (const [index, key] of keys.entries()) {
      const free =
        index === keys.length - 1 ? throttle.freeAttemptsPerAccount : throttle.freeAttempts;
      const [row] = await tx
        .insert(loginThrottle)
        .values({ keyHash: key, failures: 1, lastFailureAt: now })
        .onConflictDoUpdate({
          target: loginThrottle.keyHash,
          set: {
            // A counter that has not been touched for a while starts again; the count is capped so it never overflows.
            failures: sql`case when ${loginThrottle.lastFailureAt} < ${forgetBefore} then 1 else least(${loginThrottle.failures} + 1, 100000) end`,
            lastFailureAt: now,
            blockedUntil: sql`case when ${loginThrottle.lastFailureAt} < ${forgetBefore} then null else ${loginThrottle.blockedUntil} end`,
          },
        })
        .returning({ failures: loginThrottle.failures });
      const seconds = delaySeconds(row!.failures, free, throttle);
      if (seconds > 0) {
        await tx
          .update(loginThrottle)
          .set({ blockedUntil: new Date(now.getTime() + seconds * 1000) })
          .where(eq(loginThrottle.keyHash, key));
      }
    }
  }

  return {
    assertOpen,

    async recordFailure(username, address, now = new Date(), tx, counted) {
      const { loginThrottle: throttle } = await deps.settings.get();
      const keys = throttleKeys(username, address);
      const write = async (inside: DbTx) => {
        await count(inside, keys, now, throttle);
        if (counted) await countForAudit(inside, username, counted.userId, now, throttle);
      };
      if (tx) return write(tx);
      await ctx.db.tx(write);
    },

    async reset(tx, username, address) {
      await tx
        .delete(loginThrottle)
        .where(inArray(loginThrottle.keyHash, throttleKeys(username, address)));
    },
  };
}
