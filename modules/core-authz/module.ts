import { z } from '@scorpion/contracts';
import { defineModule, type AuthorizationRequest } from '@scorpion/kernel';
import type { AuthzService } from './public.ts';
import { registerAuthzRoutes } from './routes.ts';
import { createAuthzService, type AuthzInternals } from './service/authz.ts';
import {
  DEFAULT_ROLE_REGISTRY,
  defaultRoleEntrySchema,
  RESOURCE_POLICY_REGISTRY,
  resourcePolicyEntrySchema,
} from './service/registries.ts';

export type { AuthzInternals } from './service/authz.ts';

const roleEvent = z.strictObject({
  userId: z.string(),
  roleKey: z.string(),
  actorId: z.string().nullable(),
});

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

    events: {
      // User id, role key and who did it (`null` for the system); never a permission list or a secret.
      emits: {
        'authz.role.assigned@1': roleEvent,
        'authz.role.removed@1': roleEvent,
        // The role key and the permission strings added and removed (sorted), and who did it.
        'authz.role.permissions.changed@1': z.strictObject({
          roleKey: z.string(),
          added: z.array(z.string()),
          removed: z.array(z.string()),
          actorId: z.string().nullable(),
        }),
      },
    },

    registries: {
      [DEFAULT_ROLE_REGISTRY]: defaultRoleEntrySchema,
      [RESOURCE_POLICY_REGISTRY]: resourcePolicyEntrySchema,
    },
    contributes: {
      'kernel.authorizer': [
        {
          // ADR 0005, 0014 and 0015. A token passes only for scope ∩ owner (see service/authz.ts).
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

    routes: (r) => registerAuthzRoutes(r, r.service<AuthzInternals & AuthzService>()),
  });
}

export default createAuthzModule();
