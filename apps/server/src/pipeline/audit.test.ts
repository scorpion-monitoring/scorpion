import { ANONYMOUS, type UserActor } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { auditActorOf, outcomeOf } from './audit.ts';

describe('outcomeOf', () => {
  it.each([
    [200, 'ok'],
    [201, 'ok'],
    [204, 'ok'],
    [302, 'ok'],
    [400, 'error'],
    [401, 'denied'],
    [403, 'denied'],
    [404, 'error'],
    [409, 'error'],
    [413, 'error'],
    [422, 'error'],
    [429, 'denied'],
    [500, 'error'],
    [503, 'error'],
  ])('%i → %s', (status, outcome) => {
    expect(outcomeOf(status)).toBe(outcome);
  });
});

describe('auditActorOf', () => {
  const user: UserActor = {
    kind: 'user',
    userId: 'u-1',
    username: 'alice',
    roles: ['admin'],
    via: 'session',
  };

  it('is anonymous without credentials and when the actor was never set (credentials refused)', () => {
    expect(auditActorOf(ANONYMOUS)).toEqual({ kind: 'anonymous' });
    expect(auditActorOf(undefined)).toEqual({ kind: 'anonymous' });
  });

  it('names the user of a session, and neither the username nor the roles', () => {
    expect(auditActorOf(user)).toEqual({ kind: 'user', userId: 'u-1' });
  });

  it('names the owner and the id of a token, and never anything else', () => {
    expect(auditActorOf({ ...user, via: 'token', tokenId: 't-9', scopes: ['x'] })).toEqual({
      kind: 'token',
      userId: 'u-1',
      tokenId: 't-9',
    });
    expect(auditActorOf({ ...user, via: 'token' })).toEqual({
      kind: 'token',
      userId: 'u-1',
      tokenId: null,
    });
  });
});
