// The only file other modules may import. It offers what a contributing module needs (the names of the
// five registries and the shape of their entries) and the trusted reads for M8, M9 and M13.
//
// The reads check no permission and name no caller (ADR-0015, hence the `AsSystem` suffix): a route that
// uses one must check its own permission first. They return the descriptive fields and the organisation
// ids, never the contact point or the audit columns.
export {
  FACET_EMPTY,
  FACET_REGISTRY,
  FIELD_SCHEMA_ORG_PROPERTIES,
  FIELD_TYPE_REGISTRY,
  ORG_ROLE_REGISTRY,
  PROFILE_CONTRIBUTOR_REGISTRY,
  WIZARD_STEP_REGISTRY,
  type Choice,
  type ChoiceEnv,
  type FacetEntry,
  type FacetEnv,
  type FacetSelection,
  type FacetValue,
  type FieldCheckResult,
  type FieldConfig,
  type FieldEnv,
  type FieldSchemaOrgProperty,
  type FieldTypeEntry,
  type OrgRoleEntry,
  type ProfileContributorEntry,
  type ProfileSubject,
  type StorageKind,
  type WizardStepEntry,
} from './service/registries.ts';
export { fieldValueFacet } from './service/facets.ts';
export type { ImpactRow, ServiceRecord, ServiceView } from './service/services.ts';
// The slug rule (ADR-0035), pure: the migration tool derives and checks slugs with it before it writes (ADR-0052).
export { MAX_SLUG_LENGTH, parseSlug, RESERVED_SLUGS } from './service/fields.ts';
export { MAX_IMPACT_ROWS } from './service/services.ts';
// The role id of a service's provider (a key of the registry `service.orgRole`), for `listByOrganisationAsSystem(id, PROVIDER_ROLE)`.
export { OWNER_ROLE as PROVIDER_ROLE } from './service/permissions.ts';

import type { ServicesService } from './service/services.ts';

// The v1 route definitions, for their contract test (`apps/server/src/services.contract.test.ts`).
export { getServiceSchemaOrgV1Route, getServiceV1Route, listServicesV1Route } from './routes-v1.ts';

/** The slugs of the services `scorpion seed --demo` creates, for the demo seeds of the modules above (ADR-0046). */
export { DEMO_SERVICE_SLUGS } from './service/demo-seed.ts';

// `create` and `update` check the caller's permission like a request does: the migration tool writes through them as its
// account (ADR-0052).
export type ServicesPublic = Pick<
  ServicesService,
  | 'create'
  | 'update'
  | 'findByIdsAsSystem'
  | 'findBySlugAsSystem'
  | 'listByOrganisationAsSystem'
  | 'existsAsSystem'
  | 'listProviderIdsAsSystem'
  | 'isProviderManagerAsSystem'
  | 'isProviderMemberAsSystem'
  | 'listForPickerAsSystem'
  | 'listImpactRowsAsSystem'
  | 'findLicencesAsSystem'
>;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'registry.services': ServicesPublic;
  }
}

/** The looks of the catalogues' faceted search and the default (setting `catalogueFilters`, sprint 3 of M12a). */
export {
  CATALOGUE_FILTERS,
  DEFAULT_CATALOGUE_FILTERS,
  type CatalogueFilters,
} from './settings-schema.ts';
