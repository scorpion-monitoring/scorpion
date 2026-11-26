// The permission ids of bibliometrics and the resource type of the scoped one (ADR-0056 Decision 4).

/**
 * Read the publications of a service. The role `user` holds it: services are readable by every signed-in person, and
 * publications are not public (decision 3 of the plan). The write routes carry it too, as a delegated check: the service
 * then checks the scoped write (ADR-0034).
 */
export const PERMISSION_READ = 'bibliometrics.publication.read';
/**
 * Add and remove a publication of one service, and (sprint 2) check its citations now. Scoped to `service`: Admin holds it
 * everywhere, and the approved members of the service's provider (a manager is a member too) hold it through the policy
 * of this module. No role holds it, so no route can name it: the service calls `ctx.authz.require` with the service.
 */
export const PERMISSION_WRITE = 'bibliometrics.publication.write';
/** The resource type (and `scope`) of the scoped permission: a service of `registry.services`. */
export const RESOURCE_SERVICE = 'service';
