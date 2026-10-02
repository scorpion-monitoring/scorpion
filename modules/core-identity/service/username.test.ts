import { describe, expect, it } from 'vitest';
import { username } from '../validation.ts';
import { cleanUsername, usernameBase, usernameCandidates } from './username.ts';

describe('cleanUsername', () => {
  it.each([
    ['Alice', 'alice'],
    ['  Alice Smith ', 'alice-smith'],
    ['José Müller', 'jose-muller'],
    ['a.b+c@d', 'a-b-c-d'],
    ['--x--y--', 'x-y'],
    ['_under_', 'under'],
    ['日本語', ''],
    ['', ''],
    ['a__b', 'a__b'],
    ['UPPER_case-1', 'upper_case-1'],
  ])('%j → %j', (raw, expected) => {
    expect(cleanUsername(raw)).toBe(expected);
  });
});

describe('usernameBase', () => {
  it.each([
    [
      'the preferred username first',
      { preferredUsername: 'Mary.Jones', email: 'x@y.org' },
      'mary-jones',
    ],
    ['the address when there is no username', { email: 'Bob.Builder@example.org' }, 'bob-builder'],
    [
      'the address when the username cleans to nothing',
      { preferredUsername: '日本', email: 'kim@x.org' },
      'kim',
    ],
    ['a fallback when there is nothing', {}, 'user'],
    ['a fallback when nothing usable is left', { preferredUsername: '!!!' }, 'user'],
    ['padding for a short name', { preferredUsername: 'al' }, 'al-user'],
    ['a cut for a long name', { preferredUsername: 'x'.repeat(100) }, 'x'.repeat(31)],
  ])('uses %s', (_name, claims, expected) => {
    expect(usernameBase(claims)).toBe(expected);
  });

  it('always yields a name the rules accept', () => {
    for (const raw of ['a', 'ab', '--', 'x'.repeat(500), 'Ünï-cödé', '__a__', '9']) {
      expect(username.safeParse(usernameBase({ preferredUsername: raw })).success).toBe(true);
    }
  });
});

describe('usernameCandidates', () => {
  it('starts with the base and then adds a longer hash of the identity each time', () => {
    const names = usernameCandidates('alice', 'corp', 'sub-1');
    expect(names).toHaveLength(4);
    expect(names[0]).toBe('alice');
    expect(names[1]).toMatch(/^alice-[0-9a-f]{4}$/);
    expect(names[2]).toMatch(/^alice-[0-9a-f]{8}$/);
    expect(names[3]).toMatch(/^alice-[0-9a-f]{12}$/);
    expect(names[2]!.startsWith(names[1]!)).toBe(true);
  });

  it('is stable for one identity and differs between identities and providers', () => {
    expect(usernameCandidates('a-b', 'p', 's')).toEqual(usernameCandidates('a-b', 'p', 's'));
    expect(usernameCandidates('a-b', 'p', 's')[1]).not.toBe(usernameCandidates('a-b', 'p', 't')[1]);
    expect(usernameCandidates('a-b', 'p', 's')[1]).not.toBe(usernameCandidates('a-b', 'q', 's')[1]);
  });

  it('keeps every candidate inside the length rule, even for the longest base', () => {
    for (const name of usernameCandidates('x'.repeat(31), 'p', 's')) {
      expect(username.safeParse(name).success).toBe(true);
    }
    for (const name of usernameCandidates('a-', 'p', 's').slice(1)) {
      expect(name).not.toContain('--');
      expect(username.safeParse(name).success).toBe(true);
    }
  });
});
