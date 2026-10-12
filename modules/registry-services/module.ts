import { z } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { BlobService } from '@scorpion/core-blob/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { createSpdx, createStubSpdx, type Spdx } from '@scorpion/integrations';
import { defineModule } from '@scorpion/kernel';
import {
  ORG_TYPE_REGISTRY,
  ORG_USAGE_REGISTRY,
  type OrgTypeEntry,
  type OrgUsageEntry,
} from '@scorpion/registry-organisations/public';
import { count, eq } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import { FIELDS } from './config/fields.ts';
import { STEPS } from './config/steps.ts';
import type { ServicesConfig } from './config/types.ts';
import { validateServicesConfig } from './config/validate.ts';
import { service as serviceTable, serviceOrganisation } from './db/schema.ts';
import { registerServiceRoutes } from './routes.ts';
import { SEED_FACETS } from './service/facets.ts';
import { SEED_FIELD_TYPES } from './service/field-types.ts';
import { createLicenseCache } from './service/licences.ts';
import { PERMISSION_MANAGE, PERMISSION_READ } from './service/permissions.ts';
import {
  facetEntrySchema,
  fieldTypeEntrySchema,
  FACET_REGISTRY,
  FIELD_TYPE_REGISTRY,
  ORG_ROLE_REGISTRY,
  orgRoleEntrySchema,
  PROFILE_CONTRIBUTOR_REGISTRY,
  profileContributorEntrySchema,
  SEED_ORG_ROLES,
  WIZARD_STEP_REGISTRY,
  wizardStepEntrySchema,
  type FacetEntry,
  type FieldTypeEntry,
  type OrgRoleEntry,
  type ProfileContributorEntry,
  type WizardStepEntry,
} from './service/registries.ts';
import { createServicesService, type ServicesService } from './service/services.ts';
import { settingsSchema, type ServicesSettings } from './settings-schema.ts';

export { settingsSchema, type ServicesSettings } from './settings-schema.ts';
export type { ServicesService } from './service/services.ts';

/** What the module registers as its service. */
export type RegistryServicesService = ServicesService;

// The service types of the dependencies shape `ctx.deps`.
export type ServicesDependencies = [
  AuthzService,
  SettingsService,
  IdentityService,
  NotificationsService,
  BlobService,
];

/** The registry of vocabularies, declared by core.settings: this module adds the `usage` of `stage`. */
const VOCABULARY_REGISTRY = 'vocabulary';

const uuid = z.uuid();
const actorId = z.uuid().nullable();

export interface ServicesModuleOptions {
  /** Replaces the shipped configuration (`config/fields.ts`, `config/steps.ts`); tests and forks. */
  config?: ServicesConfig;
  /** Replaces the SPDX adapter. The default is the stub when `NODE_ENV=test`, else the live list with its cache. */
  spdx?: Spdx;
}

/** Throws for an id that two contributors give: the module refuses to start rather than pick one. */
function uniqueById<T extends { id: string }>(registry: string, entries: readonly T[]): T[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`registry.services: "${entry.id}" is contributed twice to ${registry}`);
    }
    seen.add(entry.id);
  }
  return [...entries];
}

/**
 * Builds the manifest. The default export is the one a profile uses. The registries and the two config
 * files are read once, at start: a wrong entry or a wrong config stops the server there.
 */
export function createServicesModule(options: ServicesModuleOptions = {}) {
  // The stage vocabulary's `usage` check needs the database, which exists only once the module starts;
  // the manifest's contribution reaches it through this closure (the pattern of the member policy).
  let stageInUse: ((termKey: string) => Promise<boolean>) | undefined;

  return defineModule<
    RegistryServicesService,
    | 'core.authz'
    | 'core.settings'
    | 'core.identity'
    | 'core.notifications'
    | 'core.blob'
    | 'registry.organisations',
    never, // core.ui-shell and core.audit are optional peers in package.json; no service of either is used
    ServicesSettings
  >({
    id: 'registry.services',
    version: '0.1.0',
    // `svc_service`, not `registry_services_service` (ADR 0004, ADR-0035).
    tablePrefix: 'svc_',

    permissions: {
      [PERMISSION_READ]: {
        description: 'Read services, the licence list and the organisation roles',
      },
      [PERMISSION_MANAGE]: {
        description: 'Create services (sprint 2 adds change and publication rules)',
      },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    events: {
      // Ids and field names, never text, an address or a URL (a test checks the payloads).
      emits: {
        'registry.service.created@1': z.strictObject({
          serviceId: uuid,
          by: z.enum(['admin', 'member']),
          actorId,
        }),
      },
    },

    // The five registries other modules contribute to (M9 adds the category through them).
    registries: {
      [ORG_ROLE_REGISTRY]: orgRoleEntrySchema,
      [FIELD_TYPE_REGISTRY]: fieldTypeEntrySchema,
      [WIZARD_STEP_REGISTRY]: wizardStepEntrySchema,
      [FACET_REGISTRY]: facetEntrySchema,
      [PROFILE_CONTRIBUTOR_REGISTRY]: profileContributorEntrySchema,
    },

    contributes: {
      [ORG_ROLE_REGISTRY]: SEED_ORG_ROLES,
      [FIELD_TYPE_REGISTRY]: SEED_FIELD_TYPES,
      [FACET_REGISTRY]: SEED_FACETS,
      // An organisation with services cannot be deleted, and its type cannot change (ADR-0033).
      [ORG_USAGE_REGISTRY]: [
        {
          id: 'registry.services',
          count: async (tx, organisationId) => {
            const [row] = await tx
              .select({ total: count() })
              .from(serviceOrganisation)
              .where(eq(serviceOrganisation.organisationId, organisationId));
            return row?.total ?? 0;
          },
        } satisfies OrgUsageEntry,
      ],
      // A service uses its stage: a term that a service has cannot be deleted, only deactivated.
      [VOCABULARY_REGISTRY]: [
        {
          id: 'stage',
          usage: (termKey: string) => stageInUse?.(termKey) ?? Promise.resolve(false),
        },
      ],
      // Every signed-in person may read services; `manage` stays with Admin (ADR-0014 resolution).
      'authz.defaultRole': [
        { role: 'user', permissions: [PERMISSION_READ] },
        { role: 'reviewer', permissions: [PERMISSION_READ] },
      ],
    },

    services: (ctx) => {
      const orgTypes = new Set(
        (ctx.registry(ORG_TYPE_REGISTRY) as readonly OrgTypeEntry[]).map((type) => type.id),
      );
      const roles = uniqueById(
        ORG_ROLE_REGISTRY,
        ctx.registry(ORG_ROLE_REGISTRY) as readonly OrgRoleEntry[],
      );
      for (const role of roles) {
        for (const type of role.orgTypes) {
          if (!orgTypes.has(type)) {
            throw new Error(
              `registry.services: the role "${role.id}" names the organisation type "${type}", which no module registers`,
            );
          }
        }
      }
      const fieldTypes = uniqueById(
        FIELD_TYPE_REGISTRY,
        ctx.registry(FIELD_TYPE_REGISTRY) as readonly FieldTypeEntry[],
      );
      uniqueById(FACET_REGISTRY, ctx.registry(FACET_REGISTRY) as readonly FacetEntry[]);
      uniqueById(
        PROFILE_CONTRIBUTOR_REGISTRY,
        ctx.registry(PROFILE_CONTRIBUTOR_REGISTRY) as readonly ProfileContributorEntry[],
      );

      const config = options.config ?? { fields: FIELDS, steps: STEPS };
      const resolved = validateServicesConfig({
        fields: config.fields,
        steps: config.steps,
        contributedSteps: ctx.registry(WIZARD_STEP_REGISTRY) as readonly WizardStepEntry[],
        fieldTypes,
        orgRoles: roles,
        columns: Object.fromEntries(
          Object.entries(getTableColumns(serviceTable)).map(([name, column]) => [
            name,
            column.dataType === 'array' ? 'array' : 'scalar',
          ]),
        ),
      });

      const spdx =
        options.spdx ??
        (process.env.NODE_ENV === 'test'
          ? createStubSpdx()
          : createSpdx({ cache: createLicenseCache(ctx.db) }));
      const services = createServicesService(ctx, {
        authz: ctx.deps['core.authz'],
        settings: ctx.deps['core.settings'],
        organisations: ctx.deps['registry.organisations'],
        spdx,
        config: resolved,
        roles,
      });
      stageInUse = async (termKey) => {
        const [row] = await ctx.db
          .select({ id: serviceTable.id })
          .from(serviceTable)
          .where(eq(serviceTable.stage, termKey))
          .limit(1);
        return row !== undefined;
      };
      return services;
    },

    routes: (r) => {
      registerServiceRoutes(r, r.service<RegistryServicesService>());
    },
  });
}

export default createServicesModule();
