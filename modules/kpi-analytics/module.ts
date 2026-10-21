import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { registerRoutes } from './routes.ts';
import { createAnalyticsService, type AnalyticsService } from './service/analytics.ts';
import { DEFAULTS_PREFERENCE, storedDefaultsSchema } from './service/defaults.ts';
import { PERMISSION_READ } from './service/permissions.ts';
import {
  AGGREGATE_REGISTRY,
  aggregateEntrySchema,
  BUILTIN_AGGREGATES,
  BUILTIN_SCORES,
  indexEntries,
  SCORE_REGISTRY,
  scoreEntrySchema,
  type AggregateEntry,
  type ScoreEntry,
} from './service/registries.ts';
import { settingsSchema, type AnalyticsSettings } from './settings-schema.ts';

export { settingsSchema, type AnalyticsSettings } from './settings-schema.ts';

/** What the module registers as its service. */
export type KpiAnalyticsService = AnalyticsService;

// The service types of the dependencies shape `ctx.deps`.
export type KpiAnalyticsDependencies = [
  AuthzService,
  SettingsService,
  KpiFrameworkPublic,
  KpiIngestionPublic,
  ServicesPublic,
];

export interface KpiAnalyticsOptions {
  /** "Now", for the current month a window ends with. Tests inject a fixed one. */
  clock?: () => Date;
}

/** Builds the manifest. The default export is the one a profile uses. */
export function createKpiAnalyticsModule(options: KpiAnalyticsOptions = {}) {
  return defineModule<
    KpiAnalyticsService,
    'core.authz' | 'core.settings' | 'kpi.framework' | 'kpi.ingestion' | 'registry.services',
    never,
    AnalyticsSettings
  >({
    id: 'kpi.analytics',
    version: '0.1.0',
    // No table (ADR-0043): the dashboard is a preference of core.settings and everything else is read from other modules.

    permissions: {
      [PERMISSION_READ]: {
        description:
          'Read the series and the summary of a service on the signed-in pages (the dashboard): values month by month, change, average and volatility',
      },
    },

    settings: settingsSchema,

    registries: {
      [AGGREGATE_REGISTRY]: aggregateEntrySchema,
      [SCORE_REGISTRY]: scoreEntrySchema,
    },

    contributes: {
      // Every signed-in person reads the analytics of every service, as the measurements are readable (decision 4 of M10). Admin holds all declared ones.
      'authz.defaultRole': [{ role: 'user', permissions: [PERMISSION_READ] }],
      // What seeds a new widget: service, range and category of the person.
      'settings.userPreference': [
        {
          key: DEFAULTS_PREFERENCE,
          description:
            'Your dashboard defaults: the service, the range and the thematic category a new widget starts with',
          schema: storedDefaultsSchema,
        },
      ],
      [AGGREGATE_REGISTRY]: BUILTIN_AGGREGATES,
      [SCORE_REGISTRY]: BUILTIN_SCORES,
    },

    services: (ctx) => {
      // Two entries with one id stop the start, here and not at the first read.
      const aggregates = indexEntries(
        'aggregate',
        ctx.registry(AGGREGATE_REGISTRY) as AggregateEntry[],
      );
      const scores = indexEntries('score', ctx.registry(SCORE_REGISTRY) as ScoreEntry[]);
      return createAnalyticsService(ctx, {
        authz: ctx.deps['core.authz'],
        settings: ctx.deps['core.settings'],
        services: ctx.deps['registry.services'],
        kpi: ctx.deps['kpi.framework'],
        reads: ctx.deps['kpi.ingestion'].reads,
        aggregates,
        scores,
        clock: options.clock ?? (() => new Date()),
      });
    },

    routes: (r) => {
      registerRoutes(r, r.service<KpiAnalyticsService>());
    },
  });
}

export default createKpiAnalyticsModule();
