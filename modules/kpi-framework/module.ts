import { z } from '@scorpion/contracts';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import { settingsSchema, type KpiFrameworkSettings } from './settings-schema.ts';
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

/** What the module registers as its service. Sprint 2 adds the indicator and KPI set methods. */
export interface KpiFrameworkService {
  /** The registered value types (this module's five and any a module contributed), by id. */
  listValueTypes(): readonly ValueTypeEntry[];
  findValueType(id: string): ValueTypeEntry | undefined;
}

// The service types of the dependencies shape `ctx.deps`.
export type KpiFrameworkDependencies = [SettingsService];

const uuid = z.uuid();
const actorId = z.uuid().nullable();
const fieldNames = z.array(z.string().min(1).max(64)).max(30);

/** Builds the manifest. The default export is the one a profile uses. */
export function createKpiFrameworkModule() {
  // The `usage` checks need the database, which exists only once the module starts; the manifest's
  // contribution reaches them through this closure (the pattern of registry.services' `stage`).
  let usage: UsageChecks | undefined;

  return defineModule<KpiFrameworkService, 'core.settings', never, KpiFrameworkSettings>({
    id: 'kpi.framework',
    version: '0.1.0',
    // `kpif_indicator`, not `kpi_framework_indicator`; `kpi.ingestion` will use `kpii_` (ADR 0004, ADR-0040).
    tablePrefix: 'kpif_',

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

    contributes: {
      [VALUE_TYPE_REGISTRY]: SEED_VALUE_TYPES,
      [VOCABULARY_REGISTRY]: vocabularyContributions(() => usage),
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
      return {
        listValueTypes: () => all,
        findValueType: (id) => byId.get(id),
      };
    },
  });
}

export default createKpiFrameworkModule();
