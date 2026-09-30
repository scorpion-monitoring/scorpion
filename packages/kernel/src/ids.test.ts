import { describe, expect, it } from 'vitest';
import { ids } from './ids.ts';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ids.uuidv7', () => {
  it('has the version and variant bits of a UUIDv7', () => {
    for (let i = 0; i < 200; i++) expect(ids.uuidv7()).toMatch(UUID_V7);
  });

  it('carries the timestamp in the first 48 bits', () => {
    const before = Date.now();
    const id = ids.uuidv7();
    const timestamp = parseInt(id.replaceAll('-', '').slice(0, 12), 16);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now() + 1);
  });

  it('sorts in creation order, also within one millisecond', () => {
    const created = Array.from({ length: 20_000 }, () => ids.uuidv7());
    expect([...created].sort()).toEqual(created);
  });

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 20_000 }, () => ids.uuidv7())).size).toBe(20_000);
  });

  it('keeps counting when the clock stands still or goes back', () => {
    const now = Date.now() + 10_000;
    const first = ids.uuidv7(now);
    const second = ids.uuidv7(now - 5);
    expect(second > first).toBe(true);
  });
});
