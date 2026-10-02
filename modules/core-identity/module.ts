import { z } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import { createAuthenticator } from './authenticator.ts';
import type { IdentityService } from './public.ts';
import { registerIdentityRoutes } from './routes.ts';
import { createAccountService } from './service/accounts.ts';
import { createBootstrapService, type BootstrapService } from './service/bootstrap.ts';
import { createAdminCommand } from './service/create-admin-command.ts';
import { createApprovalService } from './service/approval.ts';
import { createLoginStateService, type LoginStateService } from './service/login-state.ts';
import { createOidcService, type OidcService } from './service/oidc.ts';
import { clientSecretFor, type ClientSecretLookup } from './service/oidc-secret.ts';
import { createProviderClient } from './service/oidc-provider.ts';
import {
  APPROVAL_POLICY_REGISTRY,
  approvalPolicyEntrySchema,
  manualPolicy,
} from './service/approval-policy.ts';
import { createSessionService, type SessionService } from './service/sessions.ts';
import { defaultSettings, settingsSchema, type IdentitySettings } from './service/settings.ts';
import { createTokenService, type TokenService } from './service/tokens.ts';
import { createUserService } from './service/users.ts';
import type { AccountService } from './service/accounts.ts';
import type { ApprovalService } from './service/approval.ts';

export interface IdentityInternals extends IdentityService {
  accounts: AccountService;
  approval: ApprovalService;
  bootstrap: BootstrapService;
  loginStates: LoginStateService;
  oidc: OidcService;
  sessions: SessionService;
  tokens: TokenService;
}

export interface IdentityModuleOptions {
  /** Where the settings come from. Until M3 (core.settings) that is the schema's defaults. */
  settings?: IdentitySettings;
  /** For tests: how long a verified session is trusted without asking the database. */
  sessionCacheTtlMs?: number;
  /** For tests: how long a verified access token is trusted without verifying it again. */
  tokenCacheTtlMs?: number;
  /**
   * Where the first-run token is shown (default: the process's standard error, as plain text).
   * Under `NODE_ENV=test` the default shows nothing, so a test run prints no secret; a test that
   * wants the token passes its own function.
   */
  announce?: (text: string) => void;
  /** For tests: how long a first-run token lives. */
  firstRunTtlMs?: number;
  /**
   * Where an OIDC client secret comes from. The default reads `OIDC_<ID>_CLIENT_SECRET` from the
   * environment (`service/oidc-secret.ts`); M3 changes that default to the secrets store.
   */
  clientSecret?: ClientSecretLookup;
  /** For tests: the HTTP client and timeouts used to talk to OIDC providers. */
  oidcHttp?: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    exchangeTimeoutMs?: number;
    now?: () => number;
  };
}

const toConsole = (text: string) => void process.stderr.write(`${text}\n`);
const toNowhere = () => undefined;

const userEvent = z.strictObject({ userId: z.string(), username: z.string() });
// No token, prefix, hash or scope in an event: it says who did what to which token.
const tokenEvent = z.strictObject({ userId: z.string(), tokenId: z.string(), name: z.string() });

/**
 * Builds the manifest. The default export is the one a profile uses; tests build their own to
 * inject settings. Each manifest keeps its own session and token services, which the authenticator
 * entry (fixed in the manifest) reaches through closures.
 */
export function createIdentityModule(options: IdentityModuleOptions = {}) {
  let current: SessionService | undefined;
  let currentTokens: TokenService | undefined;
  const sessionsOrThrow = (): SessionService => {
    if (!current) throw new Error('core.identity: the session service is not ready');
    return current;
  };
  let currentBootstrap: BootstrapService | undefined;
  const bootstrapOrThrow = (): BootstrapService => {
    if (!currentBootstrap) throw new Error('core.identity: the bootstrap service is not ready');
    return currentBootstrap;
  };
  const tokensOrThrow = (): TokenService => {
    if (!currentTokens) throw new Error('core.identity: the token service is not ready');
    return currentTokens;
  };

  return defineModule<IdentityInternals>({
    id: 'core.identity',
    version: '0.1.0',
    // Short on purpose: the module's tables are `identity_user`, not `core_identity_user` (ADR 0004).
    tablePrefix: 'identity_',

    permissions: {
      'core.identity.session.manage': { description: 'End your own sessions' },
      'core.identity.me.read': { description: 'Read your own account' },
      'core.identity.user.list-pending': { description: 'List accounts waiting for approval' },
      'core.identity.user.approve': { description: 'Approve a pending account' },
      'core.identity.user.reject': { description: 'Reject a pending account' },
      'core.identity.token.read': { description: 'List your own access tokens' },
      'core.identity.token.manage': {
        description: 'Create, revoke and rotate your own access tokens',
      },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    commands: [createAdminCommand(bootstrapOrThrow)],

    events: {
      // A fresh install shows its first-run token once, when it has no active user. It must not
      // stop the start-up if that fails: `scorpion create-admin` still works.
      on: {
        'system.ready': async (_event, ctx) => {
          try {
            await bootstrapOrThrow().issueFirstRunToken();
          } catch (err) {
            ctx.log.warn({ err }, 'could not issue a first-run token');
          }
        },
      },
      emits: {
        'identity.user.registered@1': userEvent.extend({
          status: z.enum(['pending', 'active']),
        }),
        'identity.user.approved@1': userEvent.extend({ approvedBy: z.string() }),
        'identity.user.rejected@1': userEvent.extend({ rejectedBy: z.string() }),
        'identity.admin.created@1': userEvent.extend({ origin: z.enum(['cli', 'first-run']) }),
        'identity.token.created@1': tokenEvent,
        'identity.token.revoked@1': tokenEvent,
        'identity.token.rotated@1': tokenEvent.extend({ previousTokenId: z.string() }),
      },
    },

    registries: { [APPROVAL_POLICY_REGISTRY]: approvalPolicyEntrySchema },
    contributes: {
      [APPROVAL_POLICY_REGISTRY]: [manualPolicy],
      'kernel.authenticator': [
        {
          authenticate: createAuthenticator({ sessions: sessionsOrThrow, tokens: tokensOrThrow }),
        },
      ],
    },

    services: (ctx) => {
      const settings = options.settings ?? defaultSettings;
      const users = createUserService(ctx);
      const sessions = createSessionService(ctx, { cacheTtlMs: options.sessionCacheTtlMs });
      const tokens = createTokenService(ctx, { cacheTtlMs: options.tokenCacheTtlMs });
      current = sessions;
      currentTokens = tokens;
      const bootstrap = createBootstrapService(ctx, {
        users,
        announce: options.announce ?? (process.env.NODE_ENV === 'test' ? toNowhere : toConsole),
        ttlMs: options.firstRunTtlMs,
      });
      currentBootstrap = bootstrap;
      const loginStates = createLoginStateService(ctx);
      const oidc = createOidcService(ctx, {
        users,
        sessions,
        settings,
        states: loginStates,
        providers: createProviderClient({
          fetch: options.oidcHttp?.fetch,
          timeoutMs: options.oidcHttp?.timeoutMs,
          now: options.oidcHttp?.now,
        }),
        clientSecret: options.clientSecret ?? clientSecretFor,
        exchangeTimeoutMs: options.oidcHttp?.exchangeTimeoutMs,
      });
      return {
        bootstrap,
        loginStates,
        oidc,
        users,
        sessions,
        tokens,
        accounts: createAccountService(ctx, { users, sessions, settings }),
        approval: createApprovalService(ctx, { sessions }),
      };
    },

    routes: (r) => {
      const { accounts, approval, bootstrap, tokens } = r.service<IdentityInternals>();
      registerIdentityRoutes(r, { accounts, approval, bootstrap, tokens });
    },
  });
}

export default createIdentityModule();
