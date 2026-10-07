import { describe, expect, it } from 'vitest';
import {
  navEntrySchema,
  pathSchema,
  routeEntrySchema,
  themeEntrySchema,
  widgetEntrySchema,
} from './registries.ts';

describe('page paths', () => {
  it.each(['/', '/docs', '/legal/:page', '/users/:id/roles', '/a-b/c_d', '/v1.2', '/x/:Id9'])(
    'accept %s',
    (path) => {
      expect(pathSchema.safeParse(path).success).toBe(true);
    },
  );

  it.each([
    '',
    'docs',
    '/docs/',
    '//docs',
    '/a//b',
    '/..',
    '/a/../b',
    '/a/./b',
    '/%2e%2e',
    '/a%2Fb',
    '/A',
    '/a b',
    '/a\\b',
    '/:',
    '/:1x',
    '/a?x=1',
    '/a#x',
    `/${'a'.repeat(200)}`,
  ])('refuse %j', (path) => {
    expect(pathSchema.safeParse(path).success).toBe(false);
  });
});

describe('a page entry', () => {
  it('is a permission, or public with a reason', () => {
    expect(routeEntrySchema.safeParse({ path: '/x', permission: 'm.x.read' }).success).toBe(true);
    expect(
      routeEntrySchema.safeParse({ path: '/x', public: true, publicReason: 'Anyone may read it.' })
        .success,
    ).toBe(true);
  });

  it.each([
    ['neither', { path: '/x' }],
    ['both', { path: '/x', permission: 'm.x.read', public: true, publicReason: 'why' }],
    ['public without a reason', { path: '/x', public: true }],
    ['public with a blank reason', { path: '/x', public: true, publicReason: '   ' }],
    ['a reason without public', { path: '/x', permission: 'm.x.read', publicReason: 'why' }],
    ['public: false', { path: '/x', public: false, publicReason: 'why' }],
    ['an unknown key', { path: '/x', permission: 'm.x.read', component: 'x' }],
  ])('refuses %s', (_name, entry) => {
    expect(routeEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe('a navigation entry', () => {
  const base = { id: 'admin.users', label: 'nav.users', path: '/admin/users', section: 'admin' };

  it('takes a permission or public, and defaults its order', () => {
    expect(navEntrySchema.parse({ ...base, permission: 'core.identity.user.read' }).order).toBe(
      100,
    );
    expect(navEntrySchema.safeParse({ ...base, public: true }).success).toBe(true);
  });

  it.each([
    ['neither', base],
    ['both', { ...base, permission: 'a.b.c', public: true }],
    ['an id with capitals', { ...base, id: 'Admin', permission: 'a.b.c' }],
    ['a section with a dot', { ...base, section: 'ad.min', permission: 'a.b.c' }],
    ['a path with a parameter in the wrong form', { ...base, path: '/a/', permission: 'a.b.c' }],
    ['a fractional order', { ...base, order: 1.5, permission: 'a.b.c' }],
  ])('refuses %s', (_name, entry) => {
    expect(navEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe('widgets and themes', () => {
  it('check their shape', () => {
    expect(
      widgetEntrySchema.safeParse({
        id: 'pending',
        slot: 'dashboard',
        component: 'Pending',
        public: true,
      }).success,
    ).toBe(true);
    expect(
      widgetEntrySchema.safeParse({ id: 'pending', slot: 'dashboard', component: 'P' }).success,
    ).toBe(false);
    expect(
      themeEntrySchema.safeParse({ id: 'scorpiondark', label: 'theme.dark', colorScheme: 'dark' })
        .success,
    ).toBe(true);
    expect(themeEntrySchema.safeParse({ id: 'x', label: 'x', colorScheme: 'sepia' }).success).toBe(
      false,
    );
  });
});
