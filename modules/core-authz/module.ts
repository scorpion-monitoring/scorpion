import { defineModule, type AuthorizationRequest } from '@scorpion/kernel';
import type { AuthzService } from './public.ts';
import { createAuthzService, type AuthzInternals } from './service/authz.ts';
import {
  DEFAULT_ROLE_REGISTRY,
  defaultRoleEntrySchema,
  RESOURCE_POLICY_REGISTRY,
  resourcePolicyEntrySchema,
} from './service/registries.ts';

export type { AuthzInternals } from './service/authz.ts';

export interface AuthzModuleOptions {
  /** For tests: how long one process trusts the permissions it has resolved. */
  cacheTtlMs?: number;
  /** For tests: the clock of the cache. */
  now?: () => number;
}

/**
 * Builds the manifest. The default export is the one a profile uses; tests build their own to tune
 * the cache. The authoriser entry is fixed in the manifest and reaches the service through a closure.
 */
export function createAuthzModule(options: AuthzModuleOptions = {}) {
  let current: AuthzInternals | undefined;
  const serviceOrThrow = (): AuthzInternals => {
    if (!current) throw new Error('core.authz: the service is not ready');
    return current;
  };

  return defineModule<AuthzInternals & AuthzService>({
    id: 'core.authz',
    version: '0.1.0',
    // Short on purpose: the module's tables are `authz_role`, not `core_authz_role` (ADR 0004).
    tablePrefix: 'authz_',

    permissions: {
      'core.authz.role.read': { description: 'List roles and the roles of other users' },
      'core.authz.role.assign': { description: 'Give a role to a user and take it away' },
      'core.authz.role.manage': { description: 'Change which permissions a role holds' },
    },

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    registries: {
      [DEFAULT_ROLE_REGISTRY]: defaultRoleEntrySchema,
      [RESOURCE_POLICY_REGISTRY]: resourcePolicyEntrySchema,
    },
    contributes: {
      'kernel.authorizer': [
        {
          // ADR 0005 and 0014. Token scopes are intersected in sprint 2 (see service/authz.ts).
          authorize: ({ actor, permission }: AuthorizationRequest) =>
            serviceOrThrow().authorizeRoute(actor, permission),
        },
      ],
    },

    services: async (ctx) => {
      const service = createAuthzService(ctx, options);
      current = service;
      await service.seed();
      return service;
    },
  });
}

export default createAuthzModule();
