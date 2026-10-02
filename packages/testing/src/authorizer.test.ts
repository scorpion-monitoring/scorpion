import { ANONYMOUS, Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { testAuthorizer, testAuthorizerEntry } from './authorizer.ts';

const alice: Actor = { kind: 'user', userId: 'u1', username: 'alice', roles: [], via: 'session' };

describe('the test authoriser', () => {
  const authorize = testAuthorizer(['a.read', 'a.write']);

  it('lets a signed-in caller through for a permission in the set', () => {
    expect(() => authorize({ actor: alice, permission: 'a.read' })).not.toThrow();
    expect(() => authorize({ actor: alice, permission: 'a.write' })).not.toThrow();
  });

  it('denies a permission outside the set with 403', () => {
    expect(() => authorize({ actor: alice, permission: 'a.admin' })).toThrow(Forbidden);
  });

  it('denies an anonymous caller with 401, even for a permission in the set', () => {
    expect(() => authorize({ actor: ANONYMOUS, permission: 'a.read' })).toThrow(Unauthorized);
  });

  it('allows everything to a signed-in caller with "*", and still not to an anonymous one', () => {
    const all = testAuthorizer(['*']);
    expect(() => all({ actor: alice, permission: 'anything.at.all' })).not.toThrow();
    expect(() => all({ actor: ANONYMOUS, permission: 'anything.at.all' })).toThrow(Unauthorized);
  });

  it('allows nothing for an empty set', () => {
    expect(() => testAuthorizer([])({ actor: alice, permission: 'a.read' })).toThrow(Forbidden);
  });

  it('is also available as a registry entry', () => {
    expect(() =>
      testAuthorizerEntry(['a.read']).authorize({ actor: alice, permission: 'a.read' }),
    ).not.toThrow();
  });
});
