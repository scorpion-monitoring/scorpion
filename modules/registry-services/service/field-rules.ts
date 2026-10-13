// Who may write which field of a service (ADR-0036, Decision 5). One pure table for the three groups: the
// approved members of the provider (`edit`: everything but the identity), the managers of the provider
// (`identity` too) and Admin (everything). The service asks the table; the table says nothing about who the
// caller is. Fields are named by their key in `config/fields.ts`; a field a deployment adds is an `edit`
// field unless it is listed here.

/** The identity of a service: its address and its owner. Other modules and public links refer to them. */
export const IDENTITY_FIELDS = ['slug', 'provider'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export type Access = 'edit' | 'identity';

/** What a caller holds on one service. An Admin holds both; a manager both; a member `edit`. */
export interface AccessLevel {
  edit: boolean;
  identity: boolean;
}

const IDENTITY_SET: ReadonlySet<string> = new Set(IDENTITY_FIELDS);

/** Whether `field` is an identity field. */
export const isIdentityField = (field: string): boolean => IDENTITY_SET.has(field);

/**
 * The accesses a set of fields needs: `identity` as soon as one is the slug or the provider, `edit` as soon
 * as one is anything else. A mixed patch needs both, and a request that needs one the caller lacks is
 * refused whole; there is no partial apply. An empty set needs `edit` (it changes nothing).
 */
export function requiredAccess(fields: readonly string[]): Access[] {
  const needed: Access[] = [];
  if (fields.some((field) => !IDENTITY_SET.has(field)) || fields.length === 0) needed.push('edit');
  if (fields.some((field) => IDENTITY_SET.has(field))) needed.push('identity');
  return needed;
}

/** Whether a caller with `level` may make a change that needs `needed`. */
export function allows(level: AccessLevel, needed: readonly Access[]): boolean {
  return needed.every((access) => level[access]);
}

/** The identity fields of a request, in the order of the table: what a caller without `identity` may not change. */
export function identityFieldsOf(fields: readonly string[]): IdentityField[] {
  return IDENTITY_FIELDS.filter((field) => fields.includes(field));
}

/**
 * The fields a caller with `level` may write, for `editableFields` of `GET /services/{id}`: the same table
 * the update checks, so a screen draws its form from data and the server still refuses the rest.
 * `fieldKeys` are the keys of the configured fields, in the order of the configuration.
 */
export function editableFields(level: AccessLevel, fieldKeys: readonly string[]): string[] {
  return fieldKeys.filter((key) => (IDENTITY_SET.has(key) ? level.identity : level.edit));
}
