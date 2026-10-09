import { describe, expect, it } from 'vitest';
import { groupPermissions, sameSet, setGroup, togglePermission } from './groups.ts';

const info = (id: string, module: string, description = `About ${id}`) => ({
  id,
  module,
  description,
});

describe('groupPermissions', () => {
  it('groups by the declaring module, sorted, each group sorted by id without repeats', () => {
    expect(
      groupPermissions([
        info('core.settings.read', 'core.settings'),
        info('core.identity.user.read', 'core.identity'),
        info('core.identity.me.read', 'core.identity'),
        info('backup.run', 'backup'),
        info('core.identity.me.read', 'core.identity'),
      ]),
    ).toEqual([
      { module: 'backup', permissions: [info('backup.run', 'backup')] },
      {
        module: 'core.identity',
        permissions: [
          info('core.identity.me.read', 'core.identity'),
          info('core.identity.user.read', 'core.identity'),
        ],
      },
      { module: 'core.settings', permissions: [info('core.settings.read', 'core.settings')] },
    ]);
  });

  it('trusts the module the API names, not the shape of the id', () => {
    // An id that does not start with its module's id (a module may name its permissions as it likes).
    expect(groupPermissions([info('odd.name.read', 'kpi.framework')])).toEqual([
      { module: 'kpi.framework', permissions: [info('odd.name.read', 'kpi.framework')] },
    ]);
  });

  it('is empty for no permission', () => {
    expect(groupPermissions([])).toEqual([]);
  });
});

describe('changing a set', () => {
  it('turns one permission on and off, keeping the order and not repeating', () => {
    expect(togglePermission(['b', 'd'], 'c', true)).toEqual(['b', 'c', 'd']);
    expect(togglePermission(['b', 'c'], 'c', true)).toEqual(['b', 'c']);
    expect(togglePermission(['b', 'c'], 'c', false)).toEqual(['b']);
    expect(togglePermission(['b'], 'x', false)).toEqual(['b']);
  });

  it('turns a group on and off without touching the rest', () => {
    expect(setGroup(['a', 'z'], ['b', 'c'], true)).toEqual(['a', 'b', 'c', 'z']);
    expect(setGroup(['a', 'b', 'z'], ['b', 'c'], false)).toEqual(['a', 'z']);
    expect(setGroup(['b'], ['b', 'c'], true)).toEqual(['b', 'c']);
  });

  it('compares sets whatever their order', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameSet([], [])).toBe(true);
    expect(sameSet(['a', 'a'], ['a', 'b'])).toBe(false);
  });
});
