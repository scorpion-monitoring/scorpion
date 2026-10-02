import { defineModule } from '@scorpion/kernel';
import { createSessionAuthenticator } from './authenticator.ts';
import type { IdentityService } from './public.ts';
import { createSessionService, type SessionService } from './service/sessions.ts';
import { createUserService } from './service/users.ts';

export interface IdentityInternals extends IdentityService {
  sessions: SessionService;
}

export interface IdentityModuleOptions {
  /** For tests: how long a verified session is trusted without asking the database. */
  sessionCacheTtlMs?: number;
}

/**
 * Builds the manifest. The default export is the one a profile uses; tests build their own to
 * inject options. Each manifest keeps its own session service, which the authenticator entry
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

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    contributes: {
      'kernel.authenticator': [{ authenticate: createSessionAuthenticator(sessionsOrThrow) }],
    },

    services: (ctx) => {
      const users = createUserService(ctx);
      const sessions = createSessionService(ctx, { cacheTtlMs: options.sessionCacheTtlMs });
      current = sessions;
      return { users, sessions };
    },
  });
}

export default createIdentityModule();
