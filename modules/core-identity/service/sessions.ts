// Sessions: opaque 256-bit ids, stored as SHA-256 hashes, checked against the database (defect 4).
//
// A session has two ends (ADR 0025): `expiresAt` slides with use (inactivity), `absoluteExpiresAt` is
// fixed when the session is created and never moves. It also remembers when the person last proved
// who they are (`authenticatedAt`), which `requireRecentAuth` checks before a sensitive change.
//
// A small in-process cache sits in front of the lookup so that a page of API calls is not a page of
// queries. It is keyed by the hash, lives for `SESSION_CACHE_TTL_MS`, and is emptied for the
// affected sessions on logout, "log out everywhere", ending a session from the list and the
// administrators' termination, in this process. Another process learns of a revocation (and of the
// absolute end) when its cache entry expires, so with several server processes a revoked session
// can still be accepted by another process for at most that long. That is the bound.
import { and, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { isUser, ReauthenticationRequired, Unauthorized, type Actor } from '@scorpion/contracts';
import { ids, type DbTx, type ModuleContext } from '@scorpion/kernel';
import { session, user } from '../db/schema.ts';
import { hashSessionId, isSessionIdFormat, newSessionId } from './session-id.ts';
import type { IdentitySettings } from './settings.ts';

/** How long one process trusts a session it has verified. The staleness bound across processes. */
export const SESSION_CACHE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 10_000;
const DAY_MS = 24 * 3600 * 1000;
/** The default inactivity period: a session ends this long after its last use (the setting `sessions.inactivityDays`). */
export const SESSION_LIFETIME_MS = 7 * DAY_MS;
/** The expiry is pushed forward at most this often, so a busy session is not a write per request. */
const SLIDE_AFTER_MS = 60_000;

export interface SessionInfo {
  userId: string;
  username: string;
  /** The id of the session row (not the cookie value). */
  sessionId: string;
}

export interface ResolvedSession extends SessionInfo {
  /** True when the expiry moved forward on this lookup: the cookie should be sent again. */
  renewed: boolean;
  /** The new end of inactivity, set when `renewed`. */
  expiresAt?: Date;
}

export interface CreatedSession {
  /** The value for the cookie. Shown once; only its hash is stored. */
  id: string;
  /** The id of the session row. */
  sessionId: string;
  expiresAt: Date;
}

/** What a person sees of one of their sessions: no secret, no hash, and nothing about a device. */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  current: boolean;
}

export interface SessionService {
  /** Starts a session for a user. Pass the transaction to make it part of the caller's. */
  create(userId: string, tx?: Pick<DbTx, 'insert'>, now?: Date): Promise<CreatedSession>;
  /**
   * The session behind a cookie value, or `undefined` when it is unknown, malformed, expired,
   * revoked, or its user is no longer active. `touch: false` is a check that is not activity (the
   * re-check of an open event stream): it moves no inactivity end and writes nothing.
   */
  resolve(
    id: string,
    now?: Date,
    options?: { touch?: boolean },
  ): Promise<ResolvedSession | undefined>;
  /** Revokes one session; unknown ids are ignored. */
  revoke(id: string): Promise<void>;
  /**
   * Revokes every session of a user ("log out everywhere"); returns how many were open. Pass the
   * caller's transaction to make it part of that write, and call it again after the commit: this
   * process's cache is emptied then, not while a concurrent request could still refill it.
   */
  revokeAll(userId: string, tx?: Pick<DbTx, 'update'>): Promise<number>;
  /**
   * Revokes every open session of every user except `exceptSessionId`; returns how many were open.
   * The same rules for the transaction and the cache as `revokeAll`.
   */
  revokeEveryone(exceptSessionId?: string, tx?: Pick<DbTx, 'update'>): Promise<number>;
  /** The user's live sessions, newest first (then by id); `currentSessionId` is flagged. */
  list(
    userId: string,
    page: { page: number; pageSize: number },
    currentSessionId?: string,
    now?: Date,
  ): Promise<{ sessions: SessionSummary[]; total: number }>;
  /**
   * Revokes one live session of this user by its row id. `false` when there is no such session of
   * theirs (unknown, somebody else's, over, or already revoked): the answers are the same.
   */
  revokeOwn(
    userId: string,
    sessionId: string,
    tx?: Pick<DbTx, 'update'>,
    now?: Date,
  ): Promise<boolean>;
  /**
   * Records that the user has just proved who they are in this session. `false` when the session
   * is not a live session of this user.
   */
  markAuthenticated(
    userId: string,
    sessionId: string,
    tx?: Pick<DbTx, 'update'>,
    now?: Date,
  ): Promise<boolean>;
  /**
   * Resolves when the caller's session was authenticated within `maxAgeSeconds` (default: the
   * setting `sessions.recentAuthSeconds`). Throws `ReauthenticationRequired` (401,
   * `reauthentication-required`) when it was not, and `Unauthorized` when the session is gone.
   * Only a session is asked: a personal access token is a credential the person created on
   * purpose and is not subject to it (ADR 0025).
   */
  requireRecentAuth(actor: Actor, maxAgeSeconds?: number, now?: Date): Promise<void>;
}

interface CacheEntry extends SessionInfo {
  checkedAt: number;
}

export function createSessionService(
  ctx: ModuleContext,
  deps: { settings: IdentitySettings },
  options: { cacheTtlMs?: number; now?: () => number } = {},
): SessionService {
  const { settings } = deps;
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

  /** Forgets the entries `matches` names. Done before the write and again after it. */
  const drop = (matches: (entry: CacheEntry) => boolean) => {
    generation++;
    for (const [hash, entry] of cache) if (matches(entry)) cache.delete(hash);
  };

  /** A session that is not over, by either end and by revocation. */
  const live = (now: Date) =>
    and(isNull(session.revokedAt), gt(session.expiresAt, now), gt(session.absoluteExpiresAt, now));

  return {
    async create(userId, tx: Pick<DbTx, 'insert'> = ctx.db, now = new Date()) {
      const { sessions } = await settings.get();
      const id = newSessionId();
      const sessionId = ids.uuidv7();
      const absoluteExpiresAt = new Date(now.getTime() + sessions.absoluteDays * DAY_MS);
      const expiresAt = new Date(
        Math.min(now.getTime() + sessions.inactivityDays * DAY_MS, absoluteExpiresAt.getTime()),
      );
      await tx.insert(session).values({
        id: sessionId,
        userId,
        secretHash: hashSessionId(id),
        createdAt: now,
        lastSeenAt: now,
        authenticatedAt: now,
        expiresAt,
        absoluteExpiresAt,
      });
      return { id, sessionId, expiresAt };
    },

    async resolve(id, now = new Date(), { touch = true } = {}) {
      if (!isSessionIdFormat(id)) return undefined;
      const hash = hashSessionId(id);

      const cached = cache.get(hash);
      if (cached && clock() - cached.checkedAt < ttl) {
        return {
          userId: cached.userId,
          username: cached.username,
          sessionId: cached.sessionId,
          renewed: false,
        };
      }
      cache.delete(hash);

      const seen = generation;
      const [row] = await ctx.db
        .select({
          sessionId: session.id,
          userId: user.id,
          username: user.username,
          lastSeenAt: session.lastSeenAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
        })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(
          and(
            eq(session.secretHash, hash),
            live(now),
            eq(user.status, 'active'),
            isNull(user.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return undefined;

      let renewed = false;
      let expiresAt: Date | undefined;
      if (touch && now.getTime() - row.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
        // The inactivity end moves, but never past the absolute end (ADR 0025).
        const { sessions } = await settings.get();
        expiresAt = new Date(
          Math.min(
            now.getTime() + sessions.inactivityDays * DAY_MS,
            row.absoluteExpiresAt.getTime(),
          ),
        );
        // The same guard as the lookup: a revocation that landed in between is not undone.
        const updated = await ctx.db
          .update(session)
          .set({ lastSeenAt: now, expiresAt })
          .where(and(eq(session.id, row.sessionId), isNull(session.revokedAt)))
          .returning({ id: session.id });
        if (updated.length === 0) return undefined;
        renewed = true;
      }

      const info = { userId: row.userId, username: row.username, sessionId: row.sessionId };
      if (generation === seen) remember(hash, info);
      return { ...info, renewed, ...(renewed ? { expiresAt } : {}) };
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

    async revokeAll(userId, tx: Pick<DbTx, 'update'> = ctx.db) {
      const mine = (entry: CacheEntry) => entry.userId === userId;
      drop(mine);
      const revoked = await tx
        .update(session)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(session.userId, userId), isNull(session.revokedAt)))
        .returning({ id: session.id });
      drop(mine);
      return revoked.length;
    },

    async revokeEveryone(exceptSessionId, tx: Pick<DbTx, 'update'> = ctx.db) {
      const others = (entry: CacheEntry) => entry.sessionId !== exceptSessionId;
      drop(others);
      const revoked = await tx
        .update(session)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            isNull(session.revokedAt),
            exceptSessionId === undefined ? undefined : ne(session.id, exceptSessionId),
          ),
        )
        .returning({ id: session.id });
      drop(others);
      return revoked.length;
    },

    async list(userId, { page, pageSize }, currentSessionId, now = new Date()) {
      const mine = and(eq(session.userId, userId), live(now));
      const rows = await ctx.db
        .select({
          id: session.id,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
        })
        .from(session)
        .where(mine)
        .orderBy(desc(session.createdAt), desc(session.id))
        .limit(pageSize)
        .offset(page * pageSize);
      const [total] = await ctx.db.select({ value: count() }).from(session).where(mine);
      return {
        sessions: rows.map((row) => ({ ...row, current: row.id === currentSessionId })),
        total: total?.value ?? 0,
      };
    },

    async revokeOwn(userId, sessionId, tx: Pick<DbTx, 'update'> = ctx.db, now = new Date()) {
      const one = (entry: CacheEntry) => entry.sessionId === sessionId;
      drop(one);
      const revoked = await tx
        .update(session)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(session.id, sessionId), eq(session.userId, userId), live(now)))
        .returning({ id: session.id });
      drop(one);
      return revoked.length > 0;
    },

    async markAuthenticated(
      userId,
      sessionId,
      tx: Pick<DbTx, 'update'> = ctx.db,
      now = new Date(),
    ) {
      const updated = await tx
        .update(session)
        .set({ authenticatedAt: now })
        .where(and(eq(session.id, sessionId), eq(session.userId, userId), live(now)))
        .returning({ id: session.id });
      return updated.length > 0;
    },

    async requireRecentAuth(actor, maxAgeSeconds, now = new Date()) {
      if (!isUser(actor)) throw new Unauthorized();
      if (actor.via !== 'session') return;
      if (actor.sessionId === undefined)
        throw new Unauthorized('The session is not valid. Sign in again.');
      const [row] = await ctx.db
        .select({ authenticatedAt: session.authenticatedAt })
        .from(session)
        .where(and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId), live(now)))
        .limit(1);
      if (!row) throw new Unauthorized('The session is not valid. Sign in again.');
      const window = maxAgeSeconds ?? (await settings.get()).sessions.recentAuthSeconds;
      if (now.getTime() - row.authenticatedAt.getTime() > window * 1000) {
        throw new ReauthenticationRequired();
      }
    },
  };
}
