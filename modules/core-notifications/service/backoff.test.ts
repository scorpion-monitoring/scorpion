import { describe, expect, it } from 'vitest';
import { backoffSeconds } from './backoff.ts';

describe('backoffSeconds', () => {
  const cases: [number, number][] = [
    [1, 30],
    [2, 60],
    [3, 120],
    [4, 240],
    [5, 480],
    [6, 960],
    [7, 1920],
    [8, 3600], // 3840 capped at one hour
    [9, 3600],
    [50, 3600],
    [1e9, 3600],
    [0, 30], // a bad input behaves like the first attempt
    [-3, 30],
    [2.9, 60],
  ];
  it.each(cases)('after attempt %s wait %s s', (attempt, seconds) => {
    expect(backoffSeconds(attempt)).toBe(seconds);
  });

  it('never decreases and never exceeds an hour', () => {
    let previous = 0;
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const wait = backoffSeconds(attempt);
      expect(wait).toBeGreaterThanOrEqual(previous);
      expect(wait).toBeLessThanOrEqual(3600);
      previous = wait;
    }
  });
});
