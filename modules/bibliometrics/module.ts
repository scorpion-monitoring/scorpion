import type { AuthzService } from '@scorpion/core-authz/public';
import { createDoiResolver, createStubDoiResolver, type DoiResolver } from '@scorpion/integrations';
import { defineModule } from '@scorpion/kernel';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { registerRoutes } from './routes.ts';
import { createDemoSeed, demoResolver, type BibliometricsDemoDeps } from './service/demo-seed.ts';
import { PERMISSION_READ, PERMISSION_WRITE, RESOURCE_SERVICE } from './service/permissions.ts';
import { writePolicy } from './service/policy.ts';
import { createPublicationsService, type PublicationsService } from './service/publications.ts';
import { settingsSchema, type BibliometricsSettings } from './settings-schema.ts';

export { settingsSchema, type BibliometricsSettings } from './settings-schema.ts';
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
}

// The service types of the dependencies shape `ctx.deps`.
export type BibliometricsDependencies = [AuthzService, ServicesPublic];

export interface BibliometricsOptions {
  /** The DOI resolver. Default: the real one, or the stub (which knows no DOI) under `NODE_ENV=test`. */
  resolver?: DoiResolver;
}

/** Builds the manifest. The default export is the one a profile uses. */
export function createBibliometricsModule(options: BibliometricsOptions = {}) {
  // The policy and the demo seed are contributions made before the module starts; they reach the services through these
  // closures (the pattern of kpi.ingestion).
  let isProviderMember: ServicesPublic['isProviderMemberAsSystem'] | undefined;
  let demoParts: BibliometricsDemoDeps | undefined;
  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('bibliometrics: asked before start');
    return value;
  };

  return defineModule<
    BibliometricsService,
    'core.authz' | 'registry.services',
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

    // Edited with core.settings.write in the settings form; the OpenAlex key (sprint 2) with core.settings.secret.write.
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    // The citation event and the registry `biblio.citationSource` come with sprint 2.
    events: { emits: {} },

    contributes: {
      // Every signed-in person reads the publications of every service, as services are readable.
      'authz.defaultRole': [{ role: 'user', permissions: [PERMISSION_READ] }],
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
      isProviderMember = services.isProviderMemberAsSystem;
      const common = { authz: ctx.deps['core.authz'], services };
      const resolver =
        options.resolver ??
        (process.env.NODE_ENV === 'test' ? createStubDoiResolver() : createDoiResolver());
      const publications = createPublicationsService(ctx, {
        ...common,
        resolver,
        lookupsEnabled: async () => (await ctx.settings.get()).enabled,
      });
      demoParts = {
        services,
        // The seed's own service: its resolver answers from the seed's table, so the seed never reaches the network.
        publications: createPublicationsService(ctx, {
          ...common,
          resolver: demoResolver(),
          lookupsEnabled: () => Promise.resolve(true),
        }),
      };
      return { publications };
    },

    routes: (r) => {
      registerRoutes(r, r.service<BibliometricsService>().publications);
    },
  });
}

export default createBibliometricsModule();
