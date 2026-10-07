import { describe, expect, it } from 'vitest';
import { resolvePath, splitPath } from './match.ts';

describe('splitPath', () => {
  it.each([
    ['/', []],
    ['/a', ['a']],
    ['/a/b', ['a', 'b']],
    ['/a/b/', ['a', 'b']],
    ['/caf%C3%A9', ['café']],
    ['/a%20b', ['a b']],
  ])('%s → %j', (path, expected) => {
    expect(splitPath(path)).toEqual(expected);
  });

  it.each([
    'a/b',
    '',
    '//',
    '/a//b',
    '/a/../b',
    '/..',
    '/a/./b',
    '/%2e%2e/a',
    '/%2E%2e',
    '/a%2Fb',
    '/a%2fb',
    '/a%5Cb',
    '/a\\b',
    '/a%00b',
    '/a%0ab',
    '/a%zz',
    '/a/%',
  ])('refuses %j', (path) => {
    expect(splitPath(path)).toBeUndefined();
  });
});

describe('resolvePath', () => {
  const patterns = [
    '/',
    '/docs',
    '/legal/:page',
    '/users/:id',
    '/users/pending',
    '/a/:x/:y',
    '/a/b/:y',
  ];
  const cases: [string, string | undefined, Record<string, string>?][] = [
    ['/', '/'],
    ['/docs', '/docs'],
    ['/docs/', '/docs'],
    ['/legal/terms', '/legal/:page', { page: 'terms' }],
    ['/users/42', '/users/:id', { id: '42' }],
    ['/users/pending', '/users/pending'], // the fixed word beats the parameter
    ['/a/b/c', '/a/b/:y', { y: 'c' }], // fixed words win from the left
    ['/a/z/c', '/a/:x/:y', { x: 'z', y: 'c' }],
    ['/legal', undefined],
    ['/legal/terms/extra', undefined],
    ['/nothing', undefined],
    ['/users/%2e%2e', undefined],
    ['/users/a%2Fb', undefined],
    ['/legal/%E0%A4%A', undefined],
  ];
  it.each(cases)('%s → %s', (path, pattern, params) => {
    const match = resolvePath(patterns, path);
    expect(match?.pattern).toBe(pattern);
    if (params) expect(match?.params).toEqual(params);
  });

  it('returns the first of two equal patterns and never throws on odd patterns', () => {
    expect(resolvePath(['/x/:a', '/x/:b'], '/x/1')?.pattern).toBe('/x/:a');
    expect(resolvePath([], '/x')).toBeUndefined();
  });
});
