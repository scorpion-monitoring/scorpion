import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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

describe('a widget entry for the dashboard grid (M11)', () => {
  const base = {
    id: 'trends',
    slot: 'dashboard',
    component: 'Trends',
    permission: 'm.trends.read',
  };
  const grid = {
    w: 6,
    h: 4,
    minW: 3,
    maxW: 12,
    minH: 2,
    maxH: 8,
    default: { x: 0, y: 0, w: 6, h: 4 },
  };
  const parse = (extra: Record<string, unknown>) =>
    widgetEntrySchema.safeParse({ ...base, ...extra });
  const messages = (extra: Record<string, unknown>) => {
    const result = parse(extra);
    return result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  };

  it('stays valid without any of the new fields, and carries them when given', () => {
    expect(parse({}).success).toBe(true);
    const full = parse({
      grid: { ...grid, singleton: true },
      label: 'widget.trends',
      description: 'widget.trends.about',
      icon: 'list',
      configSchema: z.object({ range: z.string().default('1y') }),
    });
    expect(full.success).toBe(true);
  });

  it('accepts a grid of just a size, and one with every field', () => {
    expect(parse({ grid: { w: 4, h: 3 } }).success).toBe(true);
    expect(parse({ grid }).success).toBe(true);
    expect(parse({ grid: { w: 12, h: 50, minW: 12, maxW: 12 } }).success).toBe(true);
  });

  it.each([
    [
      'a minW above maxW',
      { grid: { ...grid, minW: 8, maxW: 5, w: 6, default: undefined } },
      'grid.minW',
    ],
    [
      'a minH above maxH',
      { grid: { ...grid, minH: 7, maxH: 3, h: 4, default: undefined } },
      'grid.minH',
    ],
    ['a w below its own minW', { grid: { ...grid, w: 2, default: undefined } }, 'grid.w'],
    ['a w above its own maxW', { grid: { ...grid, maxW: 5, default: undefined } }, 'grid.w'],
    ['an h above its own maxH', { grid: { ...grid, h: 9, default: undefined } }, 'grid.h'],
    [
      'a default that leaves the 12 columns',
      { grid: { ...grid, default: { x: 8, y: 0, w: 6, h: 4 } } },
      'grid.default',
    ],
    [
      'a default that starts outside the grid',
      { grid: { ...grid, default: { x: 12, y: 0, w: 1, h: 4 } } },
      'grid.default.x',
    ],
    [
      'a default with a negative column',
      { grid: { ...grid, default: { x: -1, y: 0, w: 6, h: 4 } } },
      'grid.default.x',
    ],
    [
      'a default width outside its own limits',
      { grid: { ...grid, default: { x: 0, y: 0, w: 2, h: 4 } } },
      'grid.default.w',
    ],
    [
      'a default height outside its own limits',
      { grid: { ...grid, default: { x: 0, y: 0, w: 6, h: 9 } } },
      'grid.default.h',
    ],
    ['a width above the 12 columns', { grid: { w: 13, h: 3 } }, 'grid.w'],
    ['a zero height', { grid: { w: 4, h: 0 } }, 'grid.h'],
    ['a fractional width', { grid: { w: 4.5, h: 3 } }, 'grid.w'],
    ['an unknown key in the grid', { grid: { w: 4, h: 3, resizable: true } }, 'grid'],
    [
      'two defaults for a singleton (a default is one placement, not a list)',
      {
        grid: {
          w: 4,
          h: 3,
          singleton: true,
          default: [
            { x: 0, y: 0, w: 4, h: 3 },
            { x: 4, y: 0, w: 4, h: 3 },
          ],
        },
      },
      'grid.default',
    ],
    ['an icon that is not in the table', { icon: 'rocket' }, 'icon'],
    ['an icon named after a prototype key', { icon: 'constructor' }, 'icon'],
    [
      'a configSchema that is not a Zod schema',
      { configSchema: { type: 'object' } },
      'configSchema',
    ],
    ['an empty label', { label: '' }, 'label'],
    ['an id that is too long', { id: `a${'b'.repeat(100)}` }, 'id'],
  ])('refuses %s', (_name, extra, path) => {
    const found = messages(extra);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((line) => line.startsWith(path))).toBe(true);
  });

  it('says what is wrong in words', () => {
    expect(messages({ grid: { ...grid, minW: 8, maxW: 5, w: 6, default: undefined } })).toContain(
      'grid.minW: minW must not exceed maxW',
    );
    expect(messages({ grid: { ...grid, default: { x: 8, y: 0, w: 6, h: 4 } } })).toContain(
      'grid.default: default must fit the 12 columns (x + w <= 12)',
    );
  });
});
