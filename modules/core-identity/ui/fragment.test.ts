import { describe, expect, it } from 'vitest';
import {
  dropToken,
  LINK_TOKEN_KEY,
  stashedToken,
  stashToken,
  tokenFromFragment,
} from './fragment.ts';

describe('tokenFromFragment', () => {
  it.each([
    ['#token=abc', 'abc'],
    ['token=abc', 'abc'],
    ['#token=a%2Bb%3D', 'a+b='],
    ['#x=1&token=abc', 'abc'],
    ['#token=', undefined],
    ['#other=abc', undefined],
    ['', undefined],
    ['#', undefined],
    [`#token=${'a'.repeat(129)}`, undefined],
    [`#token=${'a'.repeat(128)}`, 'a'.repeat(128)],
  ])('%j → %j', (hash, expected) => {
    expect(tokenFromFragment(hash)).toBe(expected);
  });
});

describe('the kept link token', () => {
  const store = () => {
    const stored: Record<string, string> = {};
    return {
      stored,
      storage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, value: string) => void (stored[key] = value),
        removeItem: (key: string) => void delete stored[key],
      },
    };
  };

  it('is kept until it is dropped', () => {
    const { storage, stored } = store();
    expect(stashToken(storage, 'abc')).toBe(true);
    expect(stashedToken(storage)).toBe('abc');
    expect(stashedToken(storage)).toBe('abc');
    dropToken(storage);
    expect(stashedToken(storage)).toBeUndefined();
    expect(stored[LINK_TOKEN_KEY]).toBeUndefined();
  });

  it('works without storage, and when storage throws', () => {
    expect(stashToken(undefined, 'abc')).toBe(false);
    expect(stashedToken(undefined)).toBeUndefined();
    dropToken(undefined);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(stashToken(throwing, 'abc')).toBe(false);
    expect(stashedToken(throwing)).toBeUndefined();
    expect(() => dropToken(throwing)).not.toThrow();
  });

  it('refuses a stored value that is too long', () => {
    const { storage } = store();
    storage.setItem(LINK_TOKEN_KEY, 'a'.repeat(129));
    expect(stashedToken(storage)).toBeUndefined();
  });
});
