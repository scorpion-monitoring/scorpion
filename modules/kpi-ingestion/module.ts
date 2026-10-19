import { z } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { defineModule, type Db } from '@scorpion/kernel';
import { INDICATOR_USAGE_REGISTRY, type KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { count, eq } from 'drizzle-orm';
import { measurement } from './db/schema.ts';
import { createMeasurementsService, type MeasurementsService } from './service/measurements.ts';
import { PERMISSION_SUBMIT, RESOURCE_SERVICE } from './service/permissions.ts';
import { submitPolicy } from './service/policy.ts';

export type {
  MeasurementInput,
  MeasurementsService,
  RowResult,
  UpsertOptions,
  UpsertResult,
  Verdict,
} from './service/measurements.ts';

/** What the module registers as its service. */
export interface KpiIngestionService {
  /** The measurements of a service: the one write path, `upsertBatch`. */
  measurements: MeasurementsService;
}

// The service types of the dependencies shape `ctx.deps`.
export type KpiIngestionDependencies = [AuthzService, KpiFrameworkPublic, ServicesPublic];

export interface KpiIngestionOptions {
  /** "Now", for the current month a period may not pass. Tests inject a fixed one. */
  clock?: () => Date;
}

/**
 * The event of a recorded batch. Ids, months and counts, never a value and never a name (a test walks this schema). The
 * months are the last days of the months whose values changed, at most 120 (a batch covers no more).
 */
export const measurementRecordedSchema = z.strictObject({
  serviceId: z.uuid(),
  runId: z.uuid().nullable(),
  periods: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(120),
  inserted: z.number().int().min(0),
  updated: z.number().int().min(0),
  actorId: z.uuid().nullable(),
});

/** Builds the manifest. The default export is the one a profile uses. */
export function createKpiIngestionModule(options: KpiIngestionOptions = {}) {
  // The policy and the usage count are contributions made before the module starts; they reach the registry of
  // registry.services and the database through these closures (the pattern of kpi.framework).
  let database: Db | undefined;
  let isProviderMember: ServicesPublic['isProviderMemberAsSystem'] | undefined;
  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('kpi.ingestion: asked before start');
    return value;
  };

  return defineModule<KpiIngestionService, 'core.authz' | 'kpi.framework' | 'registry.services'>({
    id: 'kpi.ingestion',
    version: '0.1.0',
    // `kpii_measurement`, not `kpi_ingestion_measurement` (ADR 0004, ADR-0040; `kpi.framework` has `kpif_`).
    tablePrefix: 'kpii_',

    permissions: {
      [PERMISSION_SUBMIT]: {
        scope: RESOURCE_SERVICE,
        description:
          'Submit measurements for one service (Admin, and the approved members of the service provider through the policy of this module)',
      },
    },

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    events: {
      emits: { 'measurement.recorded@1': measurementRecordedSchema },
    },

    contributes: {
      // Approved members of the service's provider may submit for it; the question is asked of registry.services at every call.
      'authz.resourcePolicy': [
        submitPolicy({
          isProviderMember: () => (userId, serviceId) => need(isProviderMember)(userId, serviceId),
        }),
      ],
      // An indicator with measurements is not deleted: kpi.framework asks, and answers 409 naming this module and the count.
      [INDICATOR_USAGE_REGISTRY]: [
        {
          module: 'kpi.ingestion',
          what: 'measurements',
          async count(indicatorId: string) {
            const [row] = await need(database)
              .select({ n: count() })
              .from(measurement)
              .where(eq(measurement.indicatorId, indicatorId));
            return row?.n ?? 0;
          },
        },
      ],
    },

    services: (ctx) => {
      database = ctx.db;
      isProviderMember = ctx.deps['registry.services'].isProviderMemberAsSystem;
      return {
        measurements: createMeasurementsService(ctx, {
          authz: ctx.deps['core.authz'],
          services: ctx.deps['registry.services'],
          kpi: ctx.deps['kpi.framework'],
          clock: options.clock ?? (() => new Date()),
        }),
      };
    },
  });
}

export default createKpiIngestionModule();
