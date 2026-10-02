import { describe, expect, it } from 'vitest';
import { effectivePermissions, ROLE_KEY_FORMAT, undeclared } from './permissions.ts';

const declared = new Set(['a.read', 'a.write', 'b.read']);

describe('effectivePermissions', () => {
  it.each([
    ['no roles grant nothing', [], [], []],
    [
      'a role grants its stored permissions',
      [{ key: 'reviewer', permissions: ['a.read'] }],
      ['a.read'],
      [],
    ],
    [
      'roles add up',
      [
        { key: 'reviewer', permissions: ['a.read'] },
        { key: 'user', permissions: ['b.read', 'a.read'] },
      ],
      ['a.read', 'b.read'],
      [],
    ],
    [
      'Admin holds every declared permission, stored or not',
      [{ key: 'admin', permissions: [] }],
      ['a.read', 'a.write', 'b.read'],
      [],
    ],
    [
      'Admin ignores what is stored for it',
      [{ key: 'admin', permissions: ['gone.permission'] }],
      ['a.read', 'a.write', 'b.read'],
      [],
    ],
    [
      'a stored permission nobody declares grants nothing and is reported',
      [{ key: 'reviewer', permissions: ['a.read', 'gone.thing'] }],
      ['a.read'],
      ['gone.thing'],
    ],
    [
      'unknown permissions are reported once, sorted',
      [
        { key: 'x', permissions: ['z.old', 'a.old'] },
        { key: 'y', permissions: ['z.old'] },
      ],
      [],
      ['a.old', 'z.old'],
    ],
    [
      'a role that only looks like Admin is not Admin',
      [{ key: 'administrator', permissions: [] }],
      [],
      [],
    ],
  ])('%s', (_name, roles, granted, unknown) => {
    const result = effectivePermissions(roles, declared);
    expect([...result.granted].sort()).toEqual(granted);
    expect(result.unknown).toEqual(unknown);
  });
});

describe('undeclared', () => {
  it.each([
    [[], []],
    [['a.read'], []],
    [
      ['a.read', 'nope', 'nope', 'other'],
      ['nope', 'other'],
    ],
    [['A.READ'], ['A.READ']],
    [[''], ['']],
  ])('%j → %j', (wanted, expected) => {
    expect(undeclared(wanted, declared)).toEqual(expected);
  });
});

describe('role key format', () => {
  it.each([
    ['admin', true],
    ['data-steward2', true],
    ['', false],
    ['Admin', false],
    ['2fast', false],
    ['has space', false],
    ['a'.repeat(63), true],
    ['a'.repeat(64), false],
  ])('%j → %s', (key, ok) => {
    expect(ROLE_KEY_FORMAT.test(key)).toBe(ok);
  });
});
