import { z } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import { registerKpiRoutes } from './routes.ts';
import { createEvaluationService, type EvaluationService } from './service/evaluation.ts';
import { createIndicatorsService, type IndicatorsService } from './service/indicators.ts';
import {
  PERMISSION_INDICATOR_MANAGE,
  PERMISSION_INDICATOR_READ,
  PERMISSION_SET_MANAGE,
  PERMISSION_SET_READ,
} from './service/permissions.ts';
import { createSetsService, type SetsService } from './service/sets.ts';
import { settingsSchema, type KpiFrameworkSettings } from './settings-schema.ts';
import { KPI_NAV, KPI_ROUTES } from './ui/routes.ts';
import {
  SEED_VALUE_TYPES,
  VALUE_TYPE_REGISTRY,
  valueTypeEntrySchema,
  type ValueTypeEntry,
} from './service/value-types.ts';
import {
  createUsageChecks,
  VOCABULARY_REGISTRY,
  vocabularyContributions,
  type UsageChecks,
} from './service/vocabularies.ts';

export { settingsSchema, type KpiFrameworkSettings } from './settings-schema.ts';

export type { IndicatorsService } from './service/indicators.ts';
export type { SetsService } from './service/sets.ts';
export type { EvaluationService } from './service/evaluation.ts';

/** What the module registers as its service: the three services and the value types. */
export interface KpiFrameworkService {
  indicators: IndicatorsService;
  sets: SetsService;
  evaluation: EvaluationService;
  /** The registered value types (this module's five and any a module contributed), by id. */
  listValueTypes(): readonly ValueTypeEntry[];
  findValueType(id: string): ValueTypeEntry | undefined;
}

// The service types of the dependencies shape `ctx.deps`.
export type KpiFrameworkDependencies = [AuthzService, SettingsService];

const uuid = z.uuid();
const actorId = z.uuid().nullable();
const fieldNames = z.array(z.string().min(1).max(64)).max(30);

/** Builds the manifest. The default export is the one a profile uses. */
export function createKpiFrameworkModule() {
  // The `usage` checks need the database, which exists only once the module starts; the manifest's
  // contribution reaches them through this closure (the pattern of registry.services' `stage`).
  let usage: UsageChecks | undefined;

  return defineModule<
    KpiFrameworkService,
    'core.authz' | 'core.settings',
    never,
    KpiFrameworkSettings
  >({
    id: 'kpi.framework',
    version: '0.1.0',
    // `kpif_indicator`, not `kpi_framework_indicator`; `kpi.ingestion` will use `kpii_` (ADR 0004, ADR-0040).
    tablePrefix: 'kpif_',

    permissions: {
      [PERMISSION_INDICATOR_READ]: {
        description: 'Read indicators and the registered value types',
      },
      [PERMISSION_INDICATOR_MANAGE]: {
        description: 'Create, change and delete indicators',
      },
      [PERMISSION_SET_READ]: {
        description: 'Read KPI sets, their indicators and their evaluation',
      },
      [PERMISSION_SET_MANAGE]: {
        description:
          'Create, change and delete KPI sets, replace their indicators and set their evaluation',
      },
    },

    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    events: {
      // Ids and the names of the changed fields, never a name, a description or a value (a test checks it).
      emits: {
        'kpi.indicator.changed@1': z.strictObject({
          indicatorId: uuid,
          change: z.enum(['created', 'updated', 'deleted']),
          fields: fieldNames,
          actorId,
        }),
        // `fields` names `indicators` when the rows of the set changed and `evaluation` when its headline did.
        'kpi.set.changed@1': z.strictObject({
          setId: uuid,
          change: z.enum(['created', 'updated', 'deleted']),
          fields: fieldNames,
          actorId,
        }),
      },
    },

    // Other modules contribute a value type (a rating, a currency) without a change here.
    registries: {
      [VALUE_TYPE_REGISTRY]: valueTypeEntrySchema,
    },

    // The pages (Svelte) are loaded by the web app only; the manifest just names the entry.
    ui: () => import('./ui/index.ts'),

    contributes: {
      [VALUE_TYPE_REGISTRY]: SEED_VALUE_TYPES,
      [VOCABULARY_REGISTRY]: vocabularyContributions(() => usage),
      // The pages and their links; entries for registries of core.ui-shell, an optional peer.
      'ui.routes': KPI_ROUTES,
      'ui.nav': KPI_NAV,
      // Every signed-in person may read indicators and sets; `manage` stays with Admin, who holds every
      // declared permission without a grant (core.authz).
      'authz.defaultRole': [
        { role: 'user', permissions: [PERMISSION_INDICATOR_READ, PERMISSION_SET_READ] },
      ],
    },

    services: (ctx) => {
      usage = createUsageChecks(ctx.db);
      const types = ctx.registry(VALUE_TYPE_REGISTRY) as ValueTypeEntry[];
      const byId = new Map<string, ValueTypeEntry>();
      for (const entry of types) {
        if (byId.has(entry.id))
          throw new Error(`kpi.framework: the value type "${entry.id}" is contributed twice`);
        byId.set(entry.id, entry);
      }
      const all = [...byId.values()];
      const authz = ctx.deps['core.authz'];
      const settings = ctx.deps['core.settings'];
      const valueTypes = () => all;
      return {
        indicators: createIndicatorsService(ctx, { authz, settings, valueTypes }),
        sets: createSetsService(ctx, { authz, settings }),
        evaluation: createEvaluationService(ctx, { authz, settings, valueTypes }),
        listValueTypes: valueTypes,
        findValueType: (id) => byId.get(id),
      };
    },

    routes: (r) => registerKpiRoutes(r, r.service<KpiFrameworkService>()),
  });
}

export default createKpiFrameworkModule();
