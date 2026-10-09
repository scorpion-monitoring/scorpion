// The only file other modules may import. It offers what a contributing module needs (the names of the
// two registries and the shape of their entries) and the trusted reads for M7 and M8.
//
// The reads check no permission and name no caller (ADR-0015, hence the `AsSystem` suffix): a route
// that uses one must check its own permission first. They return the descriptive fields only, never
// the contact point or the audit columns. `toSchemaOrgAsSystem` leaves the contact point out unless
// the caller asks for it.
export {
  ORG_TYPE_REGISTRY,
  ORG_USAGE_REGISTRY,
  SCHEMA_TYPES,
  type OrgTypeEntry,
  type OrgUsageCount,
  type OrgUsageEntry,
  type SchemaType,
} from './service/registries.ts';
export type { SchemaOrgProfile } from './service/schema-org.ts';
export type { OrganisationRecord, TypeView } from './service/organisations.ts';

import type { OrganisationsService } from './service/organisations.ts';

export type OrganisationsPublic = Pick<
  OrganisationsService,
  | 'findByIdsAsSystem'
  | 'findByAbbreviationAsSystem'
  | 'existsAsSystem'
  | 'listTypesAsSystem'
  | 'toSchemaOrgAsSystem'
>;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'registry.organisations': OrganisationsPublic;
  }
}
