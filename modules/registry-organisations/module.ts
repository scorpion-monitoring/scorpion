import { z } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { BlobService } from '@scorpion/core-blob/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import { registerOrganisationRoutes } from './routes.ts';
import { createOrganisationsService, type OrganisationsService } from './service/organisations.ts';
import {
  PERMISSION_DECIDE,
  PERMISSION_MANAGE,
  PERMISSION_MANAGE_ROLES,
  PERMISSION_READ,
  PERMISSION_READ_CONTACT,
  PERMISSION_REMOVE,
  PERMISSION_REQUEST,
  PERMISSION_VIEW_MEMBERS,
  RESOURCE_TYPE,
} from './service/permissions.ts';
import { createMemberPolicy, type MemberPolicy } from './service/policy.ts';
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
  // The policy needs the database and the settings, which exist only once the module starts; the
  // manifest's contribution reaches it through this closure (the pattern of core.audit's sink).
  let policy: MemberPolicy | undefined;
  const policyOrThrow = () => {
    if (!policy)
      throw new Error('registry.organisations: the member policy was asked before start');
    return policy;
  };

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
        description: 'Create, change and delete organisations, and set their logo',
      },
      [PERMISSION_REQUEST]: {
        description: 'Ask to become a member of an organisation, and withdraw or leave',
      },
      // Scoped to `organisation` (ADR-0034): Admin holds each everywhere, the managers (and for
      // `view-members` the members) of one organisation through the policy `organisation.member`.
      // Routes never name them; the service checks them (`ctx.authz.require` with the organisation).
      [PERMISSION_READ_CONTACT]: {
        scope: RESOURCE_TYPE,
        description: 'Always see the contact point of an organisation, whatever the setting says',
      },
      [PERMISSION_VIEW_MEMBERS]: {
        scope: RESOURCE_TYPE,
        description: 'See the members of an organisation (usernames and join dates)',
      },
      [PERMISSION_DECIDE]: {
        scope: RESOURCE_TYPE,
        description: 'Approve or reject membership requests of an organisation, and list them',
      },
      [PERMISSION_MANAGE_ROLES]: {
        scope: RESOURCE_TYPE,
        description: 'Promote a member of an organisation to manager, or demote a manager',
      },
      [PERMISSION_REMOVE]: {
        scope: RESOURCE_TYPE,
        description:
          'End the membership of a member of an organisation (a manager may remove plain members only)',
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
      // The roles User and Reviewer read organisations; `manage` stays with Admin (ADR-0014 resolution).
      'authz.defaultRole': [
        { role: 'user', permissions: [PERMISSION_READ, PERMISSION_REQUEST] },
        { role: 'reviewer', permissions: [PERMISSION_READ] },
      ],
      // The first resource policy (ADR-0034): managers and members of an organisation, per permission.
      'authz.resourcePolicy': [
        {
          resourceType: RESOURCE_TYPE,
          allows: (request: Parameters<MemberPolicy['allows']>[0]) =>
            policyOrThrow().allows(request),
        },
      ],
    },

    services: (ctx) => {
      policy = createMemberPolicy({
        db: ctx.db,
        settings: async () => settingsSchema.parse(await ctx.settings.get()),
      });
      return createOrganisationsService(ctx, {
        authz: ctx.deps['core.authz'],
        blob: ctx.deps['core.blob'],
      });
    },

    routes: (r) => {
      registerOrganisationRoutes(r, r.service<OrganisationsService>());
    },
  });
}

export default createOrganisationsModule();
