// The rate limiter's store: Postgres-backed token buckets. The server's pipeline (step 2) decides
// which keys to charge and what the limits are; this file only keeps the buckets.
import { sql } from 'drizzle-orm';
import type { Db } from './db.ts';

export interface RateLimit {
  /** Most tokens a bucket holds, which is also the size of a burst. */
  capacity: number;
  /** Tokens that come back per second. */
  refillPerSecond: number;
}

export interface RateDecision {
  allowed: boolean;
  /** Whole tokens left after this request. */
  remaining: number;
  /** When denied: seconds until a token is available again (at least 1). 0 when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Takes one token from the bucket `key`, creating the bucket full if it does not exist. */
  consume(key: string, limit: RateLimit): Promise<RateDecision>;
  /** Deletes buckets idle for a day (they are full again anyway). Returns how many. */
  prune(): Promise<number>;
}

export interface RateLimiterOptions {
  /** Chance per `consume()` that it also prunes. Default 1 %. */
  pruneProbability?: number;
}

/**
 * One statement does the whole job (refill, decide, take), and the row lock of `ON CONFLICT DO
 * UPDATE` serialises requests on the same key: of two parallel requests for the last token, one
 * is denied. The clock is the database's, so several server processes agree.
 */
export function createRateLimiter(db: Db, options: RateLimiterOptions = {}): RateLimiter {
  const pruneProbability = options.pruneProbability ?? 0.01;

  async function prune(): Promise<number> {
    const result = await db.execute(
      sql`delete from kernel_rate_bucket where updated_at < now() - interval '1 day'`,
    );
    return result.rowCount ?? 0;
  }

  return {
    prune,
    async consume(key, { capacity, refillPerSecond }) {
      // The bucket as it is now: what was left, plus what has come back since, up to capacity.
      const refilled = sql`least(${capacity}::float8, b.tokens + extract(epoch from (now() - b.updated_at)) * ${refillPerSecond}::float8)`;
      const { rows } = await db.execute<{ tokens: number; allowed: boolean }>(sql`
        insert into kernel_rate_bucket as b (key, tokens, allowed, updated_at)
        values (${key}, greatest(${capacity}::float8 - 1, 0), ${capacity >= 1}, now())
        on conflict (key) do update set
          tokens = case when ${refilled} >= 1 then ${refilled} - 1 else ${refilled} end,
          allowed = ${refilled} >= 1,
          updated_at = now()
        returning tokens, allowed`);
      const row = rows[0]!;
      if (Math.random() < pruneProbability) await prune();
      return {
        allowed: row.allowed,
        remaining: Math.floor(row.tokens),
        retryAfterSeconds: row.allowed
          ? 0
          : Math.max(1, Math.ceil((1 - row.tokens) / refillPerSecond)),
      };
    },
  };
}
