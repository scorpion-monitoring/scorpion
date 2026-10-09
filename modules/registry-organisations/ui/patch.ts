// What the form sends. `SchemaForm` hands over what was filled in and leaves an emptied optional field out,
// which for a PATCH would mean "not mentioned" and not "cleared". This turns the form's values and the stored
// record into the body of a PATCH: only what changed, `null` for a field that was emptied, both halves of the
// contact point together. Pure and table-tested.
import type { FormField } from './form-schema.ts';

export interface OrganisationValues {
  type?: unknown;
  abbreviation?: unknown;
  name?: unknown;
  description?: unknown;
  website?: unknown;
  rorId?: unknown;
  sameAs?: unknown;
  contactEmail?: unknown;
  contactType?: unknown;
}

/** The stored record, as much as the form edits (`null` for an empty optional field). */
export interface StoredOrganisation {
  type: string;
  abbreviation: string;
  name: string;
  description: string | null;
  website: string | null;
  rorId: string | null;
  sameAs: string[];
  contactEmail?: string | null | undefined;
  contactType?: string | null | undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => text(entry)).filter((entry): entry is string => entry !== undefined)
    : [];

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/** The body of a PATCH: every field optional, `null` clears an optional one. */
export interface PatchBody {
  type?: string;
  abbreviation?: string;
  name?: string;
  description?: string | null;
  website?: string | null;
  rorId?: string | null;
  sameAs?: string[];
  contactEmail?: string | null;
  contactType?: string | null;
}

/** The body of a POST: `type`, `abbreviation` and `name` are always sent (empty when missing: the server says so on the field). */
export interface CreateBody extends PatchBody {
  type: string;
  abbreviation: string;
  name: string;
}

/**
 * The body of a PATCH for the fields the caller may write. A field the caller may not write is never in
 * the body, so a manager's form cannot send `name` even by mistake. An empty object means nothing changed.
 */
export function buildPatch(
  stored: StoredOrganisation,
  values: OrganisationValues,
  fields: readonly FormField[],
): PatchBody {
  const patch: PatchBody = {};
  const has = (field: FormField) => fields.includes(field);
  for (const key of ['type', 'abbreviation', 'name'] as const) {
    const next = text(values[key]);
    if (has(key) && next !== undefined && next !== stored[key]) patch[key] = next;
  }
  for (const key of ['description', 'website', 'rorId'] as const) {
    if (!has(key)) continue;
    const next = text(values[key]) ?? null;
    if (next !== (stored[key] ?? null)) patch[key] = next;
  }
  if (has('sameAs')) {
    const next = list(values.sameAs);
    if (!sameList(next, stored.sameAs)) patch.sameAs = next;
  }
  if (has('contact')) {
    const email = text(values.contactEmail) ?? null;
    const type = text(values.contactType) ?? null;
    if (email !== (stored.contactEmail ?? null) || type !== (stored.contactType ?? null)) {
      // The two go together: both set or both cleared (the server says 422 for half a contact point).
      patch.contactEmail = email;
      patch.contactType = type;
    }
  }
  return patch;
}

/** The body of a POST: what was filled in, nothing else. An empty list of links is left out. */
export function buildCreate(values: OrganisationValues): CreateBody {
  const body: CreateBody = {
    type: text(values.type) ?? '',
    abbreviation: text(values.abbreviation) ?? '',
    name: text(values.name) ?? '',
  };
  for (const key of ['description', 'website', 'rorId', 'contactEmail', 'contactType'] as const) {
    const value = text(values[key]);
    if (value !== undefined) body[key] = value;
  }
  const sameAs = list(values.sameAs);
  if (sameAs.length > 0) body.sameAs = sameAs;
  return body;
}

/** The values a form starts from: the stored record, `null` becoming absent. */
export function formValues(stored: StoredOrganisation): OrganisationValues {
  return {
    type: stored.type,
    abbreviation: stored.abbreviation,
    name: stored.name,
    ...(stored.description !== null && { description: stored.description }),
    ...(stored.website !== null && { website: stored.website }),
    ...(stored.rorId !== null && { rorId: stored.rorId }),
    sameAs: stored.sameAs,
    ...(stored.contactEmail && { contactEmail: stored.contactEmail }),
    ...(stored.contactType && { contactType: stored.contactType }),
  };
}
