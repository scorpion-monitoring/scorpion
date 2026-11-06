import { describe, expect, it } from 'vitest';
import { sources } from '../../server/src/generated/profile.ts';
import { currentId, isBelow, rowsOf, type NavLike } from './lib/nav-tree.ts';

const entry = (id: string, path: string, section = 'main'): NavLike => ({ id, path, section });

describe('isBelow', () => {
  const cases: [string, string, boolean][] = [
    ['/admin/users/pending', '/admin/users', true],
    ['/admin/users', '/admin/users', false],
    ['/admin/users-old', '/admin/users', false],
    ['/admin/users/:id', '/admin/users', true],
    ['/services', '/', false],
    ['/', '/', false],
    ['/admin', '/admin/users', false],
  ];
  it.each(cases)('%s below %s is %s', (path, parent, expected) => {
    expect(isBelow(path, parent)).toBe(expected);
  });
});

describe('currentId', () => {
  const items = [
    entry('home', '/'),
    entry('services', '/services'),
    entry('impact', '/services/evaluate'),
    entry('users', '/admin/users', 'admin'),
    entry('pending', '/admin/users/pending', 'admin'),
  ];
  const cases: [string | undefined, string | undefined][] = [
    ['/', 'home'],
    ['/services', 'services'],
    ['/services/:slug', 'services'],
    ['/services/evaluate', 'impact'],
    ['/services/evaluate/detail', 'impact'],
    ['/admin/users', 'users'],
    ['/admin/users/:id', 'users'],
    ['/admin/users/pending', 'pending'],
    ['/admin/roles', undefined],
    ['/login', undefined],
    [undefined, undefined],
  ];
  it.each(cases)('the page %s has the current entry %s', (pattern, expected) => {
    expect(currentId(items, pattern)).toBe(expected);
  });
});

describe('rowsOf', () => {
  it('draws an entry under the entry its path lies below, and keeps the order of the rest', () => {
    const rows = rowsOf([
      entry('profile', '/profile', 'account'),
      entry('inbox', '/inbox', 'account'),
      entry('organisations', '/account/organisations', 'account'),
      entry('notifications', '/profile/notifications', 'account'),
    ]);
    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      ['profile', 0],
      ['notifications', 1],
      ['inbox', 0],
      ['organisations', 0],
    ]);
  });

  it('nests as deep as the paths go, under the nearest ancestor', () => {
    const rows = rowsOf([entry('c', '/a/b/c'), entry('a', '/a'), entry('b', '/a/b')]);
    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('never nests under the home entry', () => {
    const rows = rowsOf([entry('home', '/'), entry('docs', '/docs')]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0]);
  });

  it('is empty for no entries', () => {
    expect(rowsOf([])).toEqual([]);
  });
});

describe('the navigation of the full profile', () => {
  const contributions = (registry: 'ui.nav' | 'ui.routes') =>
    sources.flatMap(({ manifest }) =>
      ((manifest.contributes?.[registry] ?? []) as Record<string, unknown>[]).map((value) => value),
    );
  const nav = contributions('ui.nav').map(
    (value) => ({ id: value.id, path: value.path, section: value.section }) as NavLike,
  );
  const pages = contributions('ui.routes').map((value) => value.path as string);

  it('has exactly one current entry on the page of every entry', () => {
    for (const item of nav) {
      const current = nav.filter((candidate) => currentId(nav, item.path) === candidate.id);
      expect(
        current.map((candidate) => candidate.id),
        item.path,
      ).toEqual([item.id]);
    }
  });

  it('has one current entry, never two, on every registered page, and one wherever a page is at or below an entry', () => {
    for (const page of pages) {
      const current = nav.filter((item) => currentId(nav, page) === item.id);
      expect(current.length, page).toBeLessThanOrEqual(1);
      const covered = nav.some((item) => item.path === page || isBelow(page, item.path));
      expect(current.length === 1, page).toBe(covered);
    }
  });

  it('shows Pending approvals under Users and Impact under Services', () => {
    const rows = rowsOf(nav.filter((item) => item.section === 'admin'));
    const depth = (id: string) => rows.find((row) => row.item.id === id)?.depth;
    expect(depth('admin.users')).toBe(0);
    expect(depth('admin.users.pending')).toBe(1);
    const main = rowsOf(nav.filter((item) => item.section === 'main'));
    expect(main.find((row) => row.item.id === 'services.impact')?.depth).toBe(1);
    // The row right after Users is its child.
    const at = rows.findIndex((row) => row.item.id === 'admin.users');
    expect(rows[at + 1]?.item.id).toBe('admin.users.pending');
  });

  it('draws every entry once, whatever the nesting', () => {
    for (const section of new Set(nav.map((item) => item.section))) {
      const items = nav.filter((item) => item.section === section);
      expect(
        rowsOf(items)
          .map((row) => row.item.id)
          .sort(),
      ).toEqual(items.map((item) => item.id).sort());
    }
  });
});
