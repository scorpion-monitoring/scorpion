// What the shared settings form of a widget draws, from the JSON Schema of the widget's configuration (`GET /ui/navigation` lists it, derived
// from the module's Zod schema, ADR-0044). The form knows four fields by name because they are the dashboard's own filter: `service` (a picker
// over the services the person may read), `range` (a choice among the schema's values), `category` (the thematic categories the defaults route
// lists) and any boolean toggle; another string enum is a plain choice. A field of another shape (the lists of per-series states a chart keeps
// for itself) is not drawn: the widget has its own controls for those and the form leaves them as they are. Pure, so a test reads it.
import { checkJsonSchema, type JsonSchema, type SchemaIssue } from './json-schema-check.ts';

export type SettingsField =
  | { kind: 'service'; name: string }
  | { kind: 'range'; name: string; options: string[] }
  | { kind: 'category'; name: string }
  | { kind: 'boolean'; name: string }
  | { kind: 'choice'; name: string; options: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringEnum = (rule: Record<string, unknown>): string[] | undefined => {
  const values = rule.enum;
  return Array.isArray(values) && values.every((value) => typeof value === 'string')
    ? (values as string[])
    : undefined;
};

/** The fields the form draws, in the order of the schema's `properties`. */
export function fieldsOf(schema: JsonSchema): SettingsField[] {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const fields: SettingsField[] = [];
  for (const [name, rule] of Object.entries(properties)) {
    if (!isObject(rule)) continue;
    const options = stringEnum(rule);
    if (name === 'service') fields.push({ kind: 'service', name });
    else if (name === 'range' && options) fields.push({ kind: 'range', name, options });
    else if (name === 'category') fields.push({ kind: 'category', name });
    else if (rule.type === 'boolean') fields.push({ kind: 'boolean', name });
    else if (options) fields.push({ kind: 'choice', name, options });
  }
  return fields;
}

/**
 * What the form sends: the configuration it was opened with, with the drawn fields replaced by the draft. A key the form does not draw
 * (`hidden`, `secondary`) is kept exactly; a draft value of `undefined` leaves the key out.
 */
export function merged(
  config: Readonly<Record<string, unknown>>,
  draft: Readonly<Record<string, unknown>>,
  fields: readonly SettingsField[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  for (const { name } of fields) {
    if (draft[name] === undefined) delete next[name];
    else next[name] = draft[name];
  }
  return next;
}

/** The rules the configuration breaks, by field name (`''` for the whole). Empty: it fits the widget's schema. */
export function problemsOf(
  schema: JsonSchema,
  config: Readonly<Record<string, unknown>>,
): Map<string, SchemaIssue['keyword']> {
  const found = new Map<string, SchemaIssue['keyword']>();
  for (const issue of checkJsonSchema(schema, config)) {
    const name = issue.pointer.split('/')[1] ?? '';
    if (!found.has(name)) found.set(name, issue.keyword);
  }
  return found;
}

/** The label key of a range, with a fallback for a range this catalogue does not know (it is shown as it is). */
export const RANGE_KEYS: Readonly<Record<string, string>> = {
  '3m': 'kit.widget.range.3m',
  '6m': 'kit.widget.range.6m',
  '1y': 'kit.widget.range.1y',
  '2y': 'kit.widget.range.2y',
  all: 'kit.widget.range.all',
};
