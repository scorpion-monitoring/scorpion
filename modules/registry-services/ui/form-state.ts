// The wizard's form as pure functions: the one nested object addressed by JSON pointers, what it becomes
// in the request (`toBody`), what the browser checks before a step is left (the server's JSON Schema of the
// step, `checkStep`), where an error belongs and which step shows it. No Svelte, no network; every rule is a
// table-driven test (`form-state.test.ts`). The page holds no field, step, limit or type of its own: all of
// it comes from the schema the server sent.
import { checkJsonSchema, type SchemaIssue } from '@scorpion/ui-kit/json-schema';
import { failureMessage, type FormFailure } from '@scorpion/ui-kit/forms';
import { errorsByPointer, sameJson } from '@scorpion/ui-kit/schema-form';
import type { WizardField, WizardSchema, WizardShowIf, WizardStep } from './wizard-types.ts';

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
  structuredClone(schema.defaults);

const isList = (field: WizardField) => field.config.multiple === true;

/** One value as the request carries it: text is trimmed and an empty text is no value. */
function cleaned(value: unknown, field: WizardField): unknown {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? undefined : text;
  }
  if (Array.isArray(value)) {
    const items = (value as unknown[])
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
  return toBodyOf(
    form,
    schema.steps.flatMap((step) => step.fields),
  );
}

/** {@link toBody} over a list of fields: the edit form maps only the fields it draws. */
export function toBodyOf(form: Tree, fields: readonly WizardField[]): Tree {
  const body = structuredClone<Tree>(form);
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

/** Whether a condition of the server (`showIf`) holds for the form; no condition always holds. The server asks the same. */
export function showIfHolds(condition: WizardShowIf | undefined, form: Tree): boolean {
  if (!condition) return true;
  const value = getAt(form, condition.path);
  return condition.oneOf !== undefined
    ? condition.oneOf.some((option) => sameJson(option, value))
    : sameJson(condition.equals, value);
}

/** The steps shown for this form state: hidden when `applies` says so or when the step's own `showIf` fails. */
export function visibleSteps(
  steps: readonly WizardStep[],
  form: Tree,
  applies: Readonly<Record<string, ((form: Tree) => boolean) | undefined>>,
): WizardStep[] {
  return steps.filter(
    (step) => applies[step.id]?.(form) !== false && showIfHolds(step.showIf, form),
  );
}

/** Whether a field of a shown step is itself shown. */
export const fieldShown = (field: WizardField, form: Tree): boolean =>
  showIfHolds(field.showIf, form);

/**
 * The body without the fields the form hides (a hidden field, or a field of a hidden step): they are not sent and
 * not checked, as the server drops them. `hidden` lists the pointers.
 */
export function withoutHidden(body: Tree, schema: Pick<WizardSchema, 'steps'>, form: Tree): Tree {
  const out = structuredClone<Tree>(body);
  for (const step of schema.steps) {
    const stepHidden = !showIfHolds(step.showIf, form);
    for (const field of step.fields)
      if (stepHidden || !fieldShown(field, form)) setAt(out, field.path, undefined);
  }
  pruneEmpty(out);
  return out;
}

// ----- the errors on the fields -----------------------------------------------------------------------------

/** Messages for one pointer, with the value the pointer held when they were found: they go when it changes. */
export interface Shown {
  messages: string[];
  at: unknown;
}

export const noErrors = (): Map<string, Shown> => new Map();

/** Remembers messages by pointer together with the value each pointer holds in `body`. */
export function rememberErrors(
  messages: Iterable<readonly [string, readonly string[]]>,
  body: Tree,
): Map<string, Shown> {
  return new Map(
    [...messages].map(([pointer, list]) => [
      pointer,
      { messages: [...list], at: structuredClone(getAt(body, pointer)) },
    ]),
  );
}

/** What is shown for `body`: the remembered messages whose field still holds the value they were found for. */
export function shownErrors(found: ReadonlyMap<string, Shown>, body: Tree): Map<string, string[]> {
  return new Map(
    [...found]
      .filter(([pointer, entry]) => sameJson(getAt(body, pointer), entry.at))
      .map(([pointer, entry]) => [pointer, entry.messages]),
  );
}

/** The remembered messages without those of one step's fields (pointers at or below them). */
export function withoutStep(
  found: ReadonlyMap<string, Shown>,
  step: WizardStep,
): [string, Shown][] {
  const own = step.fields.map((field) => field.path);
  return [...found].filter(
    ([pointer]) => !own.some((path) => pointer === path || pointer.startsWith(`${path}/`)),
  );
}

// ----- what the server said ---------------------------------------------------------------------------------

/** What to show for a failed `POST /services`: messages on fields (by pointer) and lines for the whole form. */
export interface FailureView {
  messages: [string, string[]][];
  loose: string[];
}

/**
 * Reads a failure of the create request. A 409 for the slug is shown on the slug field in the catalogue's words,
 * without the value; a 403 is one sentence for the form; a 422 puts the server's messages on the fields they
 * name (the pointer of the path), and a message for a pointer that is no field goes to the form with its
 * pointer, so nothing is dropped. Anything else is the generic sentence of its status.
 */
export function failureView(
  failure: FormFailure,
  schema: Pick<WizardSchema, 'steps'>,
  t: (key: string, params?: Record<string, string | number>) => string,
  /** The sentence for a 403 of this request: the create form and the edit form refuse for different reasons. */
  forbiddenKey = 'services.error.forbidden',
): FailureView {
  const messages: [string, string[]][] = [];
  const loose: string[] = [];
  const slug = schema.steps.flatMap((step) => step.fields).find((field) => field.column === 'slug');
  if (failure.type?.endsWith('slug-taken') && slug) {
    messages.push([slug.path, [t('services.error.slugTaken')]]);
  } else if (failure.status === 403) {
    loose.push(t(forbiddenKey));
  } else if (Object.keys(failure.fields).length > 0 || failure.general.length > 0) {
    for (const [pointer, list] of errorsByPointer(failure.fields)) {
      if (stepOfPointer(schema.steps, pointer) !== undefined) messages.push([pointer, list]);
      else loose.push(...list.map((message) => `${pointer || '/'}: ${message}`));
    }
    loose.push(...failure.general);
  } else {
    loose.push(failureMessage(failure, t));
  }
  return { messages, loose };
}
