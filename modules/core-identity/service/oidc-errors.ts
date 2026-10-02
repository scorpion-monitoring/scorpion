// The failures of an OIDC login, as domain errors the error mapper turns into problem+json. None of
// them carries provider text, a token, a code or a secret: what went wrong is a reason code, for
// the log and for tests.
import { DomainError, Unauthorized } from '@scorpion/contracts';

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
  | 'missing';

/** 401: the id_token failed a check. The reason is for the log; the caller is told only that it failed. */
export class InvalidIdToken extends Unauthorized {
  readonly reason: IdTokenFailure;
  constructor(reason: IdTokenFailure) {
    super('The sign-in could not be verified.');
    this.reason = reason;
  }
}
