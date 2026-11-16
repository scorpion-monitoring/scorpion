// The visit cache behind `remember`: one answer per visitor and key for a few minutes, never shared between visitors, never kept
// when the load fails, bounded in size.
import { describe, expect, it } from 'vitest';
import { createVisitCache } from './visit-cache.ts';

function counter() {
  let calls = 0;
  return { load: () => Promise.resolve(++calls), calls: () => calls };
}

describe('the visit cache', () => {
  it('loads once for a visitor and a key, and again after the time is up', async () => {
    let now = 0;
    const cache = createVisitCache({ ttlMs: 1000, now: () => now });
    const remember = cache.forVisitor('cookie-a');
    const c = counter();
    expect(await remember('k', c.load)).toBe(1);
    expect(await remember('k', c.load)).toBe(1);
    now = 999;
    expect(await remember('k', c.load)).toBe(1);
    now = 1000;
    expect(await remember('k', c.load)).toBe(2);
    expect(c.calls()).toBe(2);
  });

  it('keeps visitors and keys apart', async () => {
    const cache = createVisitCache();
    const c = counter();
    expect(await cache.forVisitor('cookie-a')('k', c.load)).toBe(1);
    expect(await cache.forVisitor('cookie-b')('k', c.load)).toBe(2);
    expect(await cache.forVisitor('cookie-a')('other', c.load)).toBe(3);
    expect(await cache.forVisitor('cookie-a')('k', c.load)).toBe(1);
  });

  it('keeps nothing for a request without a cookie', async () => {
    const cache = createVisitCache();
    const c = counter();
    await cache.forVisitor(undefined)('k', c.load);
    await cache.forVisitor(undefined)('k', c.load);
    expect(c.calls()).toBe(2);
    expect(cache.size).toBe(0);
  });

  it('asks once when two loads arrive together, and does not keep a failure', async () => {
    const cache = createVisitCache();
    const remember = cache.forVisitor('cookie-a');
    let calls = 0;
    let release!: (value: number) => void;
    const slow = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        release = resolve;
      });
    const both = Promise.all([remember('k', slow), remember('k', slow)]);
    release(7);
    expect(await both).toEqual([7, 7]);
    expect(calls).toBe(1);

    const failing = () => Promise.reject(new Error('down'));
    await expect(remember('bad', failing)).rejects.toThrow('down');
    await Promise.resolve();
    expect(await remember('bad', () => Promise.resolve('back'))).toBe('back');
  });

  it('is bounded: the oldest entries go first', async () => {
    const cache = createVisitCache({ maxEntries: 3 });
    for (let i = 0; i < 10; i++)
      await cache.forVisitor(`cookie-${i}`)('k', () => Promise.resolve(i));
    expect(cache.size).toBeLessThanOrEqual(3);
    const c = counter();
    await cache.forVisitor('cookie-0')('k', c.load);
    expect(c.calls()).toBe(1); // evicted, so loaded again
  });
});
