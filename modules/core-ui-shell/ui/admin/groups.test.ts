import { describe, expect, it } from 'vitest';
import { groupPermissions, moduleOf, sameSet, setGroup, togglePermission } from './groups.ts';

describe('moduleOf', () => {
  it.each([
    ['core.identity.user.read', 'core.identity'],
    ['core.blob.manage', 'core.blob'],
    ['core.authz.role.manage', 'core.authz'],
    ['registry.services.service.create', 'registry.services'],
    ['kpi.ingestion.measurement.write', 'kpi.ingestion'],
    ['maturity.assess.read', 'maturity'],
    ['backup.run', 'backup'],
    ['core', 'core'],
    ['nothing', 'nothing'],
  ])('puts %s in %s', (permission, module) => {
    expect(moduleOf(permission)).toBe(module);
  });
});

describe('groupPermissions', () => {
  it('groups by module, sorted, and each group sorted without repeats', () => {
    expect(
      groupPermissions([
        'core.settings.read',
        'core.identity.user.read',
        'core.identity.me.read',
        'backup.run',
        'core.identity.me.read',
      ]),
    ).toEqual([
      { module: 'backup', permissions: ['backup.run'] },
      {
        module: 'core.identity',
        permissions: ['core.identity.me.read', 'core.identity.user.read'],
      },
      { module: 'core.settings', permissions: ['core.settings.read'] },
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
