// id_token validation (ADR 0011). `arctic` only decodes a token; the signature and every claim are
// checked here, with `jose` for the JWS part. A failure is an `InvalidIdToken` carrying a reason
// code for the log; the caller is only told that the sign-in could not be verified.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { InvalidIdToken } from './oidc-errors.ts';
import { SUBJECT_MAX } from '../validation.ts';

/** Signature algorithms we accept. Never `none`, never the HMAC family (that is algorithm confusion). */
export const ID_TOKEN_ALGORITHMS = ['RS256', 'PS256', 'ES256'];
/** How far clocks may differ (seconds), for `exp`, `nbf` and `iat`. */
export const CLOCK_SKEW_SECONDS = 60;

export interface IdTokenExpectation {
  issuer: string;
  clientId: string;
  /** SHA-256 (base64url) of the nonce this login sent. */
  nonceHash: string;
  now: Date;
  /**
   * Set for a re-authentication (ADR 0025): the login must have happened at the provider no
   * earlier than this (the time the request was made, less the clock skew). The id_token must then
   * carry `auth_time`, and it must not be older.
   */
  authTimeNotBefore?: Date;
}

export interface IdentityClaims {
  subject: string;
  email: string | undefined;
  /** True only when the provider sent the boolean `true`. */
  emailVerified: boolean;
  preferredUsername: string | undefined;
  /** When the person authenticated at the provider (seconds since the epoch), if the id_token says. */
  authTime: number | undefined;
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

function fromJose(error: unknown): InvalidIdToken {
  if (error instanceof errors.JWTExpired) return new InvalidIdToken('expired');
  if (error instanceof errors.JWTClaimValidationFailed) {
    switch (error.claim) {
      case 'iss':
        return new InvalidIdToken('issuer');
      case 'aud':
        return new InvalidIdToken('audience');
      case 'nbf':
        return new InvalidIdToken('not-yet-valid');
      default:
        return new InvalidIdToken('claims');
    }
  }
  if (error instanceof errors.JWSSignatureVerificationFailed)
    return new InvalidIdToken('signature');
  if (error instanceof errors.JOSEAlgNotAllowed) return new InvalidIdToken('algorithm');
  if (error instanceof errors.JWKSNoMatchingKey) return new InvalidIdToken('unknown-key');
  return new InvalidIdToken('malformed'); // includes keys we cannot use and tokens that do not parse
}

/**
 * Verifies an id_token against a key set and what this login expects. Returns the few claims we
 * use. Throws `InvalidIdToken`, whatever the reason, and nothing else.
 */
export async function verifyIdToken(
  idToken: string,
  keys: JSONWebKeySet,
  expected: IdTokenExpectation,
): Promise<IdentityClaims> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(idToken, createLocalJWKSet(keys), {
      issuer: expected.issuer,
      audience: expected.clientId,
      algorithms: ID_TOKEN_ALGORITHMS,
      clockTolerance: CLOCK_SKEW_SECONDS,
      currentDate: expected.now,
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    payload = result.payload;
  } catch (error) {
    throw fromJose(error);
  }

  // `iat` is not in the past-only checks of jose: a token from the future is as wrong as an expired one.
  if (typeof payload.iat !== 'number') throw new InvalidIdToken('claims');
  if (payload.iat > expected.now.getTime() / 1000 + CLOCK_SKEW_SECONDS) {
    throw new InvalidIdToken('iat');
  }

  // With several audiences the token says whom it was issued to in `azp`, and that must be us.
  // With one audience an `azp` that is present must still be us (OIDC Core §3.1.3.7).
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const azp = (payload as { azp?: unknown }).azp;
  if (azp !== undefined && azp !== expected.clientId) throw new InvalidIdToken('azp');
  if (audiences.length > 1 && azp === undefined) throw new InvalidIdToken('azp');

  const nonce = (payload as { nonce?: unknown }).nonce;
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 256) {
    throw new InvalidIdToken('nonce');
  }
  const given = Buffer.from(sha256(nonce));
  const wanted = Buffer.from(expected.nonceHash);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    throw new InvalidIdToken('nonce');
  }

  const subject = text(payload.sub, SUBJECT_MAX);
  if (subject === undefined) throw new InvalidIdToken('claims');

  const claims = payload as Record<string, unknown>;
  const authTime =
    typeof claims.auth_time === 'number' && Number.isFinite(claims.auth_time)
      ? claims.auth_time
      : undefined;
  if (expected.authTimeNotBefore !== undefined) {
    // With `max_age` in the request the provider must send `auth_time` (OIDC Core 3.1.3.7). A
    // provider that ignored `prompt=login` answers from its own session and sends an old one.
    if (authTime === undefined) throw new InvalidIdToken('auth-time-missing');
    if (authTime < expected.authTimeNotBefore.getTime() / 1000) {
      throw new InvalidIdToken('auth-time-stale');
    }
  }
  return {
    subject,
    email: text(claims.email, 254),
    emailVerified: claims.email_verified === true,
    preferredUsername: text(claims.preferred_username, 200),
    authTime,
  };
}
