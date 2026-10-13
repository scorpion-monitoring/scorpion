// The wizard's form as pure functions: the one nested object addressed by JSON pointers, what it becomes
// in the request (`toBody`), what the browser checks before a step is left (the server's JSON Schema of the
// step, `checkStep`), where an error belongs and which step shows it. No Svelte, no network; every rule is a
// table-driven test (`form-state.test.ts`). The page holds no field, step, limit or type of its own: all of
// it comes from the schema the server sent.
import { checkJsonSchema, type SchemaIssue } from '@scorpion/ui-kit/json-schema';
import type { WizardField, WizardSchema, WizardStep } from './wizard-types.ts';

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const segmentsOf = (pointer: string): string[] =>
  pointer === ''
    ? []
    : pointer
        .slice(1)
        .split('/')
        .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));

/** The value at a JSON pointer of the nested object, or `undefined`. */
export function getAt(form: Tree, pointer: string): unknown {
  let current: unknown = form;
  for (const segment of segmentsOf(pointer)) {
    if (!isTree(current) && !Array.isArray(current)) return undefined;
    current = (current as Tree)[segment];
  }
  return current;
}

/** Sets the value at a pointer, creating the objects on the way; `undefined` removes the key. */
export function setAt(form: Tree, pointer: string, value: unknown): void {
  const segments = segmentsOf(pointer);
  let current = form;
  for (const segment of segments.slice(0, -1)) {
    if (!isTree(current[segment])) current[segment] = {};
    current = current[segment] as Tree;
  }
  const last = segments.at(-1)!;
  if (value === undefined) delete current[last];
  else current[last] = value;
}

/** The fields of the steps that are part of the body, in the order of the steps. */
export const bodyFields = (steps: readonly WizardStep[]): WizardField[] =>
  steps.flatMap((step) => step.fields).filter((field) => !field.deferred);

/** The form a new service starts from: the server's defaults, copied. */
export const startForm = (schema: Pick<WizardSchema, 'defaults'>): Tree =>
  structuredClone(schema.defaults) as Tree;

const isList = (field: WizardField) => field.config.multiple === true;

/** One value as the request carries it: text is trimmed and an empty text is no value. */
function cleaned(value: unknown, field: WizardField): unknown {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? undefined : text;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === 'string' ? item.trim() : item))
      .filter((item) => item !== '' && item !== undefined && item !== null);
    // An emptied list is a list: the server reads `[]` as "none", the same as a field left out.
    return items.length === 0 && !isList(field) ? undefined : items;
  }
  if (value === null) return undefined;
  return value;
}

/** Removes the objects that were emptied: `contact` with no part is no contact point. */
function pruneEmpty(tree: Tree): void {
  for (const [key, value] of Object.entries(tree)) {
    if (isTree(value)) {
      pruneEmpty(value);
      if (Object.keys(value).length === 0) delete tree[key];
    }
  }
}

/**
 * What the form sends: every text trimmed, an emptied optional field left out, an emptied list `[]`, a
 * contact point with no part left out (with one part it is kept, and the step's pair rule says what is
 * missing), nothing for a field that is set after the service exists (the icon). A key the schema does not
 * name is kept, so the check and the server judge it, never the mapping.
 */
export function toBody(form: Tree, schema: Pick<WizardSchema, 'steps'>): Tree {
  const body = structuredClone(form) as Tree;
  const fields = schema.steps.flatMap((step) => step.fields);
  for (const field of fields) {
    if (field.deferred) {
      setAt(body, field.path, undefined);
      continue;
    }
    const raw = getAt(body, field.path);
    const value = cleaned(raw, field);
    if (value === undefined && isList(field)) setAt(body, field.path, []);
    else setAt(body, field.path, value);
  }
  pruneEmpty(body);
  // A list field whose parent was pruned must still be there; the loop above runs before the prune, so set again.
  for (const field of fields) {
    if (!field.deferred && isList(field) && getAt(body, field.path) === undefined) {
      setAt(body, field.path, []);
    }
  }
  return body;
}

/** The part of a body that belongs to one step: its fields' pointers, at the same places. */
export function bodyForStep(body: Tree, step: WizardStep): Tree {
  const part: Tree = {};
  for (const field of step.fields) {
    if (field.deferred) continue;
    const value = getAt(body, field.path);
    if (value !== undefined) setAt(part, field.path, structuredClone(value));
  }
  return part;
}

/** The rules of the step's JSON Schema that the body breaks. */
export function checkStep(step: WizardStep, body: Tree): SchemaIssue[] {
  return checkJsonSchema(step.schema, bodyForStep(body, step));
}

/**
 * The keys of the body that no field of the schema owns, as pointers. They are in no step's schema, so
 * the steps cannot see them; the console can put them in the body, and the server would answer 422.
 */
export function unknownPointers(body: Tree, schema: Pick<WizardSchema, 'steps'>): string[] {
  const paths = bodyFields(schema.steps).map((field) => field.path);
  const deferred = schema.steps.flatMap((step) => step.fields).filter((f) => f.deferred);
  const found: string[] = [];
  const walk = (tree: Tree, prefix: string) => {
    for (const [key, value] of Object.entries(tree)) {
      const pointer = `${prefix}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (paths.includes(pointer)) continue;
      if (paths.some((path) => path.startsWith(`${pointer}/`)) && isTree(value))
        walk(value, pointer);
      else if (!deferred.some((field) => field.path === pointer)) found.push(pointer);
    }
  };
  walk(body, '');
  return found;
}

export interface FieldError {
  pointer: string;
  keyword: SchemaIssue['keyword'] | 'server';
  limit?: number | undefined;
  detail?: string | undefined;
}

/** The step a pointer belongs to: the step with a field at that pointer or below it. */
export function stepOfPointer(steps: readonly WizardStep[], pointer: string): string | undefined {
  return steps.find((step) =>
    step.fields.some((field) => pointer === field.path || pointer.startsWith(`${field.path}/`)),
  )?.id;
}

/** The first step, in order, that holds a pointer with an error; `undefined` when none of the pointers is a field. */
export function firstStepWithError(
  steps: readonly WizardStep[],
  pointers: Iterable<string>,
): string | undefined {
  const wanted = new Set<string>();
  for (const pointer of pointers) {
    const id = stepOfPointer(steps, pointer);
    if (id !== undefined) wanted.add(id);
  }
  return steps.find((step) => wanted.has(step.id))?.id;
}

/** The steps shown for this form state: a step is hidden only when its `applies` says so. */
export function visibleSteps(
  steps: readonly WizardStep[],
  form: Tree,
  applies: Readonly<Record<string, ((form: Tree) => boolean) | undefined>>,
): WizardStep[] {
  return steps.filter((step) => applies[step.id]?.(form) !== false);
}
