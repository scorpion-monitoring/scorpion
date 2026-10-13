// The edit form of the service page as pure functions, over the helpers of the wizard (`form-state.ts`): the
// form a record starts from, the PATCH body a change becomes, and the rules the browser checks before it sends.
// No Svelte, no network; every rule is a table-driven test (`edit-state.test.ts`). The fields are the ones the
// server's schema lists and the record's `editableFields` allows: the page holds no field of its own.
import type { SchemaIssue } from '@scorpion/ui-kit/json-schema';
import { sameJson } from '@scorpion/ui-kit/schema-form';
import { checkStep, getAt, setAt, toBodyOf } from './form-state.ts';
import type { WizardField, WizardStep } from './wizard-types.ts';

type Tree = Record<string, unknown>;

/** What the form needs of a service record: the part of the API's answer that holds the values. */
export interface ServiceSource {
  organisations: readonly { role: string; id: string }[];
  values: Readonly<Record<string, unknown>>;
  [column: string]: unknown;
}

/**
 * The fields the edit form draws: the schema's fields the caller may write on this service (the record's
 * `editableFields`), without the icon, which has its own block and is never part of a patch.
 */
export const editFields = (
  fields: readonly WizardField[],
  editableFields: readonly string[],
): WizardField[] => fields.filter((field) => !field.deferred && editableFields.includes(field.key));

/**
 * The fields shown but not drawn as controls: those of the schema that the caller may not write while they may
 * write others. The API decided (the same table the update checks); the page names none of them.
 */
export const readOnlyFields = (
  fields: readonly WizardField[],
  editableFields: readonly string[],
): WizardField[] =>
  editableFields.length === 0
    ? []
    : fields.filter((field) => !field.deferred && !editableFields.includes(field.key));

/** The value of one field in a record, as the form holds it: `undefined` when the record has none. */
function valueOf(source: ServiceSource, field: WizardField): unknown {
  if (field.role !== undefined) {
    const ids = source.organisations
      .filter((organisation) => organisation.role === field.role)
      .map((organisation) => organisation.id);
    return field.config.multiple === true ? ids : ids[0];
  }
  const raw = field.column !== undefined ? source[field.column] : source.values[field.key];
  if (raw === null || raw === undefined) return undefined;
  return Array.isArray(raw) ? [...(raw as unknown[])] : raw;
}

/** The nested form object a record starts from: every field of the schema at its pointer, but the icon. */
export function formFromService(source: ServiceSource, fields: readonly WizardField[]): Tree {
  const form: Tree = {};
  for (const field of fields) {
    if (field.deferred) continue;
    const value = valueOf(source, field);
    if (value !== undefined) setAt(form, field.path, value);
  }
  return form;
}

/** The parent of a pointer (`/contact`), or `''` for a field at the top. */
const parentOf = (pointer: string): string => pointer.slice(0, pointer.lastIndexOf('/'));

/**
 * What to send for a change, as a part of the nested object (ADR-0035): only the fields that changed. An emptied
 * optional field is `null`, an emptied list is `[]`, and a field that lives in an object with others (the
 * contact point: an address and a kind) is sent with all of its siblings, because the server reads the pair as
 * one thing, and both `null` clear it. The icon is never in a patch. An empty result means nothing changed, and
 * the page offers no save.
 */
export function patchBody(initial: Tree, current: Tree, fields: readonly WizardField[]): Tree {
  const drawn = fields.filter((field) => !field.deferred);
  const before = toBodyOf(initial, drawn);
  const after = toBodyOf(current, drawn);
  const patch: Tree = {};
  const send = (field: WizardField) => {
    const value = getAt(after, field.path);
    setAt(patch, field.path, value === undefined ? null : value);
  };
  for (const field of drawn) {
    if (sameJson(getAt(before, field.path), getAt(after, field.path))) continue;
    const parent = parentOf(field.path);
    if (parent === '') send(field);
    else for (const sibling of drawn) if (parentOf(sibling.path) === parent) send(sibling);
  }
  return patch;
}

/** Whether a patch has anything to send. */
export const hasChanges = (patch: Tree): boolean => Object.keys(patch).length > 0;

/**
 * The rules of the steps' JSON Schemas that the form breaks, on the fields the person can change: a value the
 * person cannot touch (the address of a service they only edit) is not theirs to fix, and the server judges
 * it anyway. The check runs over the whole form so a rule over two fields (the contact pair) sees both.
 */
export function editIssues(
  steps: readonly WizardStep[],
  form: Tree,
  fields: readonly WizardField[],
): SchemaIssue[] {
  const drawn = fields.filter((field) => !field.deferred);
  const body = toBodyOf(form, drawn);
  return steps
    .flatMap((step) => checkStep(step, body))
    .filter((issue) =>
      drawn.some(
        (field) => issue.pointer === field.path || issue.pointer.startsWith(`${field.path}/`),
      ),
    );
}
