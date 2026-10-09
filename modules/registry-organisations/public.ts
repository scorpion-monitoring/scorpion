// The only file other modules may import. Sprint 1 offers what a contributing module needs: the names
// of the two registries and the shape of their entries. The trusted reads for M7 and M8 (`findByIds`,
// `findByAbbreviation`, ...) arrive with sprint 2.
export {
  ORG_TYPE_REGISTRY,
  ORG_USAGE_REGISTRY,
  SCHEMA_TYPES,
  type OrgTypeEntry,
  type OrgUsageCount,
  type OrgUsageEntry,
  type SchemaType,
} from './service/registries.ts';

export type OrganisationsPublic = Record<never, never>;

declare module '@scorpion/kernel' {
  interface ModuleServices {
    'registry.organisations': OrganisationsPublic;
  }
}
