// Pure helpers for session ids and the CSRF token derived from them.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A session id is 256 random bits as 43 base64url characters. */
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

export const isSessionIdFormat = (value: string): boolean => SESSION_ID.test(value);

export const newSessionId = (): string => randomBytes(32).toString('base64url');

/** What the database holds: a leaked table is no login. */
export const hashSessionId = (id: string): string => createHash('sha256').update(id).digest('hex');

/**
 * The CSRF token of a session: a hash of the session id under its own label (ADR 0007). Only
 * someone who holds the session id can compute it, and it is not derivable from the stored
 * `secret_hash`. The client learns it from the login and `me` responses, because it cannot read
 * the HttpOnly cookie.
 */
export const csrfTokenFor = (id: string): string =>
  createHash('sha256').update(`scorpion:csrf:v1:${id}`).digest('base64url');

export function csrfTokenMatches(id: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const expected = Buffer.from(csrfTokenFor(id));
  const given = Buffer.from(presented);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
