// The service of core.audit: one object that the module's sink, subscriber, jobs and routes use.
import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { ModuleContext } from '@scorpion/kernel';
import type { AuditSettings } from '../settings-schema.ts';
import { createRetention, type RetentionService } from './retention.ts';
import { createStore, type Store } from './store.ts';
import { createSystem, type SystemService } from './system.ts';
import { createViewer, type ViewerService } from './viewer.ts';

/** What the module's own code and its routes use. `public.ts` exposes nothing yet: nobody calls the trail directly (ADR 0021). */
export interface AuditInternals {
  store: Store;
  viewer: ViewerService;
  system: SystemService;
  retention: RetentionService;
}

export function createAuditService(
  ctx: ModuleContext,
  deps: {
    authz: Pick<AuthzService, 'require'>;
    identity: { users: Pick<IdentityService['users'], 'findById'> };
  },
): AuditInternals {
  const settings = () => ctx.settings.get() as Promise<AuditSettings>;
  const store = createStore({ db: ctx.db, settings });
  return {
    store,
    viewer: createViewer({
      db: ctx.db,
      authz: deps.authz,
      settings,
      store,
      usernames: async (ids) => {
        const found = await Promise.all(ids.map((id) => deps.identity.users.findById(id)));
        return new Map(
          found.flatMap((user, i) => (user ? [[ids[i]!, user.username] as const] : [])),
        );
      },
    }),
    system: createSystem({ db: ctx.db, authz: deps.authz, store }),
    retention: createRetention({ db: ctx.db, settings }),
  };
}
