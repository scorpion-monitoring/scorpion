import { z } from '@scorpion/contracts';
import {
  createPwnedPasswords,
  createStubPwnedPasswords,
  type PwnedPasswords,
} from '@scorpion/integrations';
import { defineModule, type ModuleContext } from '@scorpion/kernel';
import { createAuthenticator } from './authenticator.ts';
import type { IdentityService } from './public.ts';
import { registerIdentityRoutes } from './routes.ts';
import { createAccountService } from './service/accounts.ts';
import { createBootstrapService, type BootstrapService } from './service/bootstrap.ts';
import { createAdminCommand } from './service/create-admin-command.ts';
import { createApprovalService } from './service/approval.ts';
import { createCleanupService, type CleanupService } from './service/cleanup.ts';
import { createProfileService, type ProfileService } from './service/profile.ts';
import { createRecoveryService, type RecoveryService } from './service/recovery.ts';
import { createIdentityMail } from './service/identity-mail.ts';
import { createLoginThrottle } from './service/login-throttle.ts';
import { createPasswordPolicy } from './service/password-policy.ts';
import { createMailBudget } from './service/mail-budget.ts';
import { createMailLinks } from './service/mail-links.ts';
import { IDENTITY_TEMPLATES } from './service/mail-templates.ts';
import { createLoginStateService, type LoginStateService } from './service/login-state.ts';
import { createOidcLinkService, type OidcLinkService } from './service/oidc-link.ts';
import { createOidcService, type OidcService } from './service/oidc.ts';
import {
  clientSecretFrom,
  clientSecretName,
  type ClientSecretLookup,
} from './service/oidc-secret.ts';
import { createProviderClient } from './service/oidc-provider.ts';
import {
  APPROVAL_POLICY_REGISTRY,
  approvalPolicyEntrySchema,
  manualPolicy,
} from './service/approval-policy.ts';
import { createRoleService, type RoleService } from './service/roles.ts';
import { createSessionAdminService, type SessionAdminService } from './service/session-admin.ts';
import { createSessionService, type SessionService } from './service/sessions.ts';
import {
  settingsSchema,
  type IdentitySettings,
  type IdentitySettingsValues,
} from './service/settings.ts';
import { createTokenService, type TokenService } from './service/tokens.ts';
import { createUserService } from './service/users.ts';
import type { AccountService } from './service/accounts.ts';
import type { ApprovalService } from './service/approval.ts';

export { settingsSchema, type IdentitySettings } from './service/settings.ts';

export interface IdentityInternals extends IdentityService {
  accounts: AccountService;
  approval: ApprovalService;
  bootstrap: BootstrapService;
  cleanup: CleanupService;
  loginStates: LoginStateService;
  oidc: OidcService;
  oidcLink: OidcLinkService;
  profile: ProfileService;
  recovery: RecoveryService;
  roles: RoleService;
  sessionAdmin: SessionAdminService;
  sessions: SessionService;
  tokens: TokenService;
}

export interface IdentityModuleOptions {
  /** Where the settings come from. Default: `ctx.settings`, the values saved through core.settings. */
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
   * The breach service behind the password check. The default is the Have I Been Pwned range API;
   * under `NODE_ENV=test` it is a stub that knows no password and never calls out, so no test
   * reaches the network.
   */
  pwned?: PwnedPasswords;
  /**
   * Where an OIDC client secret comes from. The default is the secrets store of core.settings
   * (`service/oidc-secret.ts`); there is no environment fallback.
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

/** What the role `user` holds: every self-service permission of this module (README, "Roles"). */
export const USER_PERMISSIONS = [
  'core.identity.me.read',
  'core.identity.session.manage',
  'core.identity.profile.read',
  'core.identity.profile.update',
  'core.identity.avatar.update',
  'core.identity.password.change',
  'core.identity.email.verify',
  'core.identity.auth-method.link',
  'core.identity.token.read',
  'core.identity.token.manage',
];

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
  let currentCleanup: CleanupService | undefined;
  const cleanupOrThrow = (): CleanupService => {
    if (!currentCleanup) throw new Error('core.identity: the cleanup service is not ready');
    return currentCleanup;
  };
  let currentUsers: ReturnType<typeof createUserService> | undefined;
  const usersOrThrow = () => {
    if (!currentUsers) throw new Error('core.identity: the user service is not ready');
    return currentUsers;
  };
  const tokensOrThrow = (): TokenService => {
    if (!currentTokens) throw new Error('core.identity: the token service is not ready');
    return currentTokens;
  };

  let currentSettings: IdentitySettings | undefined;
  let currentSecret: ClientSecretLookup | undefined;
  /**
   * Names, in the start-up log, the providers that have no stored client secret and therefore run as
   * public clients (PKCE only). Names only: a secret is never read into the log.
   */
  async function reportProvidersWithoutSecret(log: ModuleContext['log']) {
    if (!currentSettings || !currentSecret) return;
    const { oidcProviders } = await currentSettings.get();
    const without: string[] = [];
    for (const provider of oidcProviders) {
      if ((await currentSecret(provider.id)) === undefined) without.push(provider.id);
    }
    if (without.length > 0) {
      log.info(
        { providers: without, secrets: without.map(clientSecretName) },
        'OIDC providers without a stored client secret run as public clients (set one with: scorpion set-secret <secret>)',
      );
    }
  }

  return defineModule<
    IdentityInternals,
    'core.authz' | 'core.settings' | 'core.blob' | 'core.notifications',
    never,
    IdentitySettingsValues
  >({
    id: 'core.identity',
    version: '0.1.0',
    // Short on purpose: the module's tables are `identity_user`, not `core_identity_user` (ADR 0004).
    tablePrefix: 'identity_',

    permissions: {
      'core.identity.session.manage': {
        description: 'List and end your own sessions, and confirm your identity again',
      },
      'core.identity.session.manage-any': {
        description: 'End the sessions of any user, or of everybody, not only your own',
      },
      'core.identity.me.read': { description: 'Read your own account' },
      'core.identity.user.list-pending': { description: 'List accounts waiting for approval' },
      'core.identity.user.approve': { description: 'Approve a pending account' },
      'core.identity.user.reject': { description: 'Reject a pending account' },
      'core.identity.auth-method.link': {
        description: 'Add a sign-in provider (OIDC) to your own account',
      },
      'core.identity.profile.read': { description: 'Read your own profile' },
      'core.identity.profile.update': { description: 'Edit your own profile' },
      'core.identity.avatar.update': { description: 'Set and remove your own avatar' },
      'core.identity.password.change': { description: 'Change your own password' },
      'core.identity.email.verify': {
        description: 'Ask for a new confirmation mail for your own address',
      },
      'core.identity.token.read': { description: 'List your own access tokens' },
      'core.identity.token.manage': {
        description: 'Create, revoke and rotate your own access tokens',
      },
      'core.identity.token.manage-any': {
        description: "Revoke any user's access token, not only your own",
      },
      'core.identity.role.read': { description: 'List the roles and the permissions they hold' },
      'core.identity.role.assign': { description: 'Give a role to a user and take it away' },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    commands: [createAdminCommand(bootstrapOrThrow)],

    jobs: [
      {
        name: 'core.identity.cleanup',
        schedule: '0 * * * *', // hourly, UTC
        retry: { limit: 2, delaySeconds: 60 },
        timeoutSeconds: 300,
        handler: async (_job, ctx) => {
          const result = await cleanupOrThrow().run();
          // Counts only: no id, username or address.
          ctx.log.info(result, 'identity cleanup finished');
        },
      },
    ],

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
          try {
            await reportProvidersWithoutSecret(ctx.log);
          } catch (err) {
            ctx.log.warn({ err }, 'could not check the OIDC client secrets');
          }
        },
      },
      emits: {
        'identity.user.registered@1': userEvent.extend({
          status: z.enum(['pending', 'active']),
        }),
        // `role` is the key of the role the account got with the approval.
        'identity.user.approved@1': userEvent.extend({ approvedBy: z.string(), role: z.string() }),
        'identity.user.rejected@1': userEvent.extend({ rejectedBy: z.string() }),
        'identity.authMethod.linked@1': userEvent.extend({
          provider: z.string(),
          via: z.enum(['email', 'profile']),
        }),
        // A first sign-in at a provider found an account that holds the address; its holder was mailed a link (ADR 0026). Nothing was linked.
        'identity.authMethod.linkRequested@1': userEvent.extend({ provider: z.string() }),
        'identity.password.resetRequested@1': userEvent,
        'identity.password.reset@1': userEvent,
        'identity.password.changed@1': userEvent,
        // The caller proved who they are again in their session; `method` is how (never a credential).
        'identity.session.reauthenticated@1': userEvent.extend({
          method: z.enum(['password', 'oidc']),
        }),
        // An administrator ended the sessions of one user (`count` were open) or of everybody.
        'identity.sessions.revoked@1': userEvent.extend({
          revokedBy: z.string(),
          count: z.number().int().min(0),
        }),
        'identity.sessions.revokedAll@1': z.strictObject({
          revokedBy: z.string(),
          count: z.number().int().min(0),
        }),
        'identity.email.verified@1': userEvent,
        // Which fields changed, never their values. `email` means a change was asked for.
        // After the retention period (ADR 0013): subscribers delete or anonymise what refers to the user.
        'identity.user.purged@1': userEvent,
        'identity.profile.updated@1': userEvent.extend({
          fields: z.array(z.enum(['displayName', 'bio', 'email', 'avatar'])).min(1),
        }),
        'identity.admin.created@1': userEvent.extend({ origin: z.enum(['cli', 'first-run']) }),
        'identity.token.created@1': tokenEvent,
        // `revokedBy` is the caller; it differs from `userId` when an administrator revoked it.
        'identity.token.revoked@1': tokenEvent.extend({ revokedBy: z.string() }),
        'identity.token.rotated@1': tokenEvent.extend({ previousTokenId: z.string() }),
      },
    },

    registries: { [APPROVAL_POLICY_REGISTRY]: approvalPolicyEntrySchema },
    contributes: {
      [APPROVAL_POLICY_REGISTRY]: [manualPolicy],
      // The mails of this module. The rendering, the layout and the delivery are core.notifications'.
      'notify.template': IDENTITY_TEMPLATES,
      // How core.notifications finds the address of the administrator who asks for a test mail.
      'notify.recipientAddress': [
        {
          id: 'core.identity',
          addressOf: async (userId: string) =>
            (await usersOrThrow().findById(userId))?.email ?? null,
        },
      ],
      // What the role `user` can do once an account is approved: the self-service routes of this
      // module. Admin holds everything by resolution; Reviewer gets nothing from identity (its
      // permissions come from the modules that review things).
      'authz.defaultRole': [{ role: 'user', permissions: USER_PERMISSIONS }],
      'kernel.authenticator': [
        {
          authenticate: createAuthenticator({ sessions: sessionsOrThrow, tokens: tokensOrThrow }),
        },
      ],
    },

    services: (ctx) => {
      const authz = ctx.deps['core.authz'];
      const settings: IdentitySettings = options.settings ?? { get: () => ctx.settings.get() };
      const clientSecret = options.clientSecret ?? clientSecretFrom(ctx.deps['core.settings']);
      const mail = createIdentityMail({
        notifications: ctx.deps['core.notifications'],
        settings: ctx.deps['core.settings'],
      });
      const links = createMailLinks(ctx.config);
      const settingsService = ctx.deps['core.settings'];
      const policy = createPasswordPolicy(ctx, {
        settings,
        names: async () => {
          const branding = await settingsService.getBranding();
          return { instanceName: branding.instanceName, productName: branding.productName };
        },
        pwned:
          options.pwned ??
          (process.env.NODE_ENV === 'test' ? createStubPwnedPasswords() : createPwnedPasswords()),
      });
      const throttle = createLoginThrottle(ctx, { settings });
      const budget = createMailBudget(ctx, settings);
      const blob = ctx.deps['core.blob'];
      currentSettings = settings;
      currentSecret = clientSecret;
      const users = createUserService(ctx);
      currentUsers = users;
      const sessions = createSessionService(
        ctx,
        { settings },
        { cacheTtlMs: options.sessionCacheTtlMs },
      );
      const tokens = createTokenService(ctx, { cacheTtlMs: options.tokenCacheTtlMs, authz });
      current = sessions;
      currentTokens = tokens;
      const bootstrap = createBootstrapService(ctx, {
        users,
        authz,
        announce: options.announce ?? (process.env.NODE_ENV === 'test' ? toNowhere : toConsole),
        ttlMs: options.firstRunTtlMs,
        policy,
      });
      currentBootstrap = bootstrap;
      const loginStates = createLoginStateService(ctx);
      const oidcLink = createOidcLinkService(ctx, {
        authz,
        users,
        sessions,
        settings,
        mail,
        budget,
        links,
      });
      const oidc = createOidcService(ctx, {
        authz,
        users,
        sessions,
        settings,
        states: loginStates,
        providers: createProviderClient({
          fetch: options.oidcHttp?.fetch,
          timeoutMs: options.oidcHttp?.timeoutMs,
          now: options.oidcHttp?.now,
        }),
        clientSecret,
        linking: oidcLink,
        exchangeTimeoutMs: options.oidcHttp?.exchangeTimeoutMs,
      });
      const recovery = createRecoveryService(ctx, {
        sessions,
        settings,
        mail,
        budget,
        links,
        authz,
        policy,
        throttle,
      });
      const cleanup = createCleanupService(ctx, {
        authz,
        blob,
        notifications: ctx.deps['core.notifications'],
        settings,
      });
      currentCleanup = cleanup;
      return {
        bootstrap,
        cleanup,
        profile: createProfileService(ctx, { recovery, mail, authz, blob, settings, sessions }),
        roles: createRoleService({ authz, users }),
        recovery,
        loginStates,
        oidc,
        oidcLink,
        users,
        sessions,
        sessionAdmin: createSessionAdminService(ctx, { sessions, users, authz }),
        requireRecentAuth: (actor, maxAgeSeconds) =>
          sessions.requireRecentAuth(actor, maxAgeSeconds),
        tokens,
        accounts: createAccountService(ctx, {
          users,
          sessions,
          settings,
          recovery,
          mail,
          budget,
          links,
          authz,
          passwords: policy,
          throttle,
        }),
        approval: createApprovalService(ctx, { sessions, authz, mail, links }),
      };
    },

    routes: (r) => {
      const {
        accounts,
        approval,
        bootstrap,
        oidc,
        oidcLink,
        profile,
        recovery,
        roles,
        sessionAdmin,
        tokens,
      } = r.service<IdentityInternals>();
      registerIdentityRoutes(r, {
        accounts,
        approval,
        bootstrap,
        oidc,
        oidcLink,
        profile,
        recovery,
        roles,
        sessionAdmin,
        tokens,
      });
    },
  });
}

export default createIdentityModule();
