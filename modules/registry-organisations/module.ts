import { z } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { BlobService } from '@scorpion/core-blob/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import { registerOrganisationRoutes } from './routes.ts';
import {
  createOrganisationsService,
  PERMISSION_MANAGE,
  PERMISSION_READ,
  type OrganisationsService,
} from './service/organisations.ts';
import {
  ORG_TYPE_REGISTRY,
  ORG_USAGE_REGISTRY,
  orgTypeEntrySchema,
  orgUsageEntrySchema,
  SEED_TYPES,
} from './service/registries.ts';
import { settingsSchema, type OrganisationsSettings } from './settings-schema.ts';

export { settingsSchema, type OrganisationsSettings } from './settings-schema.ts';
export type { OrganisationsService } from './service/organisations.ts';

// The service types of the dependencies shape `ctx.deps`; sprint 1 uses core.authz only.
export type OrganisationsDependencies = [
  AuthzService,
  SettingsService,
  IdentityService,
  NotificationsService,
  BlobService,
];

const actorId = z.uuid().nullable();

/**
 * Builds the manifest. The default export is the one a profile uses. The service reaches the routes
 * through `r.service()`; the registries `org.type` and `org.usage` are read once, at start.
 */
export function createOrganisationsModule() {
  return defineModule<
    OrganisationsService,
    'core.authz' | 'core.settings' | 'core.identity' | 'core.notifications' | 'core.blob',
    never, // core.ui-shell is an optional peer in package.json; the module uses no service of it
    OrganisationsSettings
  >({
    id: 'registry.organisations',
    version: '0.1.0',
    // `org_organisation`, not `registry_organisations_organisation` (ADR 0004, ADR-0033).
    tablePrefix: 'org_',

    permissions: {
      [PERMISSION_READ]: {
        description: 'Read organisations and the registered organisation types',
      },
      [PERMISSION_MANAGE]: {
        description: 'Create, change and delete organisations',
      },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    events: {
      // Names of fields and ids, never text, an address or a URL (a test checks the payloads).
      emits: {
        'registry.organisation.created@1': z.strictObject({
          organisationId: z.uuid(),
          type: z.string(),
          actorId,
        }),
        'registry.organisation.updated@1': z.strictObject({
          organisationId: z.uuid(),
          fields: z.array(z.string()),
          by: z.enum(['admin', 'manager']),
          actorId,
        }),
        'registry.organisation.deleted@1': z.strictObject({
          organisationId: z.uuid(),
          type: z.string(),
          actorId,
        }),
      },
    },

    // Registries other modules contribute to (M7 adds `service_organisation` to `org.usage`, a module
    // that needs a `funder` adds an `org.type`).
    registries: {
      [ORG_TYPE_REGISTRY]: orgTypeEntrySchema,
      [ORG_USAGE_REGISTRY]: orgUsageEntrySchema,
    },

    // The pages (Svelte) are loaded by the web app only; the manifest just names the entry.
    ui: () => import('./ui/index.ts'),

    contributes: {
      [ORG_TYPE_REGISTRY]: SEED_TYPES,
      // Every signed-in person may read organisations (the forms need them); `manage` stays with Admin.
      'authz.defaultRole': [
        { role: 'user', permissions: [PERMISSION_READ] },
        { role: 'reviewer', permissions: [PERMISSION_READ] },
      ],
    },

    services: (ctx) => createOrganisationsService(ctx, { authz: ctx.deps['core.authz'] }),

    routes: (r) => {
      registerOrganisationRoutes(r, r.service<OrganisationsService>());
    },
  });
}

export default createOrganisationsModule();
