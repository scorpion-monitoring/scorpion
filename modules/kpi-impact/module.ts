import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { registerRoutes } from './routes.ts';
import { createImpactService, type ImpactService } from './service/impact.ts';
import { PERMISSION_READ } from './service/permissions.ts';

/** What the module registers as its service. */
export type KpiImpactService = ImpactService;

// The service types of the dependencies shape `ctx.deps`.
export type KpiImpactDependencies = [
  AuthzService,
  SettingsService,
  OrganisationsPublic,
  ServicesPublic,
];

export default defineModule<
  KpiImpactService,
  'core.authz' | 'core.settings' | 'registry.organisations' | 'registry.services'
>({
  id: 'kpi.impact',
  displayName: 'KPI impact',
  version: '0.1.0',
  // No table before sprint 3 (the read model of the yearly table), so no table prefix yet; no `demoSeed` (ADR-0046): the module owns no data.

  permissions: {
    [PERMISSION_READ]: {
      description:
        'Read the impact figures of a consortium: the number of its services, how many are open source and the number per stage; no person, no contact point',
    },
  },

  contributes: {
    // Reviewers and Admin, not the role `user` (FEATURES §3.9, decision 20 of the M12 plan). Admin holds all declared permissions.
    'authz.defaultRole': [{ role: 'reviewer', permissions: [PERMISSION_READ] }],
  },

  services: (ctx) =>
    createImpactService({
      authz: ctx.deps['core.authz'],
      settings: ctx.deps['core.settings'],
      organisations: ctx.deps['registry.organisations'],
      services: ctx.deps['registry.services'],
    }),

  routes: (r) => {
    registerRoutes(r, r.service<KpiImpactService>());
  },
});
