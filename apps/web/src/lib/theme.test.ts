import { describe, expect, it } from 'vitest';
import { readTheme, storeTheme, THEME_KEY } from './theme.ts';

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
const broken = {
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

describe('the theme choice', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'system'],
    ['solarized', 'system'],
    ['', 'system'],
    [null, 'system'],
  ])('reads %j as %s', (stored, expected) => {
    const storage = memory();
    if (stored !== null) storage.data.set(THEME_KEY, stored);
    expect(readTheme(storage)).toBe(expected);
  });

  it('stores light and dark and forgets system', () => {
    const storage = memory();
    expect(storeTheme(storage, 'dark')).toBe(true);
    expect(storage.data.get(THEME_KEY)).toBe('dark');
    expect(storeTheme(storage, 'system')).toBe(true);
    expect(storage.data.has(THEME_KEY)).toBe(false);
  });

  it('works without storage: reads the system choice and reports that it did not store', () => {
    expect(readTheme(undefined)).toBe('system');
    expect(readTheme(broken)).toBe('system');
    expect(storeTheme(broken, 'dark')).toBe(false);
    expect(storeTheme(undefined, 'dark')).toBe(false);
  });
});
