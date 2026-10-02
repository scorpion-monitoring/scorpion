// Password hashing: argon2id through `@node-rs/argon2`. The parameters are in this one place.
import { hash, verify, type Algorithm } from '@node-rs/argon2';

export interface PasswordHashParams {
  algorithm: Algorithm;
  /** Memory in KiB. */
  memoryCost: number;
  /** Passes over the memory. */
  timeCost: number;
  parallelism: number;
  /** Bytes of the raw hash. */
  outputLen: number;
}

/**
 * What production uses: argon2id with 64 MiB, 3 passes and one lane, which is the second
 * parameter set recommended by RFC 9106 (§4) with the lanes reduced to one so that a burst of
 * logins does not take every core. A login costs about 64 MiB for the length of one hash; the
 * strict rate-limit bucket keeps the number of parallel logins small. Raise the cost when the
 * hardware allows: an old hash stays valid because it carries its own parameters.
 *
 * `Algorithm` is an ambient const enum, which a type-stripping build cannot import as a value;
 * 2 is `Algorithm.Argon2id`.
 */
export const PRODUCTION_PARAMS: Readonly<PasswordHashParams> = Object.freeze({
  algorithm: 2,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
});

/** Only for `NODE_ENV=test`, so a suite with hundreds of hashes stays fast. Never used otherwise. */
export const TEST_PARAMS: Readonly<PasswordHashParams> = Object.freeze({
  ...PRODUCTION_PARAMS,
  memoryCost: 1_024,
  timeCost: 1,
});

export function passwordHashParams(nodeEnv: string | undefined): Readonly<PasswordHashParams> {
  return nodeEnv === 'test' ? TEST_PARAMS : PRODUCTION_PARAMS;
}

/** Hashes a password to a PHC string (`$argon2id$v=19$m=…`) with a fresh random salt. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, passwordHashParams(process.env.NODE_ENV));
}

/**
 * Checks a password against a stored hash. A hash that cannot be parsed is a failed check, never
 * an exception: a damaged row must not turn a login into a 500 or tell the caller anything.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
