import { describe, expect, it } from 'vitest';
import { escapeLike, slugCandidate, slugFromName, SLUG_PATTERN } from './text.ts';

describe('slugFromName', () => {
  it.each([
    ['Page views', 'page-views'],
    ['  Unique   users!! ', 'unique-users'],
    ['Größe der Datenbank', 'grosse-der-datenbank'],
    ['Café été', 'cafe-ete'],
    ['100% / 50_%', '100-50'],
    ['A.B-C', 'a-b-c'],
    ['***', 'fallback'],
    ['', 'fallback'],
    ['日本語', 'fallback'],
  ])('%j → %j', (name, slug) => {
    expect(slugFromName(name, 'fallback')).toBe(slug);
  });

  it('is at most 64 characters, never ends in a dash and always matches the slug rule', () => {
    const slug = slugFromName(`${'word '.repeat(40)}end`, 'x');
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
    expect(SLUG_PATTERN.test(slug)).toBe(true);
  });
});

describe('slugCandidate', () => {
  it('numbers from the second attempt and stays within 64 characters', () => {
    expect(slugCandidate('a', 1)).toBe('a');
    expect(slugCandidate('a', 2)).toBe('a-2');
    const long = slugCandidate('b'.repeat(64), 12);
    expect(long).toHaveLength(64);
    expect(long.endsWith('-12')).toBe(true);
  });
});

describe('escapeLike', () => {
  it('escapes the three special characters', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});
