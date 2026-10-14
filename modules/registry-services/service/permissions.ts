// The permission ids of registry.services and the resource type of the scoped ones (ADR-0036).
//
// Plain permissions (checked by the route): `read`, `create`, `manage`, `publish`.
// Scoped permissions (scope `service`): Admin holds them globally, the members and managers of the
// service's provider through the policy `service.member`. A delegated route names the plain `read` and the
// service calls `ctx.authz.require(actor, scoped, { type: 'service', id })` (ADR-0034).
export const PERMISSION_READ = 'registry.services.service.read';
/** Read services through the public API (`/api/v1`, ADR-0037): a token names it as a scope. */
export const PERMISSION_V1_READ = 'registry.services.v1.read';
/** Create a service; the service then needs an Admin or an approved member of the chosen provider (Decision 14). */
export const PERMISSION_CREATE = 'registry.services.service.create';
/** Every field of any service, as Admin: never restricted. */
export const PERMISSION_MANAGE = 'registry.services.service.manage';
/** Switch a service between private and public: Reviewers and Admin. */
export const PERMISSION_PUBLISH = 'registry.services.service.publish';

/** Change every field but the slug and the provider, and the icon: the provider's approved members. */
export const PERMISSION_EDIT = 'registry.services.service.edit';
/** Change the slug and the provider: the managers of the provider. */
export const PERMISSION_EDIT_IDENTITY = 'registry.services.service.edit-identity';
/** Always see the contact point, whatever the setting says: the provider's members. */
export const PERMISSION_READ_CONTACT = 'registry.services.service.read-contact';

/** The resource type (and the `scope`) of the scoped permissions. */
export const RESOURCE_TYPE = 'service';

/** The key of the organisation role whose holder owns a service (a key of the registry `service.orgRole`). */
export const OWNER_ROLE = 'provider';
/** The key of the role whose organisations are the `brand` of the Schema.org profile and the consortia of the public record. */
export const BRAND_ROLE = 'consortium';

/** What an approved **member** of the provider holds on the service (a manager is a member too). */
export const MEMBER_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSION_EDIT,
  PERMISSION_READ_CONTACT,
]);
/** What only an approved **manager** of the provider holds on the service. */
export const MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([PERMISSION_EDIT_IDENTITY]);
