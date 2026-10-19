// What the create wizard learns from `GET /services/schema` (ADR-0035 addendum of sprint 5): the steps in
// order, each field with where it lives, which widget draws it and its message keys, one JSON Schema per
// step, the limits and the registry data the widgets need. Pure: a function of the resolved configuration,
// the registries and the options the service resolved (no database, no network), so every rule is a
// table-driven test.
//
// One generator. The JSON Schema of a field is `fieldType.jsonSchema(config)`, the same entry whose
// `schema(config)` the server validates the value with (`body.ts`); `create-schema.test.ts` feeds both the
// same table of values and fails when their verdicts differ. The page never holds a field, a step, a limit or a
// type of its own.
//
// `applies` of a contributed step is **not** sent: it is a function, and only the browser can ask it.
import type { ResolvedConfig, ResolvedField, ResolvedStep } from '../config/validate.ts';
import {
  MAX_CONTACT_TYPE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SAME_AS,
  MAX_SLUG_LENGTH,
  MAX_URL_LENGTH,
} from './fields.ts';
import { OWNER_ROLE } from './permissions.ts';
import type { Choice, OrgRoleEntry, ShowIf } from './registries.ts';

/** The most a create body may weigh: the longest values are 4000 characters, the lists are short. */
export const MAX_CREATE_BODY_BYTES = 64 * 1024;

/** The limits the form shows and checks against; the server's own constants, named once. */
export interface SchemaLimits {
  sameAs: number;
  slug: number;
  name: number;
  description: number;
  url: number;
  email: number;
  contactKind: number;
  /** The most a create body may weigh, in bytes. */
  bodyBytes: number;
}

export const SCHEMA_LIMITS: SchemaLimits = {
  sameAs: MAX_SAME_AS,
  slug: MAX_SLUG_LENGTH,
  name: MAX_NAME_LENGTH,
  description: MAX_DESCRIPTION_LENGTH,
  url: MAX_URL_LENGTH,
  email: MAX_EMAIL_LENGTH,
  contactKind: MAX_CONTACT_TYPE_LENGTH,
  bodyBytes: MAX_CREATE_BODY_BYTES,
};

export type JsonSchemaObject = { [key: string]: unknown };

export interface SchemaField {
  key: string;
  /** Where the value is in the one nested form object: `/name`, `/contact/type`. */
  path: string;
  /** The id of an entry of `service.fieldType`. */
  type: string;
  /** The widget the page maps the type to. */
  widget: string;
  /** Message keys of the UI catalogue. */
  label: string;
  help?: string;
  required: boolean;
  default?: unknown;
  config: Record<string, unknown>;
  /** For a field stored as an organisation link: the id of the role (`service.orgRole`). */
  role?: string;
  /** For a field stored in a column of the service: its name (`slug`), so a screen can put a conflict on it. */
  column?: string;
  /** Not part of the create body: the value is set after the service exists (the icon). */
  deferred: boolean;
  /** Changed through the route of the module that owns it (the storage `module`): the edit form leaves it out. */
  external?: boolean;
  /** The options of a choice field. */
  choices?: Choice[];
  /** Shown only when the condition holds on the form (a hidden field is not required); absent: always shown. */
  showIf?: ShowIf;
}

export interface SchemaStep {
  id: string;
  order: number;
  title: string;
  intro: string[];
  /** The name of a UI component for a step that is not a list of fields. */
  component?: string;
  contributed: boolean;
  /** The same condition for the whole step (its fields are not required while it is hidden). */
  showIf?: ShowIf;
  fields: SchemaField[];
  /** What the browser checks before it lets the person go on: the same rules the server applies to these fields. */
  schema: JsonSchemaObject;
}

export interface SchemaRole {
  id: string;
  label: string;
  labels: { en: string; de?: string | undefined };
  orgTypes: string[];
  min: number;
  max: number;
  order: number;
  /**
   * Whether the caller may only choose an organisation they are an approved member of (an administrator
   * may choose any): the owning role. The server decides and enforces it; the page only narrows the list.
   */
  memberOnly: boolean;
}

export interface SchemaFieldType {
  id: string;
  widget: string;
  labels: { en: string; de?: string | undefined };
}

export interface CreateSchema {
  steps: SchemaStep[];
  limits: SchemaLimits;
  fieldTypes: SchemaFieldType[];
  roles: SchemaRole[];
  /**
   * The object a new form starts from, generated from the fields (their `default`, an empty list for a list
   * field), nested at their pointers: the page never writes a default of its own.
   */
  defaults: Record<string, unknown>;
  /** True only outside production: the page may then offer the JSON console. */
  devConsole: boolean;
}

export interface BuildOptions {
  /** The options of the choice fields, by field key (the service resolves them with the type's `choices`). */
  choices?: ReadonlyMap<string, Choice[]>;
  locale?: string;
  devConsole: boolean;
}

const COLUMN_CONTACT_EMAIL = 'contactEmail';
const COLUMN_CONTACT_TYPE = 'contactType';

const parts = (pointer: string) => pointer.slice(1).split('/');

/** Whether the field is not part of the create body. */
const isDeferred = (resolved: ResolvedField) => resolved.field.storage.kind === 'icon';

/** A field's JSON Schema with what the page needs to draw it (`widget`) and to start it (`default`). */
function propertySchema(resolved: ResolvedField): JsonSchemaObject {
  return {
    ...resolved.type.jsonSchema(resolved.config),
    widget: resolved.type.widget,
    ...(resolved.field.default !== undefined && { default: resolved.field.default }),
  };
}

interface Node {
  properties: Record<string, JsonSchemaObject>;
  required: string[];
}

/**
 * The JSON Schema of one step: an object whose properties follow the fields' pointers (`/contact/type` is
 * `contact` › `type`). A field with a default is not required (the server fills it in); a field that is not
 * part of the body (the icon) is left out. The contact point's pair rule is a `dependentRequired` of its
 * parent object when both parts are in the step.
 */
export function stepSchema(fields: readonly ResolvedField[]): JsonSchemaObject {
  const root: Node = { properties: {}, required: [] };
  const nodes = new Map<string, Node>([['', root]]);
  const nodeAt = (pointer: string): Node => {
    const known = nodes.get(pointer);
    if (known) return known;
    const segments = parts(pointer);
    const parent = nodeAt(segments.length === 1 ? '' : `/${segments.slice(0, -1).join('/')}`);
    const node: Node = { properties: {}, required: [] };
    nodes.set(pointer, node);
    parent.properties[segments.at(-1)!] = node as unknown as JsonSchemaObject;
    return node;
  };

  const contact: { email?: ResolvedField; type?: ResolvedField } = {};
  for (const resolved of fields) {
    if (isDeferred(resolved)) continue;
    const segments = parts(resolved.field.path);
    const parent = nodeAt(segments.length === 1 ? '' : `/${segments.slice(0, -1).join('/')}`);
    parent.properties[segments.at(-1)!] = propertySchema(resolved);
    // A field with a condition is required only while it is shown: the server enforces that (`body.ts`), the
    // browser's schema leaves it out of `required` and the page asks the condition itself.
    if (
      resolved.field.required &&
      resolved.field.default === undefined &&
      resolved.field.showIf === undefined
    ) {
      parent.required.push(segments.at(-1)!);
    }
    const storage = resolved.field.storage;
    if (storage.kind === 'column' && storage.column === COLUMN_CONTACT_EMAIL) {
      contact.email = resolved;
    }
    if (storage.kind === 'column' && storage.column === COLUMN_CONTACT_TYPE) {
      contact.type = resolved;
    }
  }

  const finish = (node: Node, pointer: string): JsonSchemaObject => {
    const properties: Record<string, JsonSchemaObject> = {};
    for (const [key, child] of Object.entries(node.properties)) {
      const childNode = nodes.get(`${pointer}/${key}`);
      properties[key] =
        childNode && childNode === (child as unknown as Node)
          ? finish(childNode, `${pointer}/${key}`)
          : child;
    }
    const out: JsonSchemaObject = { type: 'object', additionalProperties: false, properties };
    if (node.required.length > 0) out.required = node.required;
    const { email, type } = contact;
    if (email && type) {
      const emailParts = parts(email.field.path);
      const typeParts = parts(type.field.path);
      const parentOf = (segments: string[]) =>
        segments.length === 1 ? '' : `/${segments.slice(0, -1).join('/')}`;
      if (parentOf(emailParts) === pointer && parentOf(typeParts) === pointer) {
        out.dependentRequired = {
          [emailParts.at(-1)!]: [typeParts.at(-1)!],
          [typeParts.at(-1)!]: [emailParts.at(-1)!],
        };
      }
    }
    return out;
  };
  return finish(root, '');
}

const roleOf = (resolved: ResolvedField): string | undefined =>
  resolved.field.storage.kind === 'organisations' ? resolved.field.storage.role : undefined;

function fieldOut(resolved: ResolvedField, choices: ReadonlyMap<string, Choice[]>): SchemaField {
  const { field } = resolved;
  const role = roleOf(resolved);
  const column = field.storage.kind === 'column' ? field.storage.column : undefined;
  const options = choices.get(field.key);
  return {
    key: field.key,
    path: field.path,
    type: resolved.type.id,
    widget: resolved.type.widget,
    label: field.label,
    ...(field.help !== undefined && { help: field.help }),
    required: field.required === true,
    ...(field.default !== undefined && { default: field.default }),
    config: resolved.config,
    ...(role !== undefined && { role }),
    ...(column !== undefined && { column }),
    deferred: isDeferred(resolved),
    ...(field.storage.kind === 'module' && { external: true }),
    ...(options !== undefined && { choices: options }),
    ...(field.showIf !== undefined && { showIf: field.showIf }),
  };
}

const labelFor = (labels: { en: string; de?: string | undefined }, locale: string): string =>
  (labels as Record<string, string | undefined>)[locale] ?? labels.en;

/** The steps in order with their fields (what `applies` hides is the browser's to decide). */
export function buildCreateSchema(
  config: ResolvedConfig,
  roles: readonly OrgRoleEntry[],
  options: BuildOptions,
): CreateSchema {
  const choices = options.choices ?? new Map<string, Choice[]>();
  const locale = options.locale ?? 'en';
  const byStep = new Map<string, ResolvedField[]>();
  for (const resolved of config.fields) {
    byStep.set(resolved.step, [...(byStep.get(resolved.step) ?? []), resolved]);
  }
  const steps = config.steps.map((step: ResolvedStep): SchemaStep => {
    const own = (byStep.get(step.id) ?? []).sort(
      (a, b) =>
        step.fields.findIndex((f) => f.key === a.field.key) -
        step.fields.findIndex((f) => f.key === b.field.key),
    );
    return {
      id: step.id,
      order: step.order,
      title: step.title,
      intro: [...step.intro],
      ...(step.component !== undefined && { component: step.component }),
      contributed: step.source === 'contributed',
      ...(step.showIf !== undefined && { showIf: step.showIf }),
      fields: own.map((resolved) => fieldOut(resolved, choices)),
      schema: stepSchema(own),
    };
  });

  const usedTypes = new Map<string, SchemaFieldType>();
  for (const resolved of config.fields) {
    usedTypes.set(resolved.type.id, {
      id: resolved.type.id,
      widget: resolved.type.widget,
      labels: resolved.type.labels,
    });
  }
  return {
    steps,
    limits: SCHEMA_LIMITS,
    fieldTypes: [...usedTypes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    roles: [...roles]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((role) => ({
        id: role.id,
        label: labelFor(role.labels, locale),
        labels: role.labels,
        orgTypes: [...role.orgTypes],
        min: role.min,
        max: role.max,
        order: role.order,
        memberOnly: role.id === OWNER_ROLE,
      })),
    defaults: defaultsOf(config.fields.map((resolved) => fieldOut(resolved, choices))),
    devConsole: options.devConsole,
  };
}

/**
 * The default object of a new service, generated from the configured fields: each field's `default`, an empty
 * list for a list field, nothing for the rest. Nested at the fields' pointers.
 */
export function defaultsOf(
  fields: readonly Pick<SchemaField, 'path' | 'default' | 'config' | 'deferred'>[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.deferred) continue;
    const value =
      field.default !== undefined
        ? structuredClone(field.default)
        : field.config.multiple === true
          ? []
          : undefined;
    if (value === undefined) continue;
    const segments = parts(field.path);
    let at = out;
    for (const segment of segments.slice(0, -1)) {
      const next = at[segment];
      at = (typeof next === 'object' && next !== null ? next : (at[segment] = {})) as Record<
        string,
        unknown
      >;
    }
    at[segments.at(-1)!] = value;
  }
  return out;
}
