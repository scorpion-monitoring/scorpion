// The permission ids of kpi.ingestion and the resource type of the scoped one. The service checks them; the routes of
// sprint 2 will name the plain ones.
/**
 * Submit measurements for one service. Scoped to `service` (ADR-0034, ADR-0036, ADR-0041 Decision 4): Admin holds it
 * everywhere, and the **approved members** of the service's provider hold it through the policy below (a manager is a
 * member too). A person who only asked to join, left, was rejected, or belongs to another provider holds nothing. It is
 * not a role's permission (the role `user` does not hold it), so no route can name it as a pipeline check: `upsertBatch`
 * calls `ctx.authz.require` with the service, and that call is the authorization.
 */
export const PERMISSION_SUBMIT = 'kpi.ingestion.measurement.submit';
/** The resource type (and `scope`) of the scoped permission: a service of `registry.services`. */
export const RESOURCE_SERVICE = 'service';
