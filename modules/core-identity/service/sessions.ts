// Sessions: opaque 256-bit ids, stored as SHA-256 hashes, checked against the database (defect 4).
//
// A small in-process cache sits in front of the lookup so that a page of API calls is not a page of
// queries. It is keyed by the hash, lives for `SESSION_CACHE_TTL_MS`, and is emptied for the
// affected session or user on logout and "log out everywhere" in this process. Another process
// learns of a revocation when its cache entry expires, so with several server processes a revoked
// session can still be accepted by another process for at most that long. That is the bound.
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { ids, type DbTx, type ModuleContext } from '@scorpion/kernel';
import { session, user } from '../db/schema.ts';
import { hashSessionId, isSessionIdFormat, newSessionId } from './session-id.ts';

/** How long one process trusts a session it has verified. The staleness bound across processes. */
export const SESSION_CACHE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 10_000;
/** A session lives this long after its last use (sliding). */
export const SESSION_LIFETIME_MS = 7 * 24 * 3600 * 1000;
/** The expiry is pushed forward at most this often, so a busy session is not a write per request. */
const SLIDE_AFTER_MS = 60_000;

export interface SessionInfo {
  userId: string;
  username: string;
}

export interface ResolvedSession extends SessionInfo {
  /** True when the expiry moved forward on this lookup: the cookie should be sent again. */
  renewed: boolean;
}

export interface CreatedSession {
  /** The value for the cookie. Shown once; only its hash is stored. */
  id: string;
  expiresAt: Date;
}

export interface SessionService {
  /** Starts a session for a user. Pass the transaction to make it part of the caller's. */
  create(userId: string, tx?: Pick<DbTx, 'insert'>, now?: Date): Promise<CreatedSession>;
  /**
   * The session behind a cookie value, or `undefined` when it is unknown, malformed, expired,
   * revoked, or its user is no longer active.
   */
  resolve(id: string, now?: Date): Promise<ResolvedSession | undefined>;
  /** Revokes one session; unknown ids are ignored. */
  revoke(id: string): Promise<void>;
  /** Revokes every session of a user ("log out everywhere"); returns how many were open. */
  revokeAll(userId: string): Promise<number>;
}

interface CacheEntry extends SessionInfo {
  checkedAt: number;
}

export function createSessionService(
  ctx: ModuleContext,
  options: { cacheTtlMs?: number; now?: () => number } = {},
): SessionService {
  const ttl = options.cacheTtlMs ?? SESSION_CACHE_TTL_MS;
  const clock = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  /** Bumped by every invalidation; a lookup that raced with one does not cache its result. */
  let generation = 0;

  const remember = (hash: string, info: SessionInfo) => {
    cache.delete(hash);
    cache.set(hash, { ...info, checkedAt: clock() });
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  };

  return {
    async create(userId, tx: Pick<DbTx, 'insert'> = ctx.db, now = new Date()) {
      const id = newSessionId();
      const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
      await tx.insert(session).values({
        id: ids.uuidv7(),
        userId,
        secretHash: hashSessionId(id),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      });
      return { id, expiresAt };
    },

    async resolve(id, now = new Date()) {
      if (!isSessionIdFormat(id)) return undefined;
      const hash = hashSessionId(id);

      const cached = cache.get(hash);
      if (cached && clock() - cached.checkedAt < ttl) {
        return { userId: cached.userId, username: cached.username, renewed: false };
      }
      cache.delete(hash);

      const seen = generation;
      const [row] = await ctx.db
        .select({
          sessionId: session.id,
          userId: user.id,
          username: user.username,
          lastSeenAt: session.lastSeenAt,
        })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(
          and(
            eq(session.secretHash, hash),
            isNull(session.revokedAt),
            gt(session.expiresAt, now),
            eq(user.status, 'active'),
            isNull(user.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return undefined;

      let renewed = false;
      if (now.getTime() - row.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
        // The same guard as the lookup: a revocation that landed in between is not undone.
        const updated = await ctx.db
          .update(session)
          .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS) })
          .where(and(eq(session.id, row.sessionId), isNull(session.revokedAt)))
          .returning({ id: session.id });
        if (updated.length === 0) return undefined;
        renewed = true;
      }

      const info = { userId: row.userId, username: row.username };
      if (generation === seen) remember(hash, info);
      return { ...info, renewed };
    },

    async revoke(id) {
      if (!isSessionIdFormat(id)) return;
      const hash = hashSessionId(id);
      generation++;
      cache.delete(hash);
      await ctx.db
        .update(session)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(session.secretHash, hash), isNull(session.revokedAt)));
      generation++;
      cache.delete(hash);
    },

    async revokeAll(userId) {
      const drop = () => {
        generation++;
        for (const [hash, entry] of cache) if (entry.userId === userId) cache.delete(hash);
      };
      drop();
      const revoked = await ctx.db
        .update(session)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(session.userId, userId), isNull(session.revokedAt)))
        .returning({ id: session.id });
      drop();
      return revoked.length;
    },
  };
}
