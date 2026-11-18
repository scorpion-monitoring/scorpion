// The only file other modules may import. It offers what a contributing module needs (the names of the
// two registries and the shape of their entries) and the trusted reads for M7 and M8.
//
// The reads check no permission and name no caller (ADR-0015, hence the `AsSystem` suffix): a route
// that uses one must check its own permission first. They return the descriptive fields only, never
// the contact point or the audit columns. `toSchemaOrgAsSystem` leaves the contact point out unless
// the caller asks for it. The membership reads answer from ids and name nobody: M7's `service.member`
// asks `isApprovedMemberAsSystem` and `listApprovedOrganisationIdsAsSystem`.
export {
  CONSORTIUM_TYPE,
  ORG_TYPE_REGISTRY,
  ORG_PUBLIC_REFERENCE_REGISTRY,
  ORG_USAGE_REGISTRY,
  SCHEMA_TYPES,
  type OrgPublicReferenceEntry,
  type OrgPublicReferences,
  type OrgTypeEntry,
  type OrgUsageCount,
  type OrgUsageEntry,
  type PublicReference,
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
  MAX_ABBREVIATION_LENGTH,
  parseAbbreviation,
  parseContactEmail,
  parseContactType,
  parseDescription,
  parseName,
  parseSameAs,
  parseUrl,
  type Parsed,
} from './service/fields.ts';
// The one function that turns a profile into a string for HTML; M7's service profile goes through it too.
export { serializeJsonLd, type SchemaOrgProfile } from './service/schema-org.ts';
// The v1 route definition, for its contract test (`apps/server/src/providers.contract.test.ts`).
export { getProviderV1Route, listProvidersV1Route } from './routes-v1.ts';
export type {
  OrganisationRecord,
  OrganisationView,
  PublicOrganisationRecord,
  TypeView,
} from './service/organisations.ts';
export type { CreateOrganisationInput, UpdateOrganisationInput } from './service/input.ts';

import type { MembershipsService } from './service/memberships.ts';
import type { OrganisationsService } from './service/organisations.ts';

// `create` and `update` check the caller's permission like a request does: the migration tool writes through them as its
// account (ADR-0052), so every legacy record passes the same rules as one typed into the form.
export type OrganisationsPublic = Pick<
  OrganisationsService,
  | 'create'
  | 'update'
  | 'findByIdsAsSystem'
  | 'findByAbbreviationAsSystem'
  | 'existsAsSystem'
  | 'listTypesAsSystem'
  | 'listConsortiaAsSystem'
  | 'toSchemaOrgAsSystem'
> &
  Pick<
    MembershipsService,
    // The migration tool asks to join as the user and decides as its account (ADR-0052); both check the caller's
    // permission as a request does, and `listOwn` tells it the state of a row it wrote before.
    | 'request'
    | 'decide'
    | 'listOwn'
    | 'isApprovedMemberAsSystem'
    | 'listApprovedOrganisationIdsAsSystem'
    | 'countApprovedMembersAsSystem'
    | 'isManagerAsSystem'
    | 'listApprovedManagerIdsAsSystem'
    | 'listApprovedMemberIdsAsSystem'
  >;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'registry.organisations': OrganisationsPublic;
  }
}
