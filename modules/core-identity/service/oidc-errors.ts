// The failures of an OIDC login, as domain errors the error mapper turns into problem+json. None of
// them carries provider text, a token, a code or a secret: what went wrong is a reason code, for
// the log and for tests.
import { DomainError, Unauthorized } from '@scorpion/contracts';
import { ACCOUNT_PENDING, type LoginErrorCode } from '../problem-types.ts';

export { LOGIN_ERROR_CODES, type LoginErrorCode } from '../problem-types.ts';

/** 400: the login cannot be completed as sent (unknown, expired, replayed or foreign state, or a refused code). */
export class BadRequest extends DomainError {
  constructor(detail: string) {
    super(400, 'Bad Request', detail);
  }
}

/** 502: the provider could not be reached, was too slow, or answered with something unusable. */
export class ProviderUnavailable extends DomainError {
  constructor(detail = 'The sign-in provider could not be reached or answered unexpectedly.') {
    super(502, 'Bad Gateway', detail);
  }
}

export type IdTokenFailure =
  | 'malformed'
  | 'signature'
  | 'algorithm'
  | 'unknown-key'
  | 'issuer'
  | 'audience'
  | 'azp'
  | 'expired'
  | 'not-yet-valid'
  | 'iat'
  | 'claims'
  | 'nonce'
  | 'auth-time-missing'
  | 'auth-time-stale'
  | 'missing';

/** 401: the id_token failed a check. The reason is for the log; the caller is told only that it failed. */
export class InvalidIdToken extends Unauthorized {
  readonly reason: IdTokenFailure;
  constructor(reason: IdTokenFailure) {
    super('The sign-in could not be verified.');
    this.reason = reason;
  }
}

/**
 * The code for a failure of the callback, or `undefined` for a failure that is not one of the sign-in
 * (a bug, a database error): that one stays an error answer. `providerRefused` is true when the provider
 * itself sent an `error` (the person said no, or it failed), so a 400 is then not "your link is old".
 */
export function loginErrorCode(
  error: unknown,
  providerRefused: boolean,
): LoginErrorCode | undefined {
  if (!(error instanceof DomainError)) return undefined;
  if (error.status === 403 && error.type === ACCOUNT_PENDING) return 'account-pending';
  if (error instanceof InvalidIdToken) return 'verification-failed';
  switch (error.status) {
    case 400:
      return providerRefused ? 'provider-denied' : 'state-invalid';
    case 401:
      return 'not-allowed';
    case 409:
      return 'already-linked';
    case 502:
      return 'provider-unavailable';
    default:
      return undefined;
  }
}
