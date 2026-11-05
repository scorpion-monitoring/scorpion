import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import { AGGREGATE_REGISTRY, type AggregateEntry } from '@scorpion/kpi-analytics/public';
import type { KpiAnalyticsPublic } from '@scorpion/kpi-analytics/public';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
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
  KpiFrameworkPublic,
  KpiIngestionPublic,
  KpiAnalyticsPublic,
];

export interface KpiImpactOptions {
  /** "Now", for the current year the table offers. Tests inject a fixed one. */
  clock?: () => Date;
}

/** Builds the manifest. The default export is the one a profile uses. */
export function createKpiImpactModule(options: KpiImpactOptions = {}) {
  return defineModule<
    KpiImpactService,
    | 'core.authz'
    | 'core.settings'
    | 'registry.organisations'
    | 'registry.services'
    | 'kpi.framework'
    | 'kpi.ingestion'
    | 'kpi.analytics'
  >({
    id: 'kpi.impact',
    displayName: 'KPI impact',
    version: '0.1.0',
    // No table before sprint 3 (the read model of the yearly table), so no table prefix yet; no `demoSeed` (ADR-0046): the module owns no data.

    permissions: {
      [PERMISSION_READ]: {
        description:
          'Read the impact figures of a consortium: the number of its services, how many are open source, the number per stage and the yearly table of one headline KPI per service; no person, no contact point',
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
        kpi: ctx.deps['kpi.framework'],
        reads: ctx.deps['kpi.ingestion'].reads,
        // The functions of the aggregates are entries of the registry of kpi.analytics, a dependency; never a switch on a name.
        aggregates: new Map(
          (ctx.registry(AGGREGATE_REGISTRY) as AggregateEntry[]).map((entry) => [entry.id, entry]),
        ),
        clock: options.clock ?? (() => new Date()),
        onRowError: (error, serviceId) =>
          ctx.log.warn(
            { err: error, serviceId },
            'kpi.impact: the row of a service could not be computed',
          ),
      }),

    routes: (r) => {
      registerRoutes(r, r.service<KpiImpactService>());
    },
  });
}

export default createKpiImpactModule();
