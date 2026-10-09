// Who may write which field of an organisation (ADR-0033, Decision 14). One pure table, so that the
// second editor group of sprint 4 (the managers of the organisation) adds a policy answer and never a
// second code path. In sprints 1 to 3 both kinds of access need `…organisation.manage` (Admin).

/** Identity of the record: only an Admin changes them, because other modules refer to them. */
export const ADMIN_FIELDS = ['type', 'abbreviation', 'name'] as const;
/** The descriptive fields: an Admin, and from sprint 4 the managers of that organisation. */
export const EDITOR_FIELDS = [
  'description',
  'website',
  'sameAs',
  'rorId',
  'logo',
  'contact',
] as const;

export type AdminField = (typeof ADMIN_FIELDS)[number];
export type EditorField = (typeof EDITOR_FIELDS)[number];
export type OrganisationField = AdminField | EditorField;
export type Access = 'admin' | 'edit';

const ADMIN_SET: ReadonlySet<string> = new Set(ADMIN_FIELDS);

/**
 * The access a set of fields needs: `admin` as soon as one field is an identity field, else `edit`.
 * A request that needs `admin` is refused whole for a caller who only has `edit`; there is no partial
 * apply. An empty set needs `edit` (it changes nothing).
 */
export function requiredAccess(fields: readonly OrganisationField[]): Access {
  return fields.some((field) => ADMIN_SET.has(field)) ? 'admin' : 'edit';
}

/** The field groups of a request body: `contactEmail` and `contactType` are one field, `contact`. */
export function fieldsOfBody(body: Readonly<Record<string, unknown>>): OrganisationField[] {
  const fields = new Set<OrganisationField>();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    if (key === 'contactEmail' || key === 'contactType') fields.add('contact');
    else if (key === 'logo') fields.add('logo');
    else if ((ADMIN_FIELDS as readonly string[]).includes(key)) fields.add(key as AdminField);
    else if ((EDITOR_FIELDS as readonly string[]).includes(key)) fields.add(key as EditorField);
    else throw new Error(`field-rules: "${key}" is not a field of an organisation`);
  }
  return [...fields];
}

/**
 * The fields a raw, not yet validated input names, for the permission check that runs before the input
 * is parsed. A key that is no field is left out: the parse refuses it with a 422.
 */
export function fieldsOfInput(input: unknown): OrganisationField[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return [];
  const known = Object.fromEntries(
    Object.entries(input).filter(([key]) =>
      [...ADMIN_FIELDS, ...EDITOR_FIELDS, 'contactEmail', 'contactType'].includes(key),
    ),
  );
  return fieldsOfBody(known);
}
