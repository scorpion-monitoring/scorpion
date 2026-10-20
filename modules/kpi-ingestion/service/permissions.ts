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

/**
 * Read the measurements of a service through the public API (`GET /api/v1/measurements`) with a token that holds this scope. The
 * role `user` holds it: every signed-in person reads every service's measurements, as services and KPI definitions are
 * (decision 4 of the plan). Never anonymous, never public.
 */
export const PERMISSION_V1_READ = 'kpi.ingestion.v1.read';
/**
 * Write measurements through the public API (`POST /api/v1/measurements`) with a token that holds this scope. The role `user`
 * holds it, and it is **not** enough: the service checks the scoped `kpi.ingestion.measurement.submit` for the token's owner
 * (ADR-0015), so a token without write access to that service is refused (the legacy "anyone with a key can write to any
 * service" gap).
 */
export const PERMISSION_V1_WRITE = 'kpi.ingestion.v1.write';
/** Read the grid of a month and the coverage of a service on the signed-in pages (the Data Submission page of sprint 4). */
export const PERMISSION_MEASUREMENT_READ = 'kpi.ingestion.measurement.read';
/**
 * Preview and commit a file or a form (the internal routes of sprint 3). The role `user` holds it and it is **not** enough: the service
 * checks the scoped `kpi.ingestion.measurement.submit`. It is a permission of its own, apart from the read, so that a token that may
 * only read the grid cannot be used to write (ADR-0015).
 */
export const PERMISSION_INGEST = 'kpi.ingestion.measurement.ingest';
