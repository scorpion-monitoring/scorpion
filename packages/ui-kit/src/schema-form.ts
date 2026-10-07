// What `SchemaForm` knows about a JSON Schema (the output of `z.toJSONSchema`), as plain functions: which
// kind of field a schema is, its label, hint and group, its default, and how a failure of the server maps
// onto a field. No Svelte here, so every rule is a table-driven test.
//
// The convention (M5 plan, decision 6; written up in the README of this package). A module describes a
// setting with Zod's `.meta({ title, description, group, order, widget })`; Zod copies those keys into
// the JSON Schema and this file reads only them (the `x-` prefix is accepted too: `x-group`, `x-order`,
// `x-widget`). `.describe(text)` is `description`. Nothing else in a schema changes the form, so a key
// that is not described still gets a field, labelled with its name in words.
export type JsonSchema = { readonly [key: string]: unknown };

export type FieldKind =
  | 'string'
  | 'text'
  | 'password'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'scalarArray'
  | 'objectArray'
  | 'object'
  | 'oneOf'
  /** A shape the form cannot draw (a record, a tuple, no type at all). It is kept as it was and never edited. */
  | 'opaque';

export interface Option {
  /** The value as stored (a string, a number or a boolean). */
  value: string | number | boolean;
  label: string;
}

export interface FieldNode {
  /** Where the field is in the value, as a JSON pointer (`/sessions/inactivityDays`, `/items/0/name`). */
  pointer: string;
  /** The last part of the pointer: the key, or the index of an array item as a string. */
  key: string;
  kind: FieldKind;
  label: string;
  description: string | undefined;
  /** The group (a fieldset) of the field in its parent object. */
  group: string | undefined;
  order: number | undefined;
  /** The name of a custom widget (`logo`) that the page registered, if the schema asks for one. */
  widget: string | undefined;
  required: boolean;
  /** The schema may be `null`: an empty field is stored as `null`. */
  nullable: boolean;
  schema: JsonSchema;
  /** The whole schema the field came from, which `$ref`s are resolved against. */
  root: JsonSchema;
  defaultValue: unknown;
  /** Strings. */
  format: string | undefined;
  minLength: number | undefined;
  maxLength: number | undefined;
  pattern: string | undefined;
  /** Numbers. */
  minimum: number | undefined;
  maximum: number | undefined;
  /** `enum`, and the variants of `oneOf`. */
  options: Option[];
  /** Arrays. */
  minItems: number | undefined;
  maxItems: number | undefined;
  /** A `const` (the discriminator of a variant): fixed by the schema, never drawn. */
  fixed: boolean;
  /** A secret field: `writeOnly`. It never shows a stored value and is sent only when something was typed. */
  writeOnly: boolean;
  /** `object`: the fields in display order. */
  children: FieldNode[];
  /** Arrays: the schema of one item, described again for every item (its pointer differs). */
  items: JsonSchema | undefined;
  /** `oneOf`: the variants, in the order of the schema. */
  variants: JsonSchema[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** `x-group` and `group` mean the same; the plain name is what Zod's `.meta()` writes. */
function meta(schema: JsonSchema, name: 'group' | 'order' | 'widget'): unknown {
  return schema[name] ?? schema[`x-${name}`];
}

/** `inactivityDays` becomes `Inactivity days`. A schema with a `title` never needs this. */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words === '' ? key : words[0]!.toUpperCase() + words.slice(1);
}

/** One JSON pointer segment, escaped (`~` is `~0`, `/` is `~1`). */
export const pointerSegment = (segment: string | number) =>
  String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

export const childPointer = (parent: string, segment: string | number) =>
  `${parent}/${pointerSegment(segment)}`;

/**
 * The pointer a server message names. The API reports `sessions.absoluteDays` (dotted, with `0` for an
 * array index); a JSON pointer (`/sessions/absoluteDays`) is accepted too. `prefix` is what the API puts in
 * front (`values` for a settings body) and is dropped. A path that does not start with the prefix is kept.
 */
export function pointerOf(path: string, prefix?: string): string {
  if (path.startsWith('/')) return path;
  let segments = path === '' ? [] : path.split('.');
  if (prefix !== undefined && segments[0] === prefix) segments = segments.slice(1);
  return segments.map((segment) => `/${pointerSegment(segment)}`).join('');
}

/** The messages of a failure, by the pointer of the field they belong to. */
export function errorsByPointer(
  fields: Readonly<Record<string, readonly string[]>>,
  prefix?: string,
): Map<string, string[]> {
  const byPointer = new Map<string, string[]>();
  for (const [path, messages] of Object.entries(fields)) {
    const pointer = pointerOf(path, prefix);
    byPointer.set(pointer, [...(byPointer.get(pointer) ?? []), ...messages]);
  }
  return byPointer;
}

/**
 * Messages for a field: its own, and — when the server named a part inside a field the form draws as one
 * control (an array of strings, an opaque value) — the messages of anything below it.
 */
export function messagesFor(
  errors: ReadonlyMap<string, readonly string[]>,
  pointer: string,
  includeBelow = false,
): string[] {
  const own = [...(errors.get(pointer) ?? [])];
  if (!includeBelow) return own;
  for (const [other, messages] of errors) {
    if (other.startsWith(`${pointer}/`)) own.push(...messages);
  }
  return own;
}

/** True when the pointer, or anything below it, has a message. A fieldset uses it to open and to say "has errors". */
export function hasErrorsUnder(errors: ReadonlyMap<string, readonly string[]>, pointer: string) {
  for (const other of errors.keys()) {
    if (other === pointer || other.startsWith(`${pointer}/`)) return true;
  }
  return false;
}

/** Follows a local `$ref` (`#/$defs/name`) and merges `allOf`; other schemas are returned as they are. */
export function resolve(schema: JsonSchema, root: JsonSchema, depth = 0): JsonSchema {
  if (depth > 20) return schema;
  const ref = schema.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    let target: unknown = root;
    for (const part of ref.slice(2).split('/')) {
      target = isObject(target)
        ? target[part.replaceAll('~1', '/').replaceAll('~0', '~')]
        : undefined;
    }
    if (isObject(target)) {
      const rest: Record<string, unknown> = { ...schema };
      delete rest.$ref;
      return resolve({ ...target, ...rest }, root, depth + 1);
    }
  }
  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = { ...schema };
    delete merged.allOf;
    for (const part of schema.allOf) {
      if (!isObject(part)) continue;
      const resolved = resolve(part, root, depth + 1);
      const { properties, required, ...rest } = resolved;
      Object.assign(merged, rest);
      if (isObject(properties)) {
        merged.properties = { ...(merged.properties as object | undefined), ...properties };
      }
      if (Array.isArray(required)) {
        merged.required = [
          ...((merged.required as unknown[] | undefined) ?? []),
          ...(required as unknown[]),
        ];
      }
    }
    return merged;
  }
  return schema;
}

/** `anyOf: [x, { type: 'null' }]` is `x` that may be null. Returns the inner schema and whether null is allowed. */
function withoutNull(
  schema: JsonSchema,
  root: JsonSchema,
): { schema: JsonSchema; nullable: boolean } {
  const choices = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(choices)) {
    const real = choices.filter(
      (choice): choice is JsonSchema => isObject(choice) && resolve(choice, root).type !== 'null',
    );
    if (real.length === 1 && real.length < choices.length) {
      const outer: Record<string, unknown> = { ...schema };
      delete outer.anyOf;
      delete outer.oneOf;
      return { schema: resolve({ ...real[0], ...outer }, root), nullable: true };
    }
  }
  if (Array.isArray(schema.type) && schema.type.includes('null')) {
    const rest = schema.type.filter((type) => type !== 'null');
    if (rest.length === 1) return { schema: { ...schema, type: rest[0] }, nullable: true };
  }
  return { schema, nullable: false };
}

function kindOf(schema: JsonSchema, root: JsonSchema): FieldKind {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'enum';
  if ('const' in schema) return 'opaque';
  const choices = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(choices) && choices.length > 1 && choices.every(isObject)) return 'oneOf';
  switch (schema.type) {
    case 'string':
      if (schema.writeOnly === true) return 'password';
      if (schema.format === 'textarea' || meta(schema, 'widget') === 'textarea') return 'text';
      if (num(schema.maxLength) !== undefined && num(schema.maxLength)! > 300) return 'text';
      return 'string';
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return isObject(schema.properties) && Object.keys(schema.properties).length > 0
        ? 'object'
        : 'opaque';
    case 'array': {
      const items = isObject(schema.items) ? resolve(schema.items, root) : undefined;
      if (!items) return 'opaque';
      const inner = withoutNull(items, root).schema;
      const itemKind = kindOf(inner, root);
      if (itemKind === 'object' || itemKind === 'oneOf') return 'objectArray';
      if (['string', 'text', 'number', 'integer', 'enum'].includes(itemKind)) return 'scalarArray';
      return 'opaque';
    }
    default:
      return 'opaque';
  }
}

function optionsOf(schema: JsonSchema, kind: FieldKind): Option[] {
  if (kind === 'enum') {
    return (schema.enum as unknown[])
      .filter((value): value is string | number | boolean =>
        ['string', 'number', 'boolean'].includes(typeof value),
      )
      .map((value) => ({ value, label: String(value) }));
  }
  return [];
}

const variantsOf = (schema: JsonSchema, root: JsonSchema): JsonSchema[] =>
  ((schema.oneOf ?? schema.anyOf) as unknown[] | undefined)
    ?.filter(isObject)
    .map((variant) => resolve(variant, root)) ?? [];

/**
 * Describes one schema as a field. `required` is whether the parent lists the key as required (a field
 * with a default is not, because the server fills it in).
 */
export function describeField(
  raw: JsonSchema,
  root: JsonSchema,
  where: { pointer: string; key: string; required?: boolean },
): FieldNode {
  const resolved = resolve(raw, root);
  const { schema, nullable } = withoutNull(resolved, root);
  const kind = kindOf(schema, root);
  const group = text(meta(schema, 'group')) ?? text(meta(resolved, 'group'));
  const children: FieldNode[] = [];
  if (kind === 'object') {
    const properties = schema.properties as Record<string, unknown>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    for (const [key, child] of Object.entries(properties)) {
      if (!isObject(child)) continue;
      children.push(
        describeField(child, root, {
          pointer: childPointer(where.pointer, key),
          key,
          required: required.has(key),
        }),
      );
    }
    // Declaration order is the fallback; `order` puts a field earlier or later.
    children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  const items =
    kind === 'scalarArray' || kind === 'objectArray' ? (schema.items as JsonSchema) : undefined;
  const order = num(meta(schema, 'order')) ?? num(meta(resolved, 'order'));
  return {
    pointer: where.pointer,
    key: where.key,
    kind,
    label: text(schema.title) ?? text(resolved.title) ?? humanize(where.key),
    description: text(schema.description) ?? text(resolved.description),
    group,
    order,
    widget: text(meta(schema, 'widget')) ?? text(meta(resolved, 'widget')),
    required: where.required ?? false,
    nullable,
    schema,
    root,
    defaultValue: schema.default ?? resolved.default,
    format: text(schema.format),
    minLength: num(schema.minLength),
    maxLength: num(schema.maxLength),
    pattern: text(schema.pattern),
    minimum: num(schema.minimum) ?? num(schema.exclusiveMinimum),
    maximum: num(schema.maximum) ?? num(schema.exclusiveMaximum),
    options: optionsOf(schema, kind),
    minItems: num(schema.minItems),
    maxItems: num(schema.maxItems),
    fixed: 'const' in schema,
    writeOnly: schema.writeOnly === true,
    children,
    items,
    variants: kind === 'oneOf' ? variantsOf(schema, root) : [],
  };
}

/** The form's tree for a whole schema: the root object (or, for any other shape, one opaque field). */
export function describeRoot(schema: JsonSchema): FieldNode {
  return describeField(schema, schema, { pointer: '', key: '' });
}

/** The children of an object in display groups: those with no group first, then the groups in order of first use. */
export function groupChildren(
  children: readonly FieldNode[],
): { name: string | undefined; fields: FieldNode[] }[] {
  const groups: { name: string | undefined; fields: FieldNode[] }[] = [];
  for (const child of children) {
    // A nested object is its own fieldset; it does not join the loose fields of its parent.
    const name = child.group;
    let group = groups.find((candidate) => candidate.name === name);
    if (!group) groups.push((group = { name, fields: [] }));
    group.fields.push(child);
  }
  // Loose fields lead, as in a form that has a general part and then sections.
  return groups.sort((a, b) => Number(b.name === undefined) - Number(a.name === undefined));
}

/** A value for a field the person has not touched: its default, else the empty value of its kind. */
export function emptyValue(node: FieldNode): unknown {
  if (node.defaultValue !== undefined) return structuredClone(node.defaultValue);
  switch (node.kind) {
    case 'string':
    case 'text':
    case 'password':
      return '';
    case 'boolean':
      return false;
    case 'scalarArray':
    case 'objectArray':
      return [];
    case 'object': {
      const value: Record<string, unknown> = {};
      for (const child of node.children) {
        if (child.required || child.defaultValue !== undefined)
          value[child.key] = emptyValue(child);
      }
      return value;
    }
    case 'enum':
      return node.options[0]?.value;
    case 'oneOf':
      return undefined;
    default:
      return undefined;
  }
}

/**
 * What the form sends. An empty text, an empty number box and a secret nobody typed are left out, so an
 * optional field that was cleared is unset and a stored secret is never sent back. Arrays and objects are
 * pruned inside. An opaque value is kept as it was.
 */
export function prune(value: unknown, node: FieldNode): unknown {
  switch (node.kind) {
    case 'string':
    case 'text':
    case 'password': {
      if (typeof value !== 'string') return value;
      if (value === '') return node.nullable ? null : undefined;
      return value;
    }
    case 'number':
    case 'integer':
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (value === '' || value === null || Number.isNaN(value))
        return node.nullable ? null : undefined;
      return value;
    case 'object': {
      if (!isObject(value)) return value;
      const out: Record<string, unknown> = {};
      for (const child of node.children) {
        const cleaned = prune(value[child.key], child);
        if (cleaned !== undefined) out[child.key] = cleaned;
      }
      // Keys the schema does not name are kept: the form must not lose what it cannot draw.
      for (const [key, other] of Object.entries(value)) {
        if (!node.children.some((child) => child.key === key) && other !== undefined)
          out[key] = other;
      }
      return out;
    }
    case 'scalarArray':
      return Array.isArray(value)
        ? value.filter((item) => item !== '' && item !== undefined)
        : value;
    case 'objectArray': {
      if (!Array.isArray(value)) return value;
      return value.map((item, index) => {
        const itemNode = describeField(node.items ?? {}, node.root, {
          pointer: childPointer(node.pointer, index),
          key: String(index),
          required: true,
        });
        return prune(item, itemNode);
      });
    }
    default:
      return value;
  }
}

/** Which variant of a `oneOf` a value matches: the first whose `const` and `enum` properties agree with it. */
export function variantIndex(variants: readonly JsonSchema[], value: unknown): number {
  if (!isObject(value)) return -1;
  return variants.findIndex((variant) => {
    const properties = isObject(variant.properties) ? variant.properties : {};
    const pinned = Object.entries(properties).filter(
      ([, schema]) => isObject(schema) && ('const' in schema || Array.isArray(schema.enum)),
    );
    if (pinned.length === 0) return false;
    return pinned.every(([key, schema]) => {
      const rule = schema as JsonSchema;
      return 'const' in rule
        ? value[key] === rule.const
        : (rule.enum as unknown[]).includes(value[key]);
    });
  });
}

/** The label of a variant: its title, else the value of its pinned property, else "Option n". */
export function variantLabel(
  variant: JsonSchema,
  index: number,
  option: (n: number) => string,
): string {
  const title = text(variant.title);
  if (title) return title;
  const properties = isObject(variant.properties) ? variant.properties : {};
  for (const schema of Object.values(properties)) {
    if (isObject(schema) && typeof schema.const === 'string') return schema.const;
  }
  return option(index + 1);
}

/** The step of a number box: whole numbers for an integer, any for a number. */
export const stepOf = (node: Pick<FieldNode, 'kind'>) => (node.kind === 'integer' ? '1' : 'any');

/** The values a variant pins (`const`, or a one-value `enum`), which a new item of that variant starts with. */
export function variantSeed(variant: JsonSchema): Record<string, unknown> {
  const properties = isObject(variant.properties) ? variant.properties : {};
  const seed: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(properties)) {
    if (!isObject(schema)) continue;
    if ('const' in schema) seed[key] = schema.const;
    else if (Array.isArray(schema.enum) && schema.enum.length === 1) seed[key] = schema.enum[0];
  }
  return seed;
}

/**
 * The name of the field a pointer leads to, with its parents for context (`Providers › Item 1 › Client id`),
 * for the summary of a failed save. Falls back to the pointer itself where the schema does not know the part.
 */
export function labelOfPointer(
  root: FieldNode,
  pointer: string,
  item: (index: number) => string,
): string {
  if (pointer === '') return root.label;
  const labels: string[] = [];
  let node: FieldNode | undefined = root;
  for (const raw of pointer.slice(1).split('/')) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!node) {
      labels.push(humanize(segment));
      continue;
    }
    if (node.kind === 'object') {
      node = node.children.find((child) => child.key === segment);
      if (node) labels.push(node.label);
      else labels.push(humanize(segment));
    } else if (
      (node.kind === 'objectArray' || node.kind === 'scalarArray') &&
      /^\d+$/.test(segment)
    ) {
      labels.push(item(Number(segment) + 1));
      node =
        node.kind === 'objectArray' && node.items
          ? describeField(node.items, node.root, {
              pointer: childPointer(node.pointer, segment),
              key: segment,
              required: true,
            })
          : undefined;
    } else if (node.kind === 'oneOf') {
      // The fields of the chosen variant are not known from the schema alone; name the key.
      labels.push(humanize(segment));
      node = undefined;
    } else {
      labels.push(humanize(segment));
      node = undefined;
    }
  }
  return labels.join(' › ');
}
