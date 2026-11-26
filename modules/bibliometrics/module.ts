import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import {
  createDoiResolver,
  createOpenAlex,
  createStubDoiResolver,
  createStubOpenAlex,
  type DoiResolver,
  type OpenAlex,
} from '@scorpion/integrations';
import { defineModule, type JobResult } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { registerRoutes } from './routes.ts';
import {
  CITATIONS_UPDATED_EVENT,
  createCitationService,
  REFRESH_JOB,
  type CitationService,
} from './service/citations.ts';
import { createDemoSeed, demoResolver, type BibliometricsDemoDeps } from './service/demo-seed.ts';
import { PERMISSION_READ, PERMISSION_WRITE, RESOURCE_SERVICE } from './service/permissions.ts';
import { writePolicy } from './service/policy.ts';
import { citationsUpdatedSchema } from './service/events.ts';
import { refreshJobDataSchema, runRefreshJob } from './service/job.ts';
import { kpiSettingCheck, type KpiWriteDeps } from './service/kpi-write.ts';
import {
  createMetadataStore,
  createPublicationsService,
  type PublicationsService,
} from './service/publications.ts';
import {
  CITATION_SOURCE_REGISTRY,
  citationSourceEntrySchema,
  indexSources,
  OPENALEX_KEY_SECRET,
  openAlexSource,
  type CitationSourceEntry,
  type OpenAlexSourceDeps,
} from './service/sources.ts';
import { settingsSchema, type BibliometricsSettings } from './settings-schema.ts';

export { settingsSchema, type BibliometricsSettings } from './settings-schema.ts';
export { citationsUpdatedSchema } from './service/events.ts';
export type {
  CitationService,
  History,
  HistoryPoint,
  RefreshReport,
  ServiceCitations,
} from './service/citations.ts';
export type { CitationSourceEntry, SourceCounts } from './service/sources.ts';
export type {
  Publication,
  PublicationMetadata,
  PublicationPage,
  PublicationsService,
} from './service/publications.ts';

/** The module id, which is also the settings key and the start of its secrets' names. */
export const MODULE_ID = 'bibliometrics';

/** What the module registers as its service. */
export interface BibliometricsService {
  /** Add, list and remove the publications of a service. */
  publications: PublicationsService;
  /** The citation refresh, "check now" and the history of a publication. */
  citations: CitationService;
}

// The service types of the dependencies shape `ctx.deps`.
export type BibliometricsDependencies = [
  AuthzService,
  SettingsService,
  ServicesPublic,
  KpiFrameworkPublic,
  KpiIngestionPublic,
];

export interface BibliometricsOptions {
  /** The DOI resolver. Default: the real one, or the stub (which knows no DOI) under `NODE_ENV=test`. */
  resolver?: DoiResolver;
  /**
   * The OpenAlex adapter for a key (or none). Default: the real one, or the stub (which knows no DOI) under
   * `NODE_ENV=test`.
   */
  openAlex?: (apiKey: string | undefined) => OpenAlex;
  /** "Now", for the 10-minute rule and the snapshot times. Default: the system clock. */
  clock?: () => Date;
}

/** Builds the manifest. The default export is the one a profile uses. */
export function createBibliometricsModule(options: BibliometricsOptions = {}) {
  // The policy and the demo seed are contributions made before the module starts; they reach the services through these
  // closures (the pattern of kpi.ingestion).
  let isProviderMember: ServicesPublic['isProviderMemberAsSystem'] | undefined;
  let demoParts: BibliometricsDemoDeps | undefined;
  let citations: CitationService | undefined;
  let openAlexParts: OpenAlexSourceDeps | undefined;
  let kpiParts: KpiWriteDeps | undefined;
  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('bibliometrics: asked before start');
    return value;
  };

  return defineModule<
    BibliometricsService,
    'core.authz' | 'core.settings' | 'registry.services' | 'kpi.framework' | 'kpi.ingestion',
    never,
    BibliometricsSettings
  >({
    id: MODULE_ID,
    displayName: 'Publications and citations',
    version: '0.1.0',
    // `biblio_publication`, not `bibliometrics_publication` (ADR-0004, ADR-0056 Decision 1).
    tablePrefix: 'biblio_',

    permissions: {
      [PERMISSION_READ]: {
        description:
          'Read the publications of a service; also the plain check of adding and removing one, where the service checks `bibliometrics.publication.write` on the service',
      },
      [PERMISSION_WRITE]: {
        scope: RESOURCE_SERVICE,
        description:
          'Add and remove the publications of one service (Admin, and the approved members of the service provider through the policy of this module)',
      },
    },

    // Edited with core.settings.write in the settings form; the optional OpenAlex key (the secret
    // `bibliometrics.openalex-api-key`) with core.settings.secret.write or `pnpm scorpion set-secret`.
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    // Where citation counts come from; another module adds a source by contributing an entry. Nothing here branches on an id.
    registries: { [CITATION_SOURCE_REGISTRY]: citationSourceEntrySchema },

    events: {
      // One per run of a source: ids and counts only. Nothing listens yet.
      emits: { [CITATIONS_UPDATED_EVENT]: citationsUpdatedSchema },
    },

    jobs: [
      {
        // Weekly, Monday 04:00 UTC, for every service; "check now" queues it for one. One slice of at most 2,000 DOIs per
        // run, then the next slice is queued. With `kpi.indicatorId` set, each slice also writes the citation totals of the
        // services it finishes as their Bibliographic KPI (the report's `kpi*` counts). The job page lists the runs.
        name: REFRESH_JOB,
        schedule: '0 4 * * 1',
        data: refreshJobDataSchema,
        retry: { limit: 2, delaySeconds: 900 },
        timeoutSeconds: 1800,
        handler: (job, ctx): Promise<JobResult> =>
          runRefreshJob(job, need(citations), (data) => ctx.jobs.enqueue(REFRESH_JOB, data)),
      },
    ],

    contributes: {
      // Every signed-in person reads the publications of every service, as services are readable.
      'authz.defaultRole': [{ role: 'user', permissions: [PERMISSION_READ] }],
      // OpenAlex, the one built-in citation source.
      [CITATION_SOURCE_REGISTRY]: [openAlexSource(() => need(openAlexParts))],
      // `kpi.indicatorId` must name a numeric indicator in the category Bibliographic: a 422 on save, not only the picker (ADR-0057).
      'settings.check': [{ module: MODULE_ID, check: kpiSettingCheck(() => need(kpiParts)) }],
      // Approved members of the service's provider may change its publications; asked of registry.services at every call.
      'authz.resourcePolicy': [
        writePolicy({
          isProviderMember: () => (userId, serviceId) => need(isProviderMember)(userId, serviceId),
        }),
      ],
    },

    // `scorpion seed --demo`: three fictional publications on two demo services, no network call (ADR-0046).
    demoSeed: (ctx, demo) => createDemoSeed(() => need(demoParts))(ctx, demo),

    services: (ctx) => {
      const services = ctx.deps['registry.services'];
      const settingsService = ctx.deps['core.settings'];
      isProviderMember = services.isProviderMemberAsSystem;
      const testing = process.env.NODE_ENV === 'test';
      openAlexParts = {
        client:
          options.openAlex ??
          (testing ? () => createStubOpenAlex() : (apiKey) => createOpenAlex({ apiKey })),
        // Trusted read of the secrets store; the key goes only into the Authorization header.
        apiKey: () => settingsService.getSecret(OPENALEX_KEY_SECRET),
      };
      const common = { authz: ctx.deps['core.authz'], services };
      // The Bibliographic KPI: trusted reads of kpi.framework and the trusted write of kpi.ingestion, called by the refresh only.
      kpiParts = {
        kpi: ctx.deps['kpi.framework'],
        measurements: ctx.deps['kpi.ingestion'].measurements,
      };
      const resolver =
        options.resolver ?? (testing ? createStubDoiResolver() : createDoiResolver());
      // Two sources with one id stop the start.
      const sources = indexSources(ctx.registry(CITATION_SOURCE_REGISTRY) as CitationSourceEntry[]);
      citations = createCitationService(ctx, {
        ...common,
        sources: () => sources,
        settings: () => ctx.settings.get(),
        metadata: createMetadataStore(ctx, resolver),
        enqueue: (data) => ctx.jobs.enqueue(REFRESH_JOB, data),
        kpi: kpiParts,
        ...(options.clock ? { clock: options.clock } : {}),
      });
      const publications = createPublicationsService(ctx, {
        ...common,
        resolver,
        lookupsEnabled: async () => (await ctx.settings.get()).enabled,
        citations,
      });
      demoParts = {
        services,
        // The seed's citations: its one source answers from the seed's table, and its clock is the snapshot's date.
        citations: (source, now) =>
          createCitationService(ctx, {
            ...common,
            sources: () => [source],
            settings: async () => ({ ...(await ctx.settings.get()), enabled: true }),
            metadata: createMetadataStore(ctx, demoResolver()),
            enqueue: () => Promise.resolve(),
            clock: () => now,
          }),
        // The seed's own service: its resolver answers from the seed's table, so the seed never reaches the network.
        publications: createPublicationsService(ctx, {
          ...common,
          resolver: demoResolver(),
          lookupsEnabled: () => Promise.resolve(true),
          citations,
        }),
      };
      return { publications, citations };
    },

    routes: (r) => {
      const service = r.service<BibliometricsService>();
      registerRoutes(r, service.publications, service.citations);
    },
  });
}

export default createBibliometricsModule();
