import { describe, expect, it } from 'vitest';
import { shownPage } from './shown-page.ts';

describe('shownPage()', () => {
  it.each([
    ['/', { pattern: '/services/:slug' }, 200, '/services/abc', '/services/:slug', '/services/abc'],
    ['/a/b', { pattern: '/' }, 200, '/a/b', '/', '/'],
    [
      '/a/b',
      { pattern: '/admin/users/:id' },
      200,
      '/a/b/admin/users/7',
      '/admin/users/:id',
      '/admin/users/7',
    ],
    // An error page has no pattern, even when the data of the page before is still there.
    ['/', { pattern: '/services/:slug' }, 404, '/services/nope', null, '/services/nope'],
    ['/', {}, 500, '/x', null, '/x'],
    ['/', null, 200, '/x', null, '/x'],
    ['/', { pattern: 42 }, 200, '/x', null, '/x'],
  ])('under %s: %j, status %i at %s → %s', (basePath, data, status, pathname, pattern, path) => {
    expect(shownPage(basePath, { data, status, pathname })).toEqual({
      pattern,
      pathname: path,
      status,
    });
  });
});
