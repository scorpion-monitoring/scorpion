import { Conflict, DomainError, Forbidden, NotFound, Unauthorized } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_PENDING, LOCAL_ACCOUNTS_OFF } from '../problem-types.ts';
import {
  BadRequest,
  InvalidIdToken,
  LOGIN_ERROR_CODES,
  loginErrorCode,
  ProviderUnavailable,
} from './oidc-errors.ts';

describe('loginErrorCode', () => {
  it.each([
    ['a pending account', new Forbidden('x', ACCOUNT_PENDING), false, 'account-pending'],
    ['an old or foreign state', new BadRequest('x'), false, 'state-invalid'],
    ['a provider that said no', new BadRequest('x'), true, 'provider-denied'],
    ['an id_token that failed a check', new InvalidIdToken('nonce'), false, 'verification-failed'],
    ['an account that may not sign in', new Unauthorized('x'), false, 'not-allowed'],
    ['an identity that is linked already', new Conflict('x'), false, 'already-linked'],
    ['an unreachable provider', new ProviderUnavailable(), false, 'provider-unavailable'],
  ] as const)('maps %s to %s', (_name, error, refused, code) => {
    expect(loginErrorCode(error, refused)).toBe(code);
  });

  it('leaves everything else an error: another 403, an unknown provider, a bug', () => {
    expect(loginErrorCode(new Forbidden('x', LOCAL_ACCOUNTS_OFF), false)).toBeUndefined();
    expect(loginErrorCode(new Forbidden('x'), false)).toBeUndefined();
    expect(loginErrorCode(new NotFound('x'), false)).toBeUndefined();
    expect(loginErrorCode(new DomainError(500, 'x', 'y'), false)).toBeUndefined();
    expect(loginErrorCode(new Error('boom'), false)).toBeUndefined();
    expect(loginErrorCode('text', false)).toBeUndefined();
  });

  it('only ever returns a code of the fixed list, never text of the error', () => {
    const codes = [
      new Forbidden('Secret detail', ACCOUNT_PENDING),
      new BadRequest('provider said: oops'),
      new ProviderUnavailable('https://idp.internal/token failed'),
    ].map((error) => loginErrorCode(error, false));
    for (const code of codes) expect(LOGIN_ERROR_CODES).toContain(code);
  });
});
