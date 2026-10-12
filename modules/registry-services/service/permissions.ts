// The permission ids of registry.services. Sprint 1 declares the two plain ones; the scoped permissions
// (`edit`, `edit-identity`, `read-contact`) and `publish` arrive with the policy `service.member` in
// sprint 2 (ADR-0036).
export const PERMISSION_READ = 'registry.services.service.read';
export const PERMISSION_MANAGE = 'registry.services.service.manage';

/** The resource type of the scoped permissions of sprint 2. */
export const RESOURCE_TYPE = 'service';
