// Validates the body of a create against the configured fields (ADR-0035): the same Zod schema per field
// that the browser gets as JSON Schema, then the checks that need other data. A request that fails is 422
// with one entry per field, and the problem path is the field's pointer as a dotted path (`contact.type`).
import { Invalid, type FieldProblem } from '@scorpion/contracts';
import type { ResolvedConfig, ResolvedField } from '../config/validate.ts';
import type { FieldEnv } from './registries.ts';

export const dotted = (pointer: string) => pointer.slice(1).replaceAll('/', '.');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at a JSON pointer of the nested body, or `undefined`. */
export function valueAt(body: Record<string, unknown>, pointer: string): unknown {
  let current: unknown = body;
  for (const part of pointer.slice(1).split('/')) {
    if (!isObject(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

/** Every pointer in `body` that is neither a field nor a parent of one. */
export function unknownPointers(
  body: Record<string, unknown>,
  paths: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  const walk = (object: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(object)) {
      const pointer = `${prefix}/${key}`;
      if (paths.has(pointer)) continue;
      const isParent = [...paths].some((path) => path.startsWith(`${pointer}/`));
      if (isParent && isObject(value)) walk(value, pointer);
      else found.push(pointer);
    }
  };
  walk(body, '');
  return found;
}

/** The values by field key. A field the body left out (and that has no default) is absent. */
export type FieldValues = Map<string, unknown>;

export async function validateBody(
  config: ResolvedConfig,
  body: unknown,
  env: FieldEnv,
): Promise<FieldValues> {
  if (!isObject(body)) {
    throw new Invalid('The request is not valid.', [
      { in: 'body', path: '', message: 'The body must be an object.' },
    ]);
  }
  const problems: FieldProblem[] = [];
  const problem = (pointer: string, message: string) =>
    problems.push({ in: 'body', path: dotted(pointer), message });

  const paths = new Set(config.fields.map((resolved) => resolved.field.path));
  for (const pointer of unknownPointers(body, paths)) {
    problem(pointer, 'This field is not known.');
  }

  const values: FieldValues = new Map();
  const parsed: { resolved: ResolvedField; value: unknown }[] = [];
  for (const resolved of config.fields) {
    const { field } = resolved;
    let raw = valueAt(body, field.path);
    if (raw === undefined && field.default !== undefined) raw = field.default;
    if (raw === undefined || raw === null) {
      if (field.required) problem(field.path, 'This field is required.');
      continue;
    }
    const result = resolved.schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const extra = issue.path.map(String).join('.');
        problems.push({
          in: 'body',
          path: [dotted(field.path), extra].filter(Boolean).join('.'),
          message: issue.message,
        });
      }
      continue;
    }
    // An emptied description is "not set"; a list or any other value is kept as it is.
    if (result.data === null) {
      if (field.required) problem(field.path, 'This field is required.');
      continue;
    }
    parsed.push({ resolved, value: result.data });
  }

  // The contact point is one thing: both parts or neither.
  const contact = (column: string) =>
    config.fields.find(
      (resolved) =>
        resolved.field.storage.kind === 'column' && resolved.field.storage.column === column,
    );
  const email = contact('contactEmail');
  const type = contact('contactType');
  if (email && type) {
    // Presence is what the body said, not what parsed: a bad address is a bad address, not a missing one.
    const given = (path: string) => {
      const value = valueAt(body, path);
      return value !== undefined && value !== null;
    };
    const hasEmail = given(email.field.path);
    const hasType = given(type.field.path);
    if (hasEmail !== hasType) {
      problem(
        hasEmail ? type.field.path : email.field.path,
        'A contact point needs both an address and a type, or neither.',
      );
    }
  }

  // The checks that need other data run for the values that parsed.
  for (const { resolved, value } of parsed) {
    let final = value;
    const result = await resolved.type.check?.(value, resolved.config, env);
    if (result && 'problem' in result) {
      problem(resolved.field.path, result.problem);
      continue;
    }
    if (result && 'value' in result) final = result.value;
    values.set(resolved.field.key, final);
  }

  if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
  return values;
}
