import { z } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { BlobService } from '@scorpion/core-blob/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule } from '@scorpion/kernel';
import { registerMembershipRoutes } from './routes-membership.ts';
import { registerOrganisationRoutes } from './routes.ts';
import { createMembershipsService, type MembershipsService } from './service/memberships.ts';
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
import { TEMPLATES } from './templates/registry.ts';
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
export type { MembershipsService } from './service/memberships.ts';

/** What the module registers as its service: the organisation record and the memberships (one object, no name clashes). */
export type RegistryOrganisationsService = OrganisationsService & MembershipsService;

// The service types of the dependencies shape `ctx.deps`.
export type OrganisationsDependencies = [
  AuthzService,
  SettingsService,
  IdentityService,
  NotificationsService,
  BlobService,
];

const actorId = z.uuid().nullable();
const uuid = z.uuid();
/** The membership events carry ids, states and roles: never a username or an address. */
const membershipEvent = {
  membershipId: uuid,
  organisationId: uuid,
  userId: uuid,
};
const role = z.enum(['member', 'manager']);

/**
 * Builds the manifest. The default export is the one a profile uses. The service reaches the routes
 * through `r.service()`; the registries `org.type` and `org.usage` are read once, at start.
 */
export function createOrganisationsModule() {
  // The policy needs the database and the settings, which exist only once the module starts; the
  // manifest's contribution reaches it through this closure (the pattern of core.audit's sink).
  let policy: MemberPolicy | undefined;
  // The purge subscriber reaches the service the same way.
  let current: RegistryOrganisationsService | undefined;
  const serviceOrThrow = () => {
    if (!current) throw new Error('registry.organisations: the service was asked before start');
    return current;
  };
  const policyOrThrow = () => {
    if (!policy)
      throw new Error('registry.organisations: the member policy was asked before start');
    return policy;
  };

  return defineModule<
    RegistryOrganisationsService,
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
        'registry.membership.requested@1': z.strictObject({ ...membershipEvent }),
        'registry.membership.decided@1': z.strictObject({
          ...membershipEvent,
          state: z.enum(['approved', 'rejected']),
          by: z.enum(['admin', 'manager']),
          actorId: uuid,
        }),
        // From a leave, a withdrawal, a removal and a purge (`by: 'system'`, no actor). A flag says
        // whether the organisation still has an approved manager afterwards.
        'registry.membership.left@1': z.strictObject({
          ...membershipEvent,
          by: z.enum(['member', 'admin', 'manager', 'system']),
          actorId,
          organisationHasManager: z.boolean(),
        }),
        'registry.membership.roleChanged@1': z.strictObject({
          ...membershipEvent,
          from: role,
          to: role,
          by: z.enum(['admin', 'manager']),
          actorId: uuid,
          organisationHasManager: z.boolean(),
        }),
      },
      // A purged person's memberships go with them (ADR 0013); core.identity emits the event.
      on: {
        'identity.user.purged@1': async (event) => {
          const userId = (event.payload as { userId?: unknown }).userId;
          if (typeof userId === 'string') await serviceOrThrow().purgeUserAsSystem(userId);
        },
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
      // The membership mails and inbox items (they moved here from core.notifications, same keys).
      'notify.template': TEMPLATES,
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
      const organisations = createOrganisationsService(ctx, {
        authz: ctx.deps['core.authz'],
        blob: ctx.deps['core.blob'],
      });
      const memberships = createMembershipsService(ctx, {
        authz: ctx.deps['core.authz'],
        identity: ctx.deps['core.identity'],
        notifications: ctx.deps['core.notifications'],
        settings: ctx.deps['core.settings'],
      });
      current = { ...organisations, ...memberships };
      return current;
    },

    routes: (r) => {
      const service = r.service<RegistryOrganisationsService>();
      registerOrganisationRoutes(r, service);
      registerMembershipRoutes(r, service);
    },
  });
}

export default createOrganisationsModule();
