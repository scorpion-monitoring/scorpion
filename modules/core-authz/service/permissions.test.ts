import { describe, expect, it } from 'vitest';
import {
  effectivePermissions,
  grants,
  ROLE_KEY_FORMAT,
  undeclared,
  withinScopes,
} from './permissions.ts';

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

describe('scope ∩ owner (grants and withinScopes)', () => {
  const held = new Set(['a.read', 'a.write']);
  const session = { via: 'session' as const };
  const token = (...scopes: string[]) => ({ via: 'token' as const, scopes });

  it.each([
    ['a session is not limited by scopes', session, 'a.read', true, true],
    [
      'a session ignores scopes it carries',
      { via: 'session' as const, scopes: [] },
      'a.read',
      true,
      true,
    ],
    [
      'a token whose scope names the permission and whose owner holds it',
      token('a.read'),
      'a.read',
      true,
      true,
    ],
    [
      'a token whose scope names a permission the owner lacks',
      token('b.read'),
      'b.read',
      true,
      false,
    ],
    [
      'a token whose owner holds it but whose scopes do not name it',
      token('a.write'),
      'a.read',
      false,
      false,
    ],
    ['a token with no scopes', token(), 'a.read', false, false],
    ['a token with undefined scopes', { via: 'token' as const }, 'a.read', false, false],
    ['a token compares exactly, no prefix', token('a'), 'a.read', false, false],
    ['a token compares exactly, no wildcard', token('a.*'), 'a.read', false, false],
    ['a token compares exactly, case matters', token('A.READ'), 'a.read', false, false],
    ['a token with the legacy scope shape', token('read:kpi'), 'a.read', false, false],
  ])('%s', (_name, caller, permission, inScopes, granted) => {
    expect(withinScopes(caller, permission)).toBe(inScopes);
    expect(grants(held, caller, permission)).toBe(granted);
  });

  it('never grants what the owner does not hold, whatever the scopes say', () => {
    expect(grants(new Set(), token('a.read', 'a.write'), 'a.read')).toBe(false);
    expect(grants(new Set(), session, 'a.read')).toBe(false);
  });
});
