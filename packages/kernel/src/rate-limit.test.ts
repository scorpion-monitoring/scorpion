import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useKernels } from '../test/helpers.ts';
import { createRateLimiter } from './rate-limit.ts';

const kernels = useKernels();

async function limiter(options?: Parameters<typeof createRateLimiter>[1]) {
  const kernel = await kernels.inline([]);
  await kernel.migrate();
  return { kernel, limiter: createRateLimiter(kernel.db, { pruneProbability: 0, ...options }) };
}

const SLOW = { capacity: 3, refillPerSecond: 0.001 };

describe('the rate limiter store', () => {
  it('lets a burst of `capacity` through, then denies with a Retry-After', async () => {
    const { limiter: rate } = await limiter();
    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(await rate.consume('k', SLOW));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
    expect(decisions[3]!.retryAfterSeconds).toBe(1000); // 1 token at 0.001 per second
    expect(decisions[0]!.retryAfterSeconds).toBe(0);
  });

  it('keeps a bucket per key', async () => {
    const { limiter: rate } = await limiter();
    const one = { capacity: 1, refillPerSecond: 0.001 };
    expect((await rate.consume('a', one)).allowed).toBe(true);
    expect((await rate.consume('a', one)).allowed).toBe(false);
    expect((await rate.consume('b', one)).allowed).toBe(true);
  });

  it('refills with time and never above capacity', async () => {
    const { kernel, limiter: rate } = await limiter();
    const limit = { capacity: 2, refillPerSecond: 1 };
    await rate.consume('k', limit);
    await rate.consume('k', limit);
    expect((await rate.consume('k', limit)).allowed).toBe(false);
    await kernel.db.execute(
      sql`update kernel_rate_bucket set updated_at = now() - interval '1 hour' where key = 'k'`,
    );
    const afterAnHour = await rate.consume('k', limit);
    expect(afterAnHour).toMatchObject({ allowed: true, remaining: 1 }); // 2 (capped), minus 1
  });

  it('does not take a token for a denied request', async () => {
    const { kernel, limiter: rate } = await limiter();
    const one = { capacity: 1, refillPerSecond: 0.001 };
    await rate.consume('k', one);
    await rate.consume('k', one);
    await rate.consume('k', one);
    const { rows } = await kernel.db.execute<{ tokens: number }>(
      sql`select tokens from kernel_rate_bucket where key = 'k'`,
    );
    expect(rows[0]!.tokens).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.tokens).toBeLessThan(1);
  });

  it('gives the last token to one of two parallel requests, never to both', async () => {
    const { limiter: rate } = await limiter();
    const one = { capacity: 1, refillPerSecond: 0.001 };
    for (let round = 0; round < 20; round++) {
      const key = `race-${round}`;
      const results = await Promise.all([rate.consume(key, one), rate.consume(key, one)]);
      expect(results.filter((r) => r.allowed)).toHaveLength(1);
    }
  });

  it('admits exactly `capacity` of many parallel requests', async () => {
    const { limiter: rate } = await limiter();
    const results = await Promise.all(Array.from({ length: 12 }, () => rate.consume('k', SLOW)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it('prunes buckets idle for a day, and only those', async () => {
    const { kernel, limiter: rate } = await limiter();
    await rate.consume('old', SLOW);
    await rate.consume('new', SLOW);
    await kernel.db.execute(
      sql`update kernel_rate_bucket set updated_at = now() - interval '2 days' where key = 'old'`,
    );
    expect(await rate.prune()).toBe(1);
    const { rows } = await kernel.db.execute<{ key: string }>(
      sql`select key from kernel_rate_bucket`,
    );
    expect(rows.map((r) => r.key)).toEqual(['new']);
  });

  it('prunes on its own now and then', async () => {
    const { kernel, limiter: rate } = await limiter({ pruneProbability: 1 });
    await rate.consume('old', SLOW);
    await kernel.db.execute(
      sql`update kernel_rate_bucket set updated_at = now() - interval '2 days'`,
    );
    await rate.consume('new', SLOW);
    const { rows } = await kernel.db.execute<{ key: string }>(
      sql`select key from kernel_rate_bucket`,
    );
    expect(rows.map((r) => r.key)).toEqual(['new']);
  });
});
