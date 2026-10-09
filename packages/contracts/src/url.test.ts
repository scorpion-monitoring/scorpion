import { describe, expect, it } from 'vitest';
import { basePrefix, isLocalPath, stripBase, url } from './url.ts';

describe('basePrefix', () => {
  it.each([
    ['/', ''],
    ['/a', '/a'],
    ['/a/b', '/a/b'],
    ['/a/b/c', '/a/b/c'],
    ['/scorpion.v2/x_y', '/scorpion.v2/x_y'],
  ])('%s → %s', (base, expected) => {
    expect(basePrefix(base)).toBe(expected);
  });

  it.each(['', 'a', '/a/', '//', '/a//b', '/a/../b', '/a/./b', '/a b', '/a?x', 'http://x'])(
    'refuses %j',
    (base) => {
      expect(() => basePrefix(base)).toThrow();
    },
  );
});

describe('url', () => {
  const cases: [string, string, string][] = [
    ['/', '/', '/'],
    ['/', '/a', '/a'],
    ['/', '/a/b', '/a/b'],
    ['/', '/a/b/', '/a/b/'],
    ['/a', '/', '/a/'],
    ['/a', '/login', '/a/login'],
    ['/a/b', '/', '/a/b/'],
    ['/a/b', '/login', '/a/b/login'],
    ['/a/b', '/x/y/', '/a/b/x/y/'],
    ['/a/b/c', '/api/internal/auth/me', '/a/b/c/api/internal/auth/me'],
    ['/a/b/c', '/x?y=1&z=2', '/a/b/c/x?y=1&z=2'],
    ['/a/b/c', '/x#token=abc', '/a/b/c/x#token=abc'],
    ['/a/b', '/x?return=%2Fa%2Fb%2Fy#f', '/a/b/x?return=%2Fa%2Fb%2Fy#f'],
    ['/a/b', '/caf%C3%A9', '/a/b/caf%C3%A9'],
    ['/a/b', '/legal/terms', '/a/b/legal/terms'],
    ['/', '/x?next=//evil.example', '/x?next=//evil.example'], // in the query, not the path
  ];
  it.each(cases)('base %s + %s → %s', (base, target, expected) => {
    expect(url(base, target)).toBe(expected);
  });

  it.each([
    'login', // no leading slash
    '',
    '//evil.example/x',
    '///evil.example',
    'https://evil.example/x',
    'javascript:alert(1)',
    '/\\evil.example',
    '/a\\b',
    '/a/../b',
    '/a/%2e%2e/b',
    '/a/%2E%2E/b',
    '/a/./b',
    '/a/%zz',
    '/a\nb',
    '/a\u0000b',
  ])('refuses %j', (target) => {
    expect(() => url('/a/b', target)).toThrow();
    expect(() => url('/', target)).toThrow();
  });
});

describe('stripBase', () => {
  const cases: [string, string, string | undefined][] = [
    ['/', '/', '/'],
    ['/', '/a/b', '/a/b'],
    ['/a/b', '/a/b', '/'],
    ['/a/b', '/a/b/', '/'],
    ['/a/b', '/a/b/x/y', '/x/y'],
    ['/a/b', '/a/bc', undefined],
    ['/a/b', '/a', undefined],
    ['/a/b', '/', undefined],
    ['/a/b', '/x/a/b', undefined],
    ['/a/b/c', '/a/b/c/d', '/d'],
    ['/a/b/c', '/a/b/d', undefined],
  ];
  it.each(cases)('base %s, path %s → %s', (base, path, expected) => {
    expect(stripBase(base, path)).toBe(expected);
  });
});

describe('isLocalPath (the returnTo check)', () => {
  const ok: [string, string][] = [
    ['/', '/'],
    ['/', '/profile'],
    ['/', '/profile?tab=tokens#x'],
    ['/a/b', '/a/b'],
    ['/a/b', '/a/b/'],
    ['/a/b', '/a/b/admin/users?page=2'],
    ['/a/b/c', '/a/b/c/profile'],
  ];
  it.each(ok)('base %s accepts %s', (base, candidate) => {
    expect(isLocalPath(base, candidate)).toBe(true);
  });

  const refused: [string, unknown][] = [
    ['/', 'https://evil.example/'],
    ['/', '//evil.example/'],
    ['/', '/\\evil.example'],
    ['/', '/\\/evil.example'],
    ['/', 'javascript:alert(1)'],
    ['/', ' /profile'],
    ['/', '/pro\nfile'],
    ['/', '/a/../b'],
    ['/', '/%2e%2e/b'],
    ['/', ''],
    ['/', undefined],
    ['/', 42],
    ['/', ['/profile']],
    ['/a/b', '/profile'], // on this host, but not in the application
    ['/a/b', '/a/bc'],
    ['/a/b', '/a'],
    ['/a/b', '/x/a/b'],
    ['/a/b', 'http://localhost/a/b/x'],
  ];
  it.each(refused)('base %s refuses %j', (base, candidate) => {
    expect(isLocalPath(base, candidate)).toBe(false);
  });
});
