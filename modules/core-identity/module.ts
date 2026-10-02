import { z } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import { createSessionAuthenticator } from './authenticator.ts';
import type { IdentityService } from './public.ts';
import { registerIdentityRoutes } from './routes.ts';
import { createAccountService } from './service/accounts.ts';
import { createApprovalService } from './service/approval.ts';
import {
  APPROVAL_POLICY_REGISTRY,
  approvalPolicyEntrySchema,
  manualPolicy,
} from './service/approval-policy.ts';
import { createSessionService, type SessionService } from './service/sessions.ts';
import { defaultSettings, settingsSchema, type IdentitySettings } from './service/settings.ts';
import { createUserService } from './service/users.ts';
import type { AccountService } from './service/accounts.ts';
import type { ApprovalService } from './service/approval.ts';

export interface IdentityInternals extends IdentityService {
  accounts: AccountService;
  approval: ApprovalService;
  sessions: SessionService;
}

export interface IdentityModuleOptions {
  /** Where the settings come from. Until M3 (core.settings) that is the schema's defaults. */
  settings?: IdentitySettings;
  /** For tests: how long a verified session is trusted without asking the database. */
  sessionCacheTtlMs?: number;
}

const userEvent = z.strictObject({ userId: z.string(), username: z.string() });

/**
 * Builds the manifest. The default export is the one a profile uses; tests build their own to
 * inject settings. Each manifest keeps its own session service, which the authenticator entry
 * (fixed in the manifest) reaches through `current`.
 */
export function createIdentityModule(options: IdentityModuleOptions = {}) {
  let current: SessionService | undefined;
  const sessionsOrThrow = (): SessionService => {
    if (!current) throw new Error('core.identity: the session service is not ready');
    return current;
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
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    events: {
      emits: {
        'identity.user.registered@1': userEvent.extend({
          status: z.enum(['pending', 'active']),
        }),
        'identity.user.approved@1': userEvent.extend({ approvedBy: z.string() }),
        'identity.user.rejected@1': userEvent.extend({ rejectedBy: z.string() }),
      },
    },

    registries: { [APPROVAL_POLICY_REGISTRY]: approvalPolicyEntrySchema },
    contributes: {
      [APPROVAL_POLICY_REGISTRY]: [manualPolicy],
      'kernel.authenticator': [{ authenticate: createSessionAuthenticator(sessionsOrThrow) }],
    },

    services: (ctx) => {
      const settings = options.settings ?? defaultSettings;
      const users = createUserService(ctx);
      const sessions = createSessionService(ctx, { cacheTtlMs: options.sessionCacheTtlMs });
      current = sessions;
      return {
        users,
        sessions,
        accounts: createAccountService(ctx, { users, sessions, settings }),
        approval: createApprovalService(ctx, { sessions }),
      };
    },

    routes: (r) => {
      const { accounts, approval } = r.service<IdentityInternals>();
      registerIdentityRoutes(r, { accounts, approval });
    },
  });
}

export default createIdentityModule();
