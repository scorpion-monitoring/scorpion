// The username of an account created by an OIDC login. It comes from claims the provider sent, so
// it is cleaned up to the module's own rules and made unique with a suffix that depends on the
// identity; a claim never decides anything else about the account.
import { createHash } from 'node:crypto';
import { USERNAME_MAX, USERNAME_MIN } from '../validation.ts';

/** Hex characters of the identity hash added to make a name unique: tried in this order. */
const SUFFIX_LENGTHS = [4, 8, 12] as const;

/** Lower-case ASCII letters, digits, `_` and `-`: accents dropped, anything else becomes `-`, ends trimmed. */
export function cleanUsername(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

/** The name to try first: `preferred_username`, else the part of the verified address before `@`, else `user`. */
export function usernameBase(claims: { preferredUsername?: string; email?: string }): string {
  const fromEmail = claims.email?.split('@')[0];
  for (const raw of [claims.preferredUsername, fromEmail]) {
    const cleaned = raw === undefined ? '' : cleanUsername(raw.slice(0, 200));
    if (cleaned.length > 0) return pad(cleaned);
  }
  return 'user';
}

const pad = (name: string): string =>
  (name.length < USERNAME_MIN ? `${name}-user` : name).slice(0, USERNAME_MAX).replace(/[-_]+$/, '');

/**
 * The names to try, best first: the base, then the base with a hash of `(provider, subject)` appended,
 * longer each time. The same identity always gets the same list.
 */
export function usernameCandidates(base: string, provider: string, subject: string): string[] {
  const digest = createHash('sha256').update(`${provider}\0${subject}`).digest('hex');
  const names = [base];
  for (const length of SUFFIX_LENGTHS) {
    const head = base.slice(0, USERNAME_MAX - 1 - length).replace(/[-_]+$/, '');
    names.push(`${head.length >= 1 ? head : 'user'}-${digest.slice(0, length)}`);
  }
  return names;
}
