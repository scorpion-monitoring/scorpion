// The state of an OIDC login in progress (ADR 0011). One row per started login, single use,
// 10 minutes. It holds hashes only: the PKCE verifier is a cookie of the browser that started the
// login and the table keeps its SHA-256 (the PKCE challenge), the nonce is kept as its SHA-256.
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { generateCodeVerifier, generateState } from 'arctic';
import { ids, type ModuleContext } from '@scorpion/kernel';
import { loginState } from '../db/schema.ts';

export const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('base64url');

/** The PKCE S256 challenge of a verifier: what the table keeps and what the provider is sent. */
export const challengeOf = sha256;

/** A value in the formats arctic generates: 32 random bytes, 43 base64url characters. */
const RANDOM_VALUE = /^[A-Za-z0-9_-]{43}$/;
export const isVerifierFormat = (value: string): boolean => RANDOM_VALUE.test(value);

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(sha256(a));
  const right = Buffer.from(sha256(b));
  return timingSafeEqual(left, right);
}

export interface NewLoginState {
  /** For the authorisation URL. */
  state: string;
  nonce: string;
  /** For the cookie, and the code exchange. */
  verifier: string;
}

export interface ConsumedLoginState {
  providerId: string;
  nonceHash: string;
  bindingHash: string;
  linkUserId: string | null;
}

export interface LoginStateService {
  /** Stores a new state for a provider and returns the secrets to hand out (never stored as such). */
  create(providerId: string, linkUserId?: string): Promise<NewLoginState>;
  /**
   * Deletes and returns the unexpired state with this value, in one statement, so two parallel
   * callbacks cannot both get it. `undefined` for an unknown, expired or already used one.
   */
  consume(state: string): Promise<ConsumedLoginState | undefined>;
}

export function createLoginStateService(
  ctx: ModuleContext,
  options: { ttlMs?: number } = {},
): LoginStateService {
  const ttl = options.ttlMs ?? LOGIN_STATE_TTL_MS;
  return {
    async create(providerId, linkUserId) {
      const fresh: NewLoginState = {
        state: generateState(),
        nonce: generateState(),
        verifier: generateCodeVerifier(),
      };
      await ctx.db.insert(loginState).values({
        id: ids.uuidv7(),
        providerId,
        stateHash: sha256(fresh.state),
        nonceHash: sha256(fresh.nonce),
        bindingHash: challengeOf(fresh.verifier),
        linkUserId: linkUserId ?? null,
        expiresAt: new Date(Date.now() + ttl),
      });
      return fresh;
    },

    async consume(state) {
      const [row] = await ctx.db
        .delete(loginState)
        .where(and(eq(loginState.stateHash, sha256(state)), gt(loginState.expiresAt, sql`now()`)))
        .returning({
          providerId: loginState.providerId,
          nonceHash: loginState.nonceHash,
          bindingHash: loginState.bindingHash,
          linkUserId: loginState.linkUserId,
        });
      return row;
    },
  };
}
