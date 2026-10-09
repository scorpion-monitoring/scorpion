// The permission ids of registry.organisations and the resource type of the scoped ones.
//
// Plain permissions (checked by the route): `read`, `manage`, `membership.request`.
// Scoped permissions (scope `organisation`): Admin holds them globally, the managers and members of
// one organisation through the policy `organisation.member` (ADR-0034). A route never names a scoped
// permission; the service calls `ctx.authz.require(actor, scoped, { type: 'organisation', id })`.
export const PERMISSION_READ = 'registry.organisations.organisation.read';
export const PERMISSION_MANAGE = 'registry.organisations.organisation.manage';
export const PERMISSION_REQUEST = 'registry.organisations.membership.request';

export const PERMISSION_READ_CONTACT = 'registry.organisations.organisation.read-contact';
export const PERMISSION_VIEW_MEMBERS = 'registry.organisations.membership.view-members';
export const PERMISSION_DECIDE = 'registry.organisations.membership.decide';
export const PERMISSION_MANAGE_ROLES = 'registry.organisations.membership.manage-roles';
export const PERMISSION_REMOVE = 'registry.organisations.membership.remove';

/** The resource type (and the `scope`) of the scoped permissions. */
export const RESOURCE_TYPE = 'organisation';

/** What an approved **manager** of an organisation holds on it. The sprint 4 `…organisation.edit` joins here. */
export const MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSION_READ_CONTACT,
  PERMISSION_VIEW_MEMBERS,
  PERMISSION_DECIDE,
  PERMISSION_MANAGE_ROLES,
  PERMISSION_REMOVE,
]);
