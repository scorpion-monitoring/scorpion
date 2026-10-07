// OIDC login (ADR 0011): start a login, complete it at the callback, and link a provider to a
// signed-in account. Everything that changes data goes through here.
import { and, eq, sql } from 'drizzle-orm';
import { CodeChallengeMethod, OAuth2Client, OAuth2RequestError } from 'arctic';
import { Conflict, Forbidden, NotFound, Unauthorized, url, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { ModuleContext } from '@scorpion/kernel';
import { authMethod } from '../db/schema.ts';
import { addIdentityIn } from './identity-link.ts';
import type { OidcLinkService } from './oidc-link.ts';
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
import { CLOCK_SKEW_SECONDS, verifyIdToken, type IdentityClaims } from './oidc-token.ts';
import { requireSession } from './require-user.ts';
import { grantDefaultRole } from './roles.ts';
import type { SessionService } from './sessions.ts';
import type { IdentitySettings, OidcProvider } from './settings.ts';
import { usernameBase, usernameCandidates } from './username.ts';
import { ACCOUNT_PENDING } from '../problem-types.ts';

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
  | { kind: 'login'; sessionId: string; expiresAt: Date }
  | { kind: 'linked' }
  | { kind: 'reauthenticated' }
  /**
   * The provider asserted a verified address that an account holds. Nothing was linked and nobody was
   * signed in; the holder of the account was mailed a link to confirm (ADR 0026). The same whether or
   * not a mail could be sent.
   */
  | { kind: 'check-mail' };

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

/** What the sign-in page may know of a provider: no issuer, no client id. */
export interface PublicProvider {
  id: string;
  displayName: string;
  iconHash?: string;
}

export interface OidcService {
  /** The providers people may sign in with, in the order of the setting. Nothing but what a button needs. */
  listProviders(): Promise<PublicProvider[]>;
  /** Where the browser goes after the callback: the application root under `BASE_PATH`. Fixed, so there is no open redirect. */
  readonly landing: string;
  /** Where it goes when a link mail was sent instead of a sign-in: the sign-in page with a notice. Fixed as well. */
  readonly checkMailLanding: string;
  /** Starts a login for anyone. 404 for a provider that is not configured, 502 when it cannot be reached. */
  start(providerId: string): Promise<StartedLogin>;
  /** Starts the flow that adds a provider to the signed-in caller's account. Session only. */
  startLink(actor: Actor, providerId: string): Promise<StartedLogin>;
  /**
   * Starts the re-authentication of the caller's current session at a provider they have signed in
   * with (`prompt=login`, `max_age=0`; ADR 0025). Session only. 404 when the account has no sign-in
   * at that provider.
   */
  startReauthentication(actor: Actor, providerId: string): Promise<StartedLogin>;
  /** Completes the login, the link or the re-authentication that this browser started. */
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
  /** What a first sign-in with an address that an account holds does instead of linking (ADR 0026). */
  linking: Pick<OidcLinkService, 'request'>;
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
    return `${ctx.config.ORIGIN}${url(ctx.config.BASE_PATH, `${INTERNAL_PREFIX}/auth/oidc/${providerId}/callback`)}`;
  };

  async function providerOrThrow(id: string): Promise<OidcProvider> {
    const { oidcProviders } = await settings.get();
    const found = oidcProviders.find((provider) => provider.id === id);
    if (!found) throw new NotFound('There is no such sign-in provider.');
    return found;
  }

  /**
   * The client that talks to the provider. Only the code exchange needs the secret, so only it reads
   * the store; a provider without a stored secret is a public client (PKCE only).
   */
  const clientFor = async (provider: OidcProvider, withSecret: boolean) =>
    new OAuth2Client(
      provider.clientId,
      withSecret ? ((await deps.clientSecret(provider.id)) ?? null) : null,
      redirectUri(provider.id),
    );

  /** A refusal the log can explain and the caller cannot learn from. */
  function refuse(providerId: string, reason: Reason, extra: Record<string, unknown> = {}): void {
    ctx.log.warn({ provider: providerId, reason, ...extra }, 'oidc login refused');
  }

  async function begin(
    providerId: string,
    signedIn?: { userId: string; reauthSessionId?: string },
  ): Promise<StartedLogin> {
    const provider = await providerOrThrow(providerId);
    const discovery = await providers.discovery(provider);
    const fresh = await states.create(provider.id, signedIn?.userId, signedIn?.reauthSessionId);
    const url = (await clientFor(provider, false)).createAuthorizationURLWithPKCE(
      discovery.authorizationEndpoint,
      fresh.state,
      CodeChallengeMethod.S256,
      fresh.verifier,
      provider.scopes,
    );
    url.searchParams.set('nonce', fresh.nonce);
    if (signedIn?.reauthSessionId !== undefined) {
      // Ask the provider for a login now, not for its single sign-on session (OIDC Core 3.1.2.1).
      url.searchParams.set('prompt', 'login');
      url.searchParams.set('max_age', '0');
    }
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
    if (found.deletedAt !== null || found.status === 'rejected' || found.status === 'deactivated') {
      throw new Unauthorized(GENERIC_REFUSAL);
    }
    if (found.status === 'pending')
      throw new Forbidden('Your account is waiting for approval.', ACCOUNT_PENDING);
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

  async function addIdentity(found: User, provider: string, subject: string, via: 'profile') {
    await ctx.db.tx((tx) => addIdentityIn(ctx, tx, found, provider, subject, via));
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
        // A provider's word for an address is not enough to enter the account that holds it (ASVS
        // 6.8.1): nothing is linked and nobody is signed in. The holder is mailed a link and confirms
        // it signed in. Every case ends the same way, so the browser learns nothing about the account.
        await deps.linking.request(provider, claims.subject, sameEmail);
        return { kind: 'check-mail' };
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

  /**
   * The callback of a re-authentication. The id_token has passed every check, `auth_time` included.
   * It must be the caller's own sign-in at this provider (the same `sub`), and the session the
   * flow was started for must still be live and theirs.
   */
  async function reauthenticate(
    provider: OidcProvider,
    claims: IdentityClaims,
    userId: string,
    sessionId: string,
  ): Promise<CompletedLogin> {
    const [own] = await ctx.db
      .select({ id: authMethod.id })
      .from(authMethod)
      .where(
        and(
          eq(authMethod.userId, userId),
          eq(authMethod.provider, provider.id),
          eq(authMethod.subject, claims.subject),
        ),
      )
      .limit(1);
    if (!own) {
      refuse(provider.id, 'reauth-other-subject');
      throw new Unauthorized(GENERIC_REFUSAL);
    }
    const found = await users.findById(userId);
    if (!found || found.deletedAt !== null || found.status !== 'active') {
      throw new Unauthorized(GENERIC_REFUSAL);
    }
    await ctx.db.tx(async (tx) => {
      if (!(await sessions.markAuthenticated(userId, sessionId, tx))) {
        refuse(provider.id, 'reauth-session-gone');
        throw new Unauthorized(GENERIC_REFUSAL);
      }
      await ctx.events.emit('identity.session.reauthenticated@1', {
        userId,
        username: found.username,
        method: 'oidc',
      });
    });
    return { kind: 'reauthenticated' };
  }

  return {
    landing: url(ctx.config.BASE_PATH, '/'),
    checkMailLanding: url(ctx.config.BASE_PATH, '/login?notice=check-mail'),

    async listProviders() {
      const { oidcProviders } = await settings.get();
      return oidcProviders.map(({ id, displayName, iconHash }) => ({
        id,
        displayName,
        ...(iconHash ? { iconHash } : {}),
      }));
    },

    start: (providerId) => begin(providerId),

    async startLink(actor, providerId) {
      const caller = requireSession(actor, 'Linking a sign-in provider');
      await authz.require(actor, 'core.identity.auth-method.link');
      // Adding a way to sign in to the account needs a recent authentication (ASVS 7.5.1).
      await sessions.requireRecentAuth(actor);
      return begin(providerId, { userId: caller.userId });
    },

    async startReauthentication(actor, providerId) {
      const caller = requireSession(actor, 'Re-authenticating');
      await authz.require(actor, 'core.identity.session.manage');
      if (caller.sessionId === undefined) throw new Unauthorized();
      const provider = await providerOrThrow(providerId);
      const [own] = await ctx.db
        .select({ id: authMethod.id })
        .from(authMethod)
        .where(and(eq(authMethod.userId, caller.userId), eq(authMethod.provider, provider.id)))
        .limit(1);
      if (!own) throw new NotFound('There is no such sign-in provider.');
      return begin(providerId, { userId: caller.userId, reauthSessionId: caller.sessionId });
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
      const client = await clientFor(provider, true);
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
        // A re-authentication must have happened at the provider after it was asked for.
        ...(stored.purpose === 'reauth'
          ? { authTimeNotBefore: new Date(stored.createdAt.getTime() - CLOCK_SKEW_SECONDS * 1000) }
          : {}),
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

      if (stored.purpose === 'reauth') {
        return reauthenticate(provider, claims, stored.linkUserId!, stored.reauthSessionId!);
      }
      if (stored.purpose === 'link') {
        await link(provider, claims, stored.linkUserId!);
        return { kind: 'linked' };
      }
      return login(provider, claims, input.previousSessionId);
    },
  };
}
