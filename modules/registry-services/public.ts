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
export type { ServiceRecord } from './service/services.ts';

import type { ServicesService } from './service/services.ts';

// The v1 route definitions, for their contract test (`apps/server/src/services.contract.test.ts`).
export {
  getServiceSchemaOrgV1Route,
  getServiceV1Route,
  listServicesV1Route,
} from './routes-v1.ts';

export type ServicesPublic = Pick<
  ServicesService,
  'findByIdsAsSystem' | 'findBySlugAsSystem' | 'listByOrganisationAsSystem' | 'existsAsSystem'
>;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'registry.services': ServicesPublic;
  }
}
