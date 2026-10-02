// The personal access token format `scp_<8-character prefix>_<secret>` and its parser (defect 3).
// Everything here is pure: a malformed value is "invalid", never an exception, so a bad key can
// only ever become a 401.
import { createHash, randomBytes, randomInt } from 'node:crypto';

export const TOKEN_MARK = 'scp_';
export const PREFIX_LENGTH = 8;
/** 32 random bytes as base64url: 256 bits. */
export const SECRET_LENGTH = 43;
export const TOKEN_LENGTH = TOKEN_MARK.length + PREFIX_LENGTH + 1 + SECRET_LENGTH;
/** Anything longer than this is not even looked at. */
const MAX_PRESENTED = 512;

const TOKEN = /^scp_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
const PREFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export interface ParsedToken {
  prefix: string;
  secret: string;
}

/** Splits a presented token, or returns `undefined` for anything that is not exactly the format. */
export function parseToken(value: unknown): ParsedToken | undefined {
  if (typeof value !== 'string' || value.length !== TOKEN_LENGTH || value.length > MAX_PRESENTED) {
    return undefined;
  }
  const match = TOKEN.exec(value);
  return match ? { prefix: match[1]!, secret: match[2]! } : undefined;
}

export interface NewToken extends ParsedToken {
  /** The whole token, which the owner sees once. */
  token: string;
}

/** A fresh prefix (uniform over the alphabet) and a 256-bit secret. */
export function generateToken(): NewToken {
  let prefix = '';
  for (let i = 0; i < PREFIX_LENGTH; i++)
    prefix += PREFIX_ALPHABET[randomInt(PREFIX_ALPHABET.length)];
  const secret = randomBytes(32).toString('base64url');
  return { prefix, secret, token: `${TOKEN_MARK}${prefix}_${secret}` };
}

/** The key of the in-process cache of verified tokens: a hash, so the cache holds no secret. */
export const cacheKey = (token: string): string => createHash('sha256').update(token).digest('hex');

// --- Scopes -----------------------------------------------------------------------------------

/**
 * A scope is the id of a permission: `core.identity.me.read`, dotted kebab case with at least two
 * segments (ADR 0015). The shape is checked here; that a permission of that id exists is checked
 * when the token is created, and what it grants is decided by core.authz.
 */
export const SCOPE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$/;
export const SCOPE_MAX_LENGTH = 100;
export const SCOPES_MAX = 20;
