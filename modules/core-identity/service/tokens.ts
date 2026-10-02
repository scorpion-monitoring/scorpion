// Personal access tokens: create, list, revoke, rotate, and the check the authenticator makes.
//
// A token is `scp_<prefix>_<secret>`. The prefix finds the row, the secret is checked against its
// argon2id hash, and the secret is shown to the owner once. Managing tokens needs a signed-in
// session, not another token: a stolen token must not be able to mint a longer-lived one.
//
// Verifying is expensive on purpose (argon2id), so a small in-process cache sits in front of it:
// a verified token is trusted for `TOKEN_CACHE_TTL_MS`, keyed by a hash of the whole token.
// Revoking and rotating drop the entries of this process at once; another process learns of it
// when its entry expires, so with several server processes a revoked token can still be accepted
// there for at most that long (the same bound as a session, ADR 0007). Wrong tokens are never
// cached, and a malformed one is refused before any hashing.
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { Conflict, Forbidden, Invalid, NotFound, type Actor } from '@scorpion/contracts';
import type { ModuleContext } from '@scorpion/kernel';
import { ids } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { token, user } from '../db/schema.ts';
import { createTokenInput, rotateTokenInput } from '../validation.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { requireUser } from './require-user.ts';
import { cacheKey, generateToken, parseToken } from './token-format.ts';

/** How long one process trusts a token it has verified. The staleness bound across processes. */
export const TOKEN_CACHE_TTL_MS = 5_000;
const CACHE_MAX_ENTRIES = 10_000;
/** `last_used_at` is written at most this often per token. */
const TOUCH_AFTER_MS = 60_000;
/** A user may hold this many tokens that are not revoked. */
export const TOKENS_PER_USER = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A token as the owner sees it. Never the secret or the hash. */
export interface TokenInfo {
  id: string;
  name: string;
  /** Not secret: it is what the owner recognises a token by. */
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreatedToken extends TokenInfo {
  /** The whole `scp_<prefix>_<secret>`. Shown once; only a hash of the secret is kept. */
  token: string;
}

/** Who a good token belongs to. */
export interface VerifiedToken {
  tokenId: string;
  userId: string;
  username: string;
  scopes: readonly string[];
}

/** What the authenticator needs. */
export interface TokenAuthenticator {
  /** `undefined` for anything that is not a good token of an active user: malformed, unknown, wrong, expired, revoked. */
  authenticate(presented: string, now?: Date): Promise<VerifiedToken | undefined>;
}

export interface TokenService extends TokenAuthenticator {
  /** 422 for bad input, 409 for a taken name or too many tokens, 403 unless the caller has a session. */
  create(actor: Actor, input: unknown): Promise<CreatedToken>;
  list(
    actor: Actor,
    page: { page: number; pageSize: number },
  ): Promise<{ tokens: TokenInfo[]; total: number }>;
  /** Revokes one of the caller's tokens. 404 for an unknown id and for someone else's, with the same answer. */
  revoke(actor: Actor, id: string): Promise<void>;
  /** Replaces a token by a new one with the same name and scopes; the old one stops working at once. */
  rotate(actor: Actor, id: string, input: unknown): Promise<CreatedToken>;
  /** Resolves when the `last_used_at` writes started so far are done (for tests). */
  idle(): Promise<void>;
}

interface CacheEntry extends VerifiedToken {
  checkedAt: number;
  expiresAt: Date | null;
}

const noSuchToken = () => new NotFound('There is no such token.');

function invalid(error: ZodError): Invalid {
  return new Invalid(
    'The request is not valid.',
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** The unique index a Postgres 23505 error names, or `undefined` for any other error. */
function violatedIndex(error: unknown): string | undefined {
  const find = (e: unknown): string | undefined => {
    const { code, constraint } = (e ?? {}) as { code?: unknown; constraint?: unknown };
    return code === '23505' && typeof constraint === 'string' ? constraint : undefined;
  };
  return find(error) ?? find((error as { cause?: unknown } | null)?.cause);
}

const toInfo = (row: {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): TokenInfo => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: row.scopes,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt,
  createdAt: row.createdAt,
});

const infoColumns = {
  id: token.id,
  name: token.name,
  prefix: token.prefix,
  scopes: token.scopes,
  expiresAt: token.expiresAt,
  lastUsedAt: token.lastUsedAt,
  createdAt: token.createdAt,
};

/** Management needs a session: a token must not be able to create or change tokens. */
function requireSession(actor: Actor) {
  const user = requireUser(actor);
  if (user.via !== 'session') {
    throw new Forbidden('Access tokens can only be managed with a signed-in session.');
  }
  return user;
}

export function createTokenService(
  ctx: ModuleContext,
  options: { cacheTtlMs?: number; now?: () => number } = {},
): TokenService {
  const ttl = options.cacheTtlMs ?? TOKEN_CACHE_TTL_MS;
  const clock = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  /** Bumped by every invalidation; a lookup that raced with one does not cache its result. */
  let generation = 0;
  const pending = new Set<Promise<void>>();

  // Something to verify when there is no row, so that "unknown prefix" costs as much as "wrong secret".
  let decoyHash: Promise<string> | undefined;
  const decoy = () => (decoyHash ??= hashPassword('scorpion decoy: nobody has this secret'));

  const forget = (tokenId: string) => {
    generation++;
    for (const [key, entry] of cache) if (entry.tokenId === tokenId) cache.delete(key);
  };

  /** Records the use without making the request wait, and without failing it if the write fails. */
  function touch(tokenId: string, now: Date) {
    const write = Promise.resolve(
      ctx.db.update(token).set({ lastUsedAt: now }).where(eq(token.id, tokenId)),
    ).then(
      () => undefined,
      (err: unknown) => ctx.log.warn({ err }, 'could not record the last use of an access token'),
    );
    pending.add(write);
    void write.finally(() => pending.delete(write));
  }

  /** A token and the hash of its secret. Hashing is slow, so it happens before a transaction opens. */
  async function prepare() {
    const fresh = generateToken();
    return { fresh, hash: await hashPassword(fresh.secret) };
  }

  /** Inserts inside the caller's transaction (in a savepoint, so a clash does not poison it). */
  async function insertToken(
    values: { userId: string; name: string; scopes: string[]; expiresAt: Date | null },
    first: Awaited<ReturnType<typeof prepare>>,
  ): Promise<CreatedToken> {
    let candidate = first;
    // The prefix is 47 bits, so a clash is rare, but it is a unique index and not a hope.
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await ctx.db.tx((tx) =>
          tx
            .insert(token)
            .values({
              id: ids.uuidv7(),
              ...values,
              prefix: candidate.fresh.prefix,
              secretHash: candidate.hash,
            })
            .returning(infoColumns),
        );
        return { ...toInfo(row!), token: candidate.fresh.token };
      } catch (error) {
        const index = violatedIndex(error);
        if (index === 'identity_token_user_name_uidx') {
          throw new Conflict('You already have a token with this name.');
        }
        if (index === 'identity_token_prefix_uidx' && attempt < 4) {
          candidate = await prepare();
          continue;
        }
        throw error;
      }
    }
  }

  return {
    async authenticate(presented, now = new Date()) {
      const parsed = parseToken(presented);
      if (!parsed) return undefined;
      const key = cacheKey(presented);

      const cached = cache.get(key);
      if (cached && clock() - cached.checkedAt < ttl) {
        if (cached.expiresAt && cached.expiresAt <= now) return undefined;
        const { tokenId, userId, username, scopes } = cached;
        return { tokenId, userId, username, scopes };
      }
      cache.delete(key);

      const seen = generation;
      const [row] = await ctx.db
        .select({
          id: token.id,
          secretHash: token.secretHash,
          scopes: token.scopes,
          expiresAt: token.expiresAt,
          lastUsedAt: token.lastUsedAt,
          revokedAt: token.revokedAt,
          userId: user.id,
          username: user.username,
          status: user.status,
          deletedAt: user.deletedAt,
        })
        .from(token)
        .innerJoin(user, eq(user.id, token.userId))
        .where(eq(token.prefix, parsed.prefix))
        .limit(1);

      // Always verify something, whether or not there is a row, and decide afterwards.
      const secretOk = await verifyPassword(row?.secretHash ?? (await decoy()), parsed.secret);
      if (!row || !secretOk) return undefined;
      if (row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= now)) {
        return undefined;
      }
      if (row.status !== 'active' || row.deletedAt !== null) return undefined;

      const verified: VerifiedToken = {
        tokenId: row.id,
        userId: row.userId,
        username: row.username,
        scopes: row.scopes,
      };
      if (generation === seen && ttl > 0) {
        cache.set(key, { ...verified, checkedAt: clock(), expiresAt: row.expiresAt });
        if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      }
      if (row.lastUsedAt === null || now.getTime() - row.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
        touch(row.id, now);
      }
      return verified;
    },

    async create(actor, input) {
      const { userId } = requireSession(actor);
      const parsed = createTokenInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { name, scopes, expiresAt } = parsed.data;
      if (expiresAt !== null && expiresAt.getTime() <= clock()) {
        throw new Invalid('The request is not valid.', [
          { path: 'expiresAt', message: 'must be in the future' },
        ]);
      }

      const first = await prepare();
      return ctx.db.tx(async (tx) => {
        const [live] = await tx
          .select({ value: count() })
          .from(token)
          .where(and(eq(token.userId, userId), isNull(token.revokedAt)));
        if ((live?.value ?? 0) >= TOKENS_PER_USER) {
          throw new Conflict(`You can have at most ${TOKENS_PER_USER} access tokens.`);
        }
        const created = await insertToken({ userId, name, scopes, expiresAt }, first);
        await ctx.events.emit('identity.token.created@1', {
          userId,
          tokenId: created.id,
          name: created.name,
        });
        return created;
      });
    },

    async list(actor, { page, pageSize }) {
      const { userId } = requireSession(actor);
      const mine = and(eq(token.userId, userId), isNull(token.revokedAt));
      const rows = await ctx.db
        .select(infoColumns)
        .from(token)
        .where(mine)
        .orderBy(asc(token.createdAt), asc(token.id))
        .limit(pageSize)
        .offset(page * pageSize);
      const [total] = await ctx.db.select({ value: count() }).from(token).where(mine);
      return { tokens: rows.map(toInfo), total: total?.value ?? 0 };
    },

    async revoke(actor, id) {
      const { userId } = requireSession(actor);
      if (!UUID.test(id)) throw noSuchToken();
      forget(id);
      try {
        await ctx.db.tx(async (tx) => {
          // Scoped to the owner: someone else's id changes nothing and is answered like an unknown one.
          const changed = await tx
            .update(token)
            .set({ revokedAt: sql`now()` })
            .where(and(eq(token.id, id), eq(token.userId, userId), isNull(token.revokedAt)))
            .returning({ name: token.name });
          if (changed.length === 0) {
            const [own] = await tx
              .select({ id: token.id })
              .from(token)
              .where(and(eq(token.id, id), eq(token.userId, userId)));
            if (!own) throw noSuchToken();
            return; // already revoked: nothing to do, nothing to report
          }
          await ctx.events.emit('identity.token.revoked@1', {
            userId,
            tokenId: id,
            name: changed[0]!.name,
          });
        });
      } finally {
        forget(id);
      }
    },

    async rotate(actor, id, input) {
      const { userId } = requireSession(actor);
      const parsed = rotateTokenInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      if (!UUID.test(id)) throw noSuchToken();
      const first = await prepare();
      forget(id);
      try {
        // Revoke the old token and create the new one under the same name in one transaction: if
        // the second part fails, the first is undone and the old token still works.
        return await ctx.db.tx(async (tx) => {
          const [old] = await tx
            .update(token)
            .set({ revokedAt: sql`now()` })
            .where(and(eq(token.id, id), eq(token.userId, userId), isNull(token.revokedAt)))
            .returning({ name: token.name, scopes: token.scopes, expiresAt: token.expiresAt });
          if (!old) throw noSuchToken();

          const expiresAt = parsed.data.expiresAt ?? old.expiresAt;
          if (expiresAt !== null && expiresAt.getTime() <= clock()) {
            throw new Invalid('The request is not valid.', [
              { path: 'expiresAt', message: 'must be in the future; send a new expiry' },
            ]);
          }
          const created = await insertToken(
            { userId, name: old.name, scopes: old.scopes, expiresAt },
            first,
          );
          await ctx.events.emit('identity.token.rotated@1', {
            userId,
            tokenId: created.id,
            previousTokenId: id,
            name: created.name,
          });
          return created;
        });
      } finally {
        forget(id);
      }
    },

    async idle() {
      await Promise.all([...pending]);
    },
  };
}
