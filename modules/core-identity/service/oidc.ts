// OIDC login (ADR 0011): start a login and complete it at the callback. Everything that changes
// data goes through here.
import { and, eq, sql } from 'drizzle-orm';
import { CodeChallengeMethod, OAuth2Client, OAuth2RequestError } from 'arctic';
import { Forbidden, NotFound, Unauthorized } from '@scorpion/contracts';
import type { ModuleContext } from '@scorpion/kernel';
import { authMethod } from '../db/schema.ts';
import type { User, UserService } from '../public.ts';
import {
  challengeOf,
  constantTimeEqual,
  isVerifierFormat,
  type LoginStateService,
} from './login-state.ts';
import { BadRequest, InvalidIdToken, ProviderUnavailable } from './oidc-errors.ts';
import type { ClientSecretLookup } from './oidc-secret.ts';
import type { ProviderClient } from './oidc-provider.ts';
import { verifyIdToken, type IdentityClaims } from './oidc-token.ts';
import type { SessionService } from './sessions.ts';
import type { IdentitySettings, OidcProvider } from './settings.ts';

/** Where the internal API is mounted; the callback URL registered at the provider ends in `/auth/oidc/<id>/callback`. */
const INTERNAL_PREFIX = '/api/internal';
/** The code exchange cannot be aborted (arctic), so it is raced against this. */
export const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

export interface StartedLogin {
  /** Where to send the browser. */
  authorizationUrl: string;
  /** The value of the login cookie (the PKCE verifier) and how long it lives. */
  cookie: { value: string; maxAgeSeconds: number };
}

export type CompletedLogin = { kind: 'login'; sessionId: string; expiresAt: Date };

export interface CompleteInput {
  providerId: string;
  state: string;
  code: string | undefined;
  /** The provider's `error` parameter, if it sent one. */
  error: string | undefined;
  /** The login cookie of this browser. */
  verifier: string | undefined;
  /** The session cookie, if there is one; a successful login replaces it. */
  previousSessionId: string | undefined;
}

export interface OidcService {
  /** Where the browser goes after the callback: the application root under `BASE_PATH`. Fixed, so there is no open redirect. */
  readonly landing: string;
  /** Starts a login for anyone. 404 for a provider that is not configured, 502 when it cannot be reached. */
  start(providerId: string): Promise<StartedLogin>;
  /** Completes the login that this browser started. */
  complete(input: CompleteInput): Promise<CompletedLogin>;
}

type Reason = string;

export interface OidcDeps {
  users: UserService;
  sessions: SessionService;
  settings: IdentitySettings;
  states: LoginStateService;
  providers: ProviderClient;
  clientSecret: ClientSecretLookup;
  exchangeTimeoutMs?: number;
}

const GENERIC_REFUSAL = 'Signing in failed.';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderUnavailable()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createOidcService(ctx: ModuleContext, deps: OidcDeps): OidcService {
  const { users, sessions, settings, states, providers } = deps;
  const exchangeTimeoutMs = deps.exchangeTimeoutMs ?? TOKEN_EXCHANGE_TIMEOUT_MS;

  const redirectUri = (providerId: string): string => {
    const base = ctx.config.BASE_PATH === '/' ? '' : ctx.config.BASE_PATH;
    return `${ctx.config.ORIGIN}${base}${INTERNAL_PREFIX}/auth/oidc/${providerId}/callback`;
  };

  async function providerOrThrow(id: string): Promise<OidcProvider> {
    const { oidcProviders } = await settings.get();
    const found = oidcProviders.find((provider) => provider.id === id);
    if (!found) throw new NotFound('There is no such sign-in provider.');
    return found;
  }

  const clientFor = (provider: OidcProvider) =>
    new OAuth2Client(
      provider.clientId,
      deps.clientSecret(provider.id) ?? null,
      redirectUri(provider.id),
    );

  /** A refusal the log can explain and the caller cannot learn from. */
  function refuse(providerId: string, reason: Reason, extra: Record<string, unknown> = {}): void {
    ctx.log.warn({ provider: providerId, reason, ...extra }, 'oidc login refused');
  }

  async function begin(providerId: string): Promise<StartedLogin> {
    const provider = await providerOrThrow(providerId);
    const discovery = await providers.discovery(provider);
    const fresh = await states.create(provider.id);
    const url = clientFor(provider).createAuthorizationURLWithPKCE(
      discovery.authorizationEndpoint,
      fresh.state,
      CodeChallengeMethod.S256,
      fresh.verifier,
      provider.scopes,
    );
    url.searchParams.set('nonce', fresh.nonce);
    return {
      authorizationUrl: url.toString(),
      cookie: { value: fresh.verifier, maxAgeSeconds: 600 },
    };
  }

  /** The same refusals as a password login: a pending account waits, a rejected or deleted one is simply refused. */
  function assertMaySignIn(found: User): void {
    if (found.deletedAt !== null || found.status === 'rejected') {
      throw new Unauthorized(GENERIC_REFUSAL);
    }
    if (found.status === 'pending') throw new Forbidden('Your account is waiting for approval.');
  }

  async function startSession(userId: string, provider: string, previous: string | undefined) {
    const created = await ctx.db.tx(async (tx) => {
      const session = await sessions.create(userId, tx);
      await tx
        .update(authMethod)
        .set({ lastLoginAt: sql`now()` })
        .where(and(eq(authMethod.userId, userId), eq(authMethod.provider, provider)));
      return session;
    });
    if (previous) await sessions.revoke(previous);
    return created;
  }

  async function login(
    provider: OidcProvider,
    claims: IdentityClaims,
    previousSessionId: string | undefined,
  ): Promise<CompletedLogin> {
    const [known] = await ctx.db
      .select({ userId: authMethod.userId })
      .from(authMethod)
      .where(and(eq(authMethod.provider, provider.id), eq(authMethod.subject, claims.subject)))
      .limit(1);

    let account: User | undefined;
    if (known) {
      account = await users.findById(known.userId);
      if (!account) throw new Unauthorized(GENERIC_REFUSAL);
      assertMaySignIn(account);
    } else {
      // An account is created from a first login, or linked by a verified address, in the next step.
      throw new Unauthorized(GENERIC_REFUSAL);
    }

    const session = await startSession(account.id, provider.id, previousSessionId);
    return { kind: 'login', sessionId: session.id, expiresAt: session.expiresAt };
  }

  return {
    landing: ctx.config.BASE_PATH === '/' ? '/' : `${ctx.config.BASE_PATH}/`,

    start: (providerId) => begin(providerId),

    async complete(input) {
      const provider = await providerOrThrow(input.providerId);

      // The state is used up first, whatever else is wrong: a callback is never retried.
      const stored = await states.consume(input.state);
      if (!stored || stored.providerId !== provider.id) {
        refuse(provider.id, stored ? 'state-other-provider' : 'state-unknown');
        throw new BadRequest('This sign-in link is not valid or has expired. Start again.');
      }
      // The browser that finishes the login must be the one that started it (login CSRF).
      if (
        input.verifier === undefined ||
        !isVerifierFormat(input.verifier) ||
        !constantTimeEqual(challengeOf(input.verifier), stored.bindingHash)
      ) {
        refuse(provider.id, 'state-other-browser');
        throw new BadRequest('This sign-in link is not valid or has expired. Start again.');
      }
      if (input.error !== undefined || input.code === undefined) {
        refuse(provider.id, input.error === undefined ? 'no-code' : 'provider-error');
        throw new BadRequest('The provider did not complete the sign-in.');
      }

      // A state made for linking (the next step) is not a login.
      if (stored.linkUserId !== null) {
        refuse(provider.id, 'state-is-for-linking');
        throw new BadRequest('This sign-in link is not valid or has expired. Start again.');
      }

      const discovery = await providers.discovery(provider);

      let idToken: string;
      try {
        const tokens = await withTimeout(
          clientFor(provider).validateAuthorizationCode(
            discovery.tokenEndpoint,
            input.code,
            input.verifier,
          ),
          exchangeTimeoutMs,
        );
        try {
          idToken = tokens.idToken();
        } catch {
          throw new InvalidIdToken('missing');
        }
      } catch (error) {
        if (error instanceof InvalidIdToken || error instanceof ProviderUnavailable) {
          if (error instanceof InvalidIdToken) refuse(provider.id, error.reason);
          throw error;
        }
        // The provider's own error text is not repeated; only a short code from it is logged.
        const code = error instanceof OAuth2RequestError ? error.code : undefined;
        refuse(provider.id, 'code-exchange', {
          code: /^[a-z_]{1,40}$/.test(code ?? '') ? code : undefined,
        });
        if (code === 'invalid_grant')
          throw new BadRequest('The provider refused the authorisation code.');
        throw new ProviderUnavailable();
      }

      const expected = {
        issuer: provider.issuer,
        clientId: provider.clientId,
        nonceHash: stored.nonceHash,
        now: new Date(),
      };
      let claims: IdentityClaims;
      try {
        try {
          claims = await verifyIdToken(
            idToken,
            await providers.keys(provider, discovery),
            expected,
          );
        } catch (error) {
          // A key we do not know may be a rotation: read the key set again once.
          if (!(error instanceof InvalidIdToken) || error.reason !== 'unknown-key') throw error;
          claims = await verifyIdToken(
            idToken,
            await providers.keys(provider, discovery, true),
            expected,
          );
        }
      } catch (error) {
        if (error instanceof InvalidIdToken) refuse(provider.id, error.reason);
        throw error;
      }

      return login(provider, claims, input.previousSessionId);
    },
  };
}
