// OIDC login (ADR 0011): start a login, complete it at the callback, and link a provider to a
// signed-in account. Everything that changes data goes through here.
import { and, eq, sql } from 'drizzle-orm';
import { CodeChallengeMethod, OAuth2Client, OAuth2RequestError } from 'arctic';
import { Conflict, Forbidden, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type ModuleContext } from '@scorpion/kernel';
import { authMethod } from '../db/schema.ts';
import type { User, UserService } from '../public.ts';
import { APPROVAL_POLICY_REGISTRY, type ApprovalPolicyEntry } from './approval-policy.ts';
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
import { requireSession } from './require-user.ts';
import { grantDefaultRole } from './roles.ts';
import type { SessionService } from './sessions.ts';
import type { IdentitySettings, OidcProvider } from './settings.ts';
import { usernameBase, usernameCandidates } from './username.ts';

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

export type CompletedLogin =
  { kind: 'login'; sessionId: string; expiresAt: Date } | { kind: 'linked' };

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
  /** Starts the flow that adds a provider to the signed-in caller's account. Session only. */
  startLink(actor: Actor, providerId: string): Promise<StartedLogin>;
  /** Completes the login (or the link) that this browser started. */
  complete(input: CompleteInput): Promise<CompletedLogin>;
}

type Reason = string;

export interface OidcDeps {
  authz: AuthzService;
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
  const { authz, users, sessions, settings, states, providers } = deps;
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

  /** A provider without a stored secret is a public client (PKCE only). */
  const clientFor = async (provider: OidcProvider) =>
    new OAuth2Client(
      provider.clientId,
      (await deps.clientSecret(provider.id)) ?? null,
      redirectUri(provider.id),
    );

  /** A refusal the log can explain and the caller cannot learn from. */
  function refuse(providerId: string, reason: Reason, extra: Record<string, unknown> = {}): void {
    ctx.log.warn({ provider: providerId, reason, ...extra }, 'oidc login refused');
  }

  async function begin(providerId: string, linkUserId?: string): Promise<StartedLogin> {
    const provider = await providerOrThrow(providerId);
    const discovery = await providers.discovery(provider);
    const fresh = await states.create(provider.id, linkUserId);
    const url = (await clientFor(provider)).createAuthorizationURLWithPKCE(
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

  function policyFor(id: string): ApprovalPolicyEntry | undefined {
    return (ctx.registry(APPROVAL_POLICY_REGISTRY) as readonly ApprovalPolicyEntry[]).find(
      (entry) => entry.id === id,
    );
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

  async function addIdentity(
    found: User,
    provider: string,
    subject: string,
    via: 'email' | 'profile',
  ) {
    await ctx.db.tx(async (tx) => {
      const [sameSubject] = await tx
        .select({ id: authMethod.id })
        .from(authMethod)
        .where(and(eq(authMethod.provider, provider), eq(authMethod.subject, subject)))
        .limit(1);
      const [sameProvider] = await tx
        .select({ id: authMethod.id })
        .from(authMethod)
        .where(and(eq(authMethod.userId, found.id), eq(authMethod.provider, provider)))
        .limit(1);
      if (sameSubject || sameProvider) {
        throw new Conflict('This sign-in is already linked to an account.');
      }
      await tx.insert(authMethod).values({ id: ids.uuidv7(), userId: found.id, provider, subject });
      await ctx.events.emit('identity.authMethod.linked@1', {
        userId: found.id,
        username: found.username,
        provider,
        via,
      });
    });
  }

  async function provision(provider: OidcProvider, claims: IdentityClaims): Promise<User> {
    const email = claims.emailVerified ? claims.email : undefined;
    const { approvalPolicy } = await settings.get();
    const base = usernameBase({ preferredUsername: claims.preferredUsername, email });
    const policy = policyFor(approvalPolicy);
    if (!policy) {
      ctx.log.warn({ policy: approvalPolicy }, 'the configured approval policy is not installed');
    }

    for (const candidate of usernameCandidates(base, provider.id, claims.subject)) {
      if (await users.findByUsername(candidate)) continue;
      const decision = (await policy?.decide({
        username: candidate,
        email,
        emailVerified: email !== undefined,
        provider: provider.id,
      })) ?? { status: 'pending' as const };
      try {
        // The user, its auth method and the event are one write.
        return await ctx.db.tx(async (tx) => {
          const created = await users.createUser({
            username: candidate,
            email,
            emailVerified: email !== undefined,
            status: decision.status,
            auth: { provider: provider.id, subject: claims.subject },
          });
          await grantDefaultRole(authz, tx, created);
          await ctx.events.emit('identity.user.registered@1', {
            userId: created.id,
            username: created.username,
            status: created.status,
          });
          return created;
        });
      } catch (error) {
        // Somebody took this name between the check and the insert: try the next one.
        if (error instanceof Conflict && (await users.findByUsername(candidate))) continue;
        throw error;
      }
    }
    throw new Conflict('Could not create an account for this sign-in. Try again.');
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
      const sameEmail =
        claims.emailVerified && claims.email ? await users.findByEmail(claims.email) : undefined;
      if (sameEmail) {
        // Both sides must have proved the address. A password account whose owner has not
        // confirmed it is never taken over: they sign in as before and link from their profile.
        if (!sameEmail.emailVerified) {
          throw new Conflict(
            'An account with this email address already exists. Sign in the usual way, then link this provider from your profile.',
          );
        }
        if (sameEmail.deletedAt !== null || sameEmail.status === 'rejected') {
          throw new Unauthorized(GENERIC_REFUSAL);
        }
        await addIdentity(sameEmail, provider.id, claims.subject, 'email');
        account = sameEmail;
      } else {
        account = await provision(provider, claims);
      }
      assertMaySignIn(account);
    }

    const session = await startSession(account.id, provider.id, previousSessionId);
    return { kind: 'login', sessionId: session.id, expiresAt: session.expiresAt };
  }

  async function link(provider: OidcProvider, claims: IdentityClaims, userId: string) {
    const found = await users.findById(userId);
    if (!found || found.deletedAt !== null || found.status !== 'active') {
      throw new Unauthorized(GENERIC_REFUSAL);
    }
    await addIdentity(found, provider.id, claims.subject, 'profile');
  }

  return {
    landing: ctx.config.BASE_PATH === '/' ? '/' : `${ctx.config.BASE_PATH}/`,

    start: (providerId) => begin(providerId),

    async startLink(actor, providerId) {
      const caller = requireSession(actor, 'Linking a sign-in provider');
      await authz.require(actor, 'core.identity.auth-method.link');
      return begin(providerId, caller.userId);
    },

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

      const discovery = await providers.discovery(provider);

      // Read outside the try: a secret that cannot be decrypted is an operator's error (a 500 that the
      // log explains without the value), not something to report as a failed sign-in.
      const client = await clientFor(provider);
      let idToken: string;
      try {
        const tokens = await withTimeout(
          client.validateAuthorizationCode(discovery.tokenEndpoint, input.code, input.verifier),
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

      if (stored.linkUserId !== null) {
        await link(provider, claims, stored.linkUserId);
        return { kind: 'linked' };
      }
      return login(provider, claims, input.previousSessionId);
    },
  };
}
