// The only file other modules may import. It offers what a contributing module needs (the names of the
// two registries and the shape of their entries) and the trusted reads for M7 and M8.
//
// The reads check no permission and name no caller (ADR-0015, hence the `AsSystem` suffix): a route
// that uses one must check its own permission first. They return the descriptive fields only, never
// the contact point or the audit columns. `toSchemaOrgAsSystem` leaves the contact point out unless
// the caller asks for it. The membership reads answer from ids and name nobody: M7's `service.member`
// asks `isApprovedMemberAsSystem` and `listApprovedOrganisationIdsAsSystem`.
export {
  ORG_TYPE_REGISTRY,
  ORG_USAGE_REGISTRY,
  SCHEMA_TYPES,
  type OrgTypeEntry,
  type OrgUsageCount,
  type OrgUsageEntry,
  type SchemaType,
} from './service/registries.ts';
// The field rules that other modules apply to the same kinds of value (a service's URL, `sameAs` links and
// contact point follow the organisation's rules: one normaliser, not a copy that can drift). Pure.
export {
  escapeLike,
  MAX_CONTACT_TYPE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SAME_AS,
  MAX_URL_LENGTH,
  parseContactEmail,
  parseContactType,
  parseDescription,
  parseName,
  parseSameAs,
  parseUrl,
  type Parsed,
} from './service/fields.ts';
export type { SchemaOrgProfile } from './service/schema-org.ts';
export type { OrganisationRecord, TypeView } from './service/organisations.ts';

import type { MembershipsService } from './service/memberships.ts';
import type { OrganisationsService } from './service/organisations.ts';

export type OrganisationsPublic = Pick<
  OrganisationsService,
  | 'findByIdsAsSystem'
  | 'findByAbbreviationAsSystem'
  | 'existsAsSystem'
  | 'listTypesAsSystem'
  | 'toSchemaOrgAsSystem'
> &
  Pick<
    MembershipsService,
    | 'isApprovedMemberAsSystem'
    | 'listApprovedOrganisationIdsAsSystem'
    | 'countApprovedMembersAsSystem'
    | 'isManagerAsSystem'
  >;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'registry.organisations': OrganisationsPublic;
  }
}
