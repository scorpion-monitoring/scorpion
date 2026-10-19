// The permission ids of kpi.framework. The routes name them, and the service checks them again.
export const PERMISSION_INDICATOR_READ = 'kpi.framework.indicator.read';
export const PERMISSION_INDICATOR_MANAGE = 'kpi.framework.indicator.manage';
export const PERMISSION_SET_READ = 'kpi.framework.set.read';
export const PERMISSION_SET_MANAGE = 'kpi.framework.set.manage';
/**
 * Change the KPI set and the extra indicators of a service. Scoped to `service` (ADR-0036): Admin holds it
 * everywhere and the approved **managers** of the service's provider through the policy `service.member` (the group that
 * holds `service.edit-identity`, ADR-0036); plain members read the KPIs and do not change them. No
 * route names it as the permission of a pipeline check; the service calls `ctx.authz.require` with the service.
 */
export const PERMISSION_SERVICE_KPIS_EDIT = 'kpi.framework.service.kpis.edit';
/** The resource type (and `scope`) of the scoped permission: a service of `registry.services`. */
export const RESOURCE_SERVICE = 'service';
/** Read `/api/v1/categories` and `/api/v1/indicators` with a token that holds this scope (ADR-0037). */
export const PERMISSION_V1_READ = 'kpi.framework.v1.read';
