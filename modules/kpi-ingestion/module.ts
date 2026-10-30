import { z } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule, type Db, type JobResult } from '@scorpion/kernel';
import { INDICATOR_USAGE_REGISTRY, type KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { count, eq } from 'drizzle-orm';
import { measurement } from './db/schema.ts';
import { registerIngestionRoutes } from './routes-ingestion.ts';
import { registerRoutes } from './routes.ts';
import { registerV1Routes } from './routes-v1.ts';
import { csvAdapter } from './service/adapter-csv.ts';
import { formAdapter } from './service/adapter-form.ts';
import { xlsxAdapter } from './service/adapter-xlsx.ts';
import {
  ADAPTER_REGISTRY,
  adapterEntrySchema,
  indexAdapters,
  type AdapterEntry,
} from './service/adapters.ts';
import { createDemoSeed, type IngestionDemoDeps } from './service/demo-seed.ts';
import { createIngestionService, type IngestionService } from './service/ingestion.ts';
import { createMeasurementsService, type MeasurementsService } from './service/measurements.ts';
import {
  PERMISSION_INGEST,
  PERMISSION_MEASUREMENT_READ,
  PERMISSION_SUBMIT,
  PERMISSION_V1_READ,
  PERMISSION_V1_WRITE,
  RESOURCE_SERVICE,
} from './service/permissions.ts';
import { createReadsService, type ReadsService } from './service/reads.ts';
import { createReminderService, REMINDER_JOB, type ReminderService } from './service/reminder.ts';
import { settingsSchema } from './settings-schema.ts';
import { TEMPLATES } from './templates/reporting-reminder.ts';
import { submitPolicy } from './service/policy.ts';
import { INGESTION_NAV, INGESTION_ROUTES } from './ui/routes.ts';

export { settingsSchema, type IngestionSettings } from './settings-schema.ts';
export type {
  CoverageMonth,
  GridRow,
  MeasurementRead,
  MonthGrid,
  ReadsService,
  SeriesPoint,
  SeriesQuery,
} from './service/reads.ts';
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
  /** Preview, dry run and commit of a file or a form, the runs and the import templates (sprint 3). */
  ingestion: IngestionService;
  /** The reads: the time series of v1, the grid of a month and the coverage. */
  reads: ReadsService;
  /** The reporting reminder: the body of the daily job (sprint 5). */
  reminder: ReminderService;
}

// The service types of the dependencies shape `ctx.deps`.
export type KpiIngestionDependencies = [
  AuthzService,
  SettingsService,
  NotificationsService,
  IdentityService,
  OrganisationsPublic,
  KpiFrameworkPublic,
  ServicesPublic,
];

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
  // What the demo seed calls, set when the services are built.
  let demoParts: IngestionDemoDeps | undefined;
  let isProviderMember: ServicesPublic['isProviderMemberAsSystem'] | undefined;
  let reminder: ReminderService | undefined;
  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('kpi.ingestion: asked before start');
    return value;
  };

  return defineModule<
    KpiIngestionService,
    | 'core.authz'
    | 'core.settings'
    | 'core.notifications'
    | 'core.identity'
    | 'registry.organisations'
    | 'kpi.framework'
    | 'registry.services'
  >({
    id: 'kpi.ingestion',
    displayName: 'KPI data submission',
    version: '0.1.0',
    // `kpii_measurement`, not `kpi_ingestion_measurement` (ADR 0004, ADR-0040; `kpi.framework` has `kpif_`).
    tablePrefix: 'kpii_',

    permissions: {
      [PERMISSION_SUBMIT]: {
        scope: RESOURCE_SERVICE,
        description:
          'Submit measurements for one service (Admin, and the approved members of the service provider through the policy of this module)',
      },
      [PERMISSION_V1_READ]: {
        description:
          'Read the measurements of a service (`GET /api/v1/measurements`) through the public API, with a token that holds this scope',
      },
      [PERMISSION_V1_WRITE]: {
        description:
          'Record measurements (`POST /api/v1/measurements`) through the public API, with a token that holds this scope; its owner must also be allowed to submit for the service (`kpi.ingestion.measurement.submit`)',
      },
      [PERMISSION_INGEST]: {
        description:
          'Preview and record a file or a form on the signed-in pages (the Data Submission page); the service also checks `kpi.ingestion.measurement.submit` on the service',
      },
      [PERMISSION_MEASUREMENT_READ]: {
        description:
          'Read the values of one month and the coverage of a service on the signed-in pages (the Data Submission page)',
      },
    },

    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    // Another module adds a way to give values (a REST pull, Matomo) by contributing an entry; nothing here branches on an id.
    registries: { [ADAPTER_REGISTRY]: adapterEntrySchema },

    events: {
      emits: { 'measurement.recorded@1': measurementRecordedSchema },
    },

    jobs: [
      {
        // Daily at 06:00 UTC; the handler returns at once unless today is the setting's day (default the 6th). The job page's "run now"
        // is the manual trigger, and `kpii_reminder_sent` makes it safe: a provider and month are mailed once.
        name: REMINDER_JOB,
        schedule: '0 6 * * *',
        retry: { limit: 3, delaySeconds: 600 },
        timeoutSeconds: 900,
        handler: async (job): Promise<JobResult> => {
          const report = await need(reminder).run({ signal: job.signal });
          // Counts only, for the job-run history.
          return Object.fromEntries(
            Object.entries(report).filter(([, value]) => value !== undefined),
          ) as JobResult;
        },
      },
    ],

    // The page (Svelte) is loaded by the web app only; the manifest names the part a server can read (the routes and texts, ui/pages.ts).
    ui: () => import('./ui/pages.ts'),

    contributes: {
      // Every signed-in person reads every service's measurements, as services and KPI definitions are readable (decision 4 of the plan)
      // and holds the plain scope of the write; the scoped `submit` decides who may write for a service. Admin holds all declared ones.
      'authz.defaultRole': [
        {
          role: 'user',
          permissions: [
            PERMISSION_V1_READ,
            PERMISSION_V1_WRITE,
            PERMISSION_MEASUREMENT_READ,
            PERMISSION_INGEST,
          ],
        },
      ],
      // Approved members of the service's provider may submit for it; the question is asked of registry.services at every call.
      'authz.resourcePolicy': [
        submitPolicy({
          isProviderMember: () => (userId, serviceId) => need(isProviderMember)(userId, serviceId),
        }),
      ],
      // The Data Submission page and its link; entries for registries of core.ui-shell, an optional peer.
      'ui.routes': INGESTION_ROUTES,
      'ui.nav': INGESTION_NAV,
      // The reporting reminder moved here from core.notifications with the same key (as the membership mails went to registry.organisations).
      'notify.template': TEMPLATES,
      // The three ways to give values.
      [ADAPTER_REGISTRY]: [formAdapter, csvAdapter, xlsxAdapter],
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

    // `scorpion seed --demo`: six months of measurements for the demo services (ADR-0046).
    demoSeed: (ctx, demo) =>
      createDemoSeed(() => {
        if (!demoParts) throw new Error('kpi.ingestion: the service was asked before start');
        return demoParts;
      })(ctx, demo),

    services: (ctx) => {
      database = ctx.db;
      isProviderMember = ctx.deps['registry.services'].isProviderMemberAsSystem;
      const common = {
        authz: ctx.deps['core.authz'],
        services: ctx.deps['registry.services'],
        kpi: ctx.deps['kpi.framework'],
        clock: options.clock ?? (() => new Date()),
      };
      const measurements = createMeasurementsService(ctx, common);
      // Two entries with one id stop the start, here and not at the first upload.
      const adapters = indexAdapters(ctx.registry(ADAPTER_REGISTRY) as AdapterEntry[]);
      reminder = createReminderService(ctx, {
        organisations: ctx.deps['registry.organisations'],
        services: ctx.deps['registry.services'],
        kpi: ctx.deps['kpi.framework'],
        identity: ctx.deps['core.identity'],
        notifications: ctx.deps['core.notifications'],
        settings: ctx.deps['core.settings'],
        clock: common.clock,
      });
      demoParts = {
        measurements,
        services: ctx.deps['registry.services'],
        kpi: ctx.deps['kpi.framework'],
      };
      return {
        measurements,
        reads: createReadsService(ctx, common),
        ingestion: createIngestionService(ctx, { ...common, measurements, adapters }),
        reminder,
      };
    },

    routes: (r) => {
      const service = r.service<KpiIngestionService>();
      registerV1Routes(r, service.reads, service.measurements);
      registerRoutes(r, service.reads);
      registerIngestionRoutes(r, service.ingestion);
    },
  });
}

export default createKpiIngestionModule();
