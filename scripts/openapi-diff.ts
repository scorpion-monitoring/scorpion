// `pnpm openapi:diff [--base <ref>] [--file <path>]`: compares the committed OpenAPI document of the public API
// (v1) with the one of the last release tag and fails when the change is not additive (ADR-0037 decision 7,
// ADR-0038; the plan is docs/m8-sprint-plan.md §6 item 8 and Decision 6).
//
// What breaks a client, and so fails here:
//
//   - a removed path, method, parameter, response status, response media type or field;
//   - a type that no longer allows what it did (in a request), or that now allows more (in a response);
//   - a removed enum value; a new enum in a request; stricter bounds, pattern or format in a request;
//   - a new required request field, parameter or body;
//   - a field a response no longer always carries;
//   - a removed or changed security scheme; an operation that now needs a token; a different scope.
//
// Everything else is additive and is only printed. A base without paths (the document of v0.9.0, before v1 had a
// route) makes the new document the first contract, and passes. This is a small script of our own, not a general
// OpenAPI differ; its gaps (listed in docs/backlog.md) are the constraints it does not read: `additionalProperties`,
// `oneOf` with a discriminator, response headers, `default` values and the bounds of a response.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

type Obj = Record<string, unknown>;

export interface Diff {
  breaking: string[];
  additive: string[];
  /** The base had no path: nothing was promised yet, so nothing can be broken. */
  firstContract: boolean;
}

type Role = 'request' | 'response';

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const MAX_DEPTH = 24;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asObj = (value: unknown): Obj => (isObj(value) ? value : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const keysOf = (value: unknown): string[] => Object.keys(asObj(value));

/** Follows a local `$ref` (`#/components/...`); anything else is returned as it is. */
function resolve(document: Obj, node: unknown, depth = 0): unknown {
  if (!isObj(node) || typeof node.$ref !== 'string' || depth > MAX_DEPTH) return node;
  if (!node.$ref.startsWith('#/')) return node;
  let current: unknown = document;
  for (const part of node.$ref.slice(2).split('/')) {
    current = asObj(current)[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return resolve(document, current, depth + 1);
}

const refOf = (node: unknown): string | undefined =>
  isObj(node) && typeof node.$ref === 'string' ? node.$ref : undefined;

/** What a schema allows, flattened over `allOf`, `anyOf` and `oneOf` as far as this script reads it. */
interface Shape {
  types: Set<string>;
  properties: Map<string, unknown>;
  required: Set<string>;
  enumValues: Set<string> | undefined;
  items: unknown;
  constraints: Obj;
}

function shapeOf(document: Obj, schema: unknown, depth = 0): Shape {
  const shape: Shape = {
    types: new Set(),
    properties: new Map(),
    required: new Set(),
    enumValues: undefined,
    items: undefined,
    constraints: {},
  };
  const node = asObj(resolve(document, schema));
  if (depth > MAX_DEPTH) return shape;
  const type = node.type;
  for (const entry of Array.isArray(type) ? type : type === undefined ? [] : [type]) {
    if (typeof entry === 'string') shape.types.add(entry);
  }
  for (const [name, value] of Object.entries(asObj(node.properties))) {
    shape.properties.set(name, value);
  }
  for (const name of asArray(node.required)) if (typeof name === 'string') shape.required.add(name);
  if (Array.isArray(node.enum)) shape.enumValues = new Set(node.enum.map((v) => JSON.stringify(v)));
  if ('const' in node) shape.enumValues = new Set([JSON.stringify(node.const)]);
  shape.items = node.items;
  for (const key of [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'pattern',
    'format',
  ]) {
    if (key in node) shape.constraints[key] = node[key];
  }
  // `allOf` adds to the same object.
  for (const part of asArray(node.allOf)) {
    const inner = shapeOf(document, part, depth + 1);
    for (const t of inner.types) shape.types.add(t);
    for (const [name, value] of inner.properties) shape.properties.set(name, value);
    for (const name of inner.required) shape.required.add(name);
    shape.enumValues ??= inner.enumValues;
    shape.items ??= inner.items;
    Object.assign(shape.constraints, inner.constraints);
  }
  // `anyOf` and `oneOf` allow any of the branches: the types and the enum values are their union, a field is
  // there if any branch has it, and one is required only when every branch requires it.
  for (const key of ['anyOf', 'oneOf']) {
    const branches = asArray(node[key]).map((part) => shapeOf(document, part, depth + 1));
    if (branches.length === 0) continue;
    for (const branch of branches) {
      for (const t of branch.types) shape.types.add(t);
      for (const [name, value] of branch.properties) {
        if (!shape.properties.has(name)) shape.properties.set(name, value);
      }
      if (branch.enumValues) {
        shape.enumValues = new Set([...(shape.enumValues ?? []), ...branch.enumValues]);
      }
      shape.items ??= branch.items;
    }
    for (const name of branches[0]!.required) {
      if (branches.every((branch) => branch.required.has(name))) shape.required.add(name);
    }
  }
  return shape;
}

/** `integer` is a kind of `number`: a response that goes from one to the other is a change, a request that widens is not. */
const allowsType = (types: Set<string>, type: string) =>
  types.has(type) || (type === 'integer' && types.has('number'));

interface Context {
  base: Obj;
  head: Obj;
  diff: Diff;
  seen: Set<string>;
}

const note = (context: Context, breaking: boolean, text: string) =>
  (breaking ? context.diff.breaking : context.diff.additive).push(text);

function compareConstraints(
  context: Context,
  where: string,
  before: Obj,
  after: Obj,
  role: Role,
): void {
  // Only what a client sends is checked; the bounds of an answer are a gap (see the top of the file).
  if (role !== 'request') return;
  const lower = ['minimum', 'exclusiveMinimum', 'minLength', 'minItems'];
  const upper = ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems'];
  for (const key of [...lower, ...upper]) {
    const was = before[key];
    const now = after[key];
    if (was === now) continue;
    if (typeof now !== 'number') {
      note(context, false, `${where}: ${key} removed`);
      continue;
    }
    const stricter = typeof was !== 'number' || (lower.includes(key) ? now > was : now < was);
    note(
      context,
      stricter,
      `${where}: ${key} ${String(was)} → ${now}${stricter ? ' (stricter)' : ''}`,
    );
  }
  for (const key of ['pattern', 'format']) {
    if (before[key] === after[key]) continue;
    note(
      context,
      after[key] !== undefined,
      `${where}: ${key} ${String(before[key])} → ${String(after[key])}`,
    );
  }
}

function compareSchema(
  context: Context,
  where: string,
  before: unknown,
  after: unknown,
  role: Role,
  depth = 0,
): void {
  if (depth > MAX_DEPTH) return;
  const pair = `${role}|${refOf(before) ?? ''}|${refOf(after) ?? ''}`;
  if (refOf(before) && refOf(after)) {
    if (context.seen.has(pair)) return;
    context.seen.add(pair);
  }
  const was = shapeOf(context.base, before);
  const now = shapeOf(context.head, after);

  if (was.types.size > 0 && now.types.size > 0) {
    const gone = [...was.types].filter((type) => !allowsType(now.types, type));
    const added = [...now.types].filter((type) => !allowsType(was.types, type));
    if (gone.length > 0) {
      // A request that stops accepting a type breaks the sender; a response that stops sending one does not.
      note(context, role === 'request', `${where}: type no longer allows ${gone.join(', ')}`);
    }
    if (added.length > 0) {
      // A response that may now be something else breaks the reader; a request that accepts more does not.
      note(context, role === 'response', `${where}: type now also allows ${added.join(', ')}`);
    }
  }

  if (was.enumValues && now.enumValues) {
    for (const value of was.enumValues) {
      if (!now.enumValues.has(value)) note(context, true, `${where}: enum value ${value} removed`);
    }
    for (const value of now.enumValues) {
      if (!was.enumValues.has(value)) note(context, false, `${where}: enum value ${value} added`);
    }
  } else if (!was.enumValues && now.enumValues) {
    note(context, role === 'request', `${where}: now limited to an enum`);
  } else if (was.enumValues && !now.enumValues) {
    note(context, false, `${where}: enum no longer limits the value`);
  }

  compareConstraints(context, where, was.constraints, now.constraints, role);

  for (const [name, schema] of was.properties) {
    if (!now.properties.has(name)) {
      note(context, true, `${where}: field ${name} removed`);
      continue;
    }
    compareSchema(context, `${where}.${name}`, schema, now.properties.get(name), role, depth + 1);
  }
  for (const name of now.properties.keys()) {
    if (!was.properties.has(name)) {
      const required = now.required.has(name);
      note(
        context,
        role === 'request' && required,
        `${where}: field ${name} added${required ? ' (required)' : ''}`,
      );
    }
  }
  for (const name of now.required) {
    if (!was.required.has(name) && was.properties.has(name)) {
      note(context, role === 'request', `${where}: field ${name} is now required`);
    }
  }
  for (const name of was.required) {
    if (!now.required.has(name) && now.properties.has(name)) {
      note(
        context,
        role === 'response',
        `${where}: field ${name} is no longer always ${role === 'response' ? 'sent' : 'required'}`,
      );
    }
  }

  if (was.items !== undefined && now.items !== undefined) {
    compareSchema(context, `${where}[]`, was.items, now.items, role, depth + 1);
  }
}

/** A parameter, whether it is written in place or is a `$ref` to `components.parameters`. */
function parametersOf(document: Obj, operation: Obj, item: Obj): Map<string, Obj> {
  const found = new Map<string, Obj>();
  for (const list of [item.parameters, operation.parameters]) {
    for (const entry of asArray(list)) {
      const parameter = asObj(resolve(document, entry));
      if (typeof parameter.name === 'string' && typeof parameter.in === 'string') {
        found.set(`${parameter.in} ${parameter.name}`, parameter);
      }
    }
  }
  return found;
}

function securityNames(operation: Obj): Set<string> {
  return new Set(asArray(operation.security).flatMap((entry) => keysOf(entry)));
}

function compareOperation(context: Context, where: string, before: Obj, after: Obj): void {
  const { base, head } = context;
  // Who may call it.
  if (before['x-permission'] !== after['x-permission']) {
    note(
      context,
      before['x-permission'] !== undefined,
      `${where}: the scope it needs changed ${String(before['x-permission'])} → ${String(after['x-permission'])}`,
    );
  }
  if (before['x-public'] === true && after['x-public'] !== true) {
    note(context, true, `${where}: no longer public`);
  } else if (before['x-public'] !== true && after['x-public'] === true) {
    note(context, false, `${where}: now public`);
  }
  const hadSecurity = securityNames(before);
  const hasSecurity = securityNames(after);
  // Open is an operation that is public, or says nothing about a token (a document before the schemes).
  const needsToken = (operation: Obj) =>
    operation['x-public'] !== true &&
    (operation['x-permission'] !== undefined || securityNames(operation).size > 0);
  if (!needsToken(before) && before['x-public'] !== true && needsToken(after)) {
    note(context, true, `${where}: now needs a token`);
  }
  for (const name of hadSecurity) {
    if (!hasSecurity.has(name))
      note(context, true, `${where}: security scheme ${name} no longer accepted`);
  }
  for (const name of hasSecurity) {
    if (!hadSecurity.has(name)) note(context, false, `${where}: security scheme ${name} accepted`);
  }

  // What it takes.
  const was = parametersOf(base, before, {});
  const now = parametersOf(head, after, {});
  for (const [key, parameter] of was) {
    const next = now.get(key);
    if (!next) {
      note(context, true, `${where}: parameter ${key} removed`);
      continue;
    }
    if (parameter.required !== true && next.required === true) {
      note(context, true, `${where}: parameter ${key} is now required`);
    }
    compareSchema(context, `${where} parameter ${key}`, parameter.schema, next.schema, 'request');
  }
  for (const [key, parameter] of now) {
    if (!was.has(key)) {
      note(
        context,
        parameter.required === true,
        `${where}: parameter ${key} added${parameter.required === true ? ' (required)' : ''}`,
      );
    }
  }

  const body = asObj(resolve(base, before.requestBody));
  const nextBody = asObj(resolve(head, after.requestBody));
  if (Object.keys(body).length > 0 && Object.keys(nextBody).length === 0) {
    note(context, true, `${where}: request body removed`);
  } else if (Object.keys(body).length === 0 && Object.keys(nextBody).length > 0) {
    note(
      context,
      nextBody.required === true,
      `${where}: request body added${nextBody.required === true ? ' (required)' : ''}`,
    );
  } else if (Object.keys(body).length > 0) {
    if (body.required !== true && nextBody.required === true) {
      note(context, true, `${where}: request body is now required`);
    }
    compareContent(context, `${where} request`, body.content, nextBody.content, 'request');
  }

  // What it answers.
  const answers = asObj(before.responses);
  const nextAnswers = asObj(after.responses);
  for (const status of Object.keys(answers)) {
    if (!(status in nextAnswers)) {
      note(context, true, `${where}: response ${status} removed`);
      continue;
    }
    compareContent(
      context,
      `${where} ${status}`,
      asObj(resolve(base, answers[status])).content,
      asObj(resolve(head, nextAnswers[status])).content,
      'response',
    );
  }
  for (const status of Object.keys(nextAnswers)) {
    if (!(status in answers)) note(context, false, `${where}: response ${status} added`);
  }
}

function compareContent(
  context: Context,
  where: string,
  before: unknown,
  after: unknown,
  role: Role,
): void {
  const was = asObj(before);
  const now = asObj(after);
  for (const type of Object.keys(was)) {
    if (!(type in now)) {
      note(context, true, `${where}: media type ${type} removed`);
      continue;
    }
    compareSchema(
      context,
      `${where} ${type}`,
      asObj(was[type]).schema,
      asObj(now[type]).schema,
      role,
    );
  }
  for (const type of Object.keys(now)) {
    if (!(type in was)) note(context, false, `${where}: media type ${type} added`);
  }
}

/** What changed between two OpenAPI documents, and which of it breaks a client. */
export function diffOpenApi(base: Obj, head: Obj): Diff {
  const diff: Diff = {
    breaking: [],
    additive: [],
    firstContract: keysOf(base.paths).length === 0,
  };
  const context: Context = { base, head, diff, seen: new Set() };

  const was = asObj(base.paths);
  const now = asObj(head.paths);
  for (const path of Object.keys(was)) {
    for (const method of METHODS) {
      const before = asObj(was[path])[method];
      if (before === undefined) continue;
      const after = asObj(now[path])[method];
      const where = `${method.toUpperCase()} ${path}`;
      if (after === undefined) {
        note(context, true, `${where}: removed`);
        continue;
      }
      compareOperation(context, where, asObj(before), asObj(after));
    }
  }
  for (const path of Object.keys(now)) {
    for (const method of METHODS) {
      if (asObj(now[path])[method] !== undefined && asObj(was[path])[method] === undefined) {
        note(context, false, `${method.toUpperCase()} ${path}: added`);
      }
    }
  }

  const schemes = asObj(asObj(base.components).securitySchemes);
  const nextSchemes = asObj(asObj(head.components).securitySchemes);
  for (const name of Object.keys(schemes)) {
    const before = asObj(schemes[name]);
    const after = asObj(nextSchemes[name]);
    if (!(name in nextSchemes)) {
      note(context, true, `security scheme ${name}: removed`);
      continue;
    }
    for (const key of ['type', 'scheme', 'in', 'name']) {
      if (before[key] !== after[key]) {
        note(
          context,
          true,
          `security scheme ${name}: ${key} ${String(before[key])} → ${String(after[key])}`,
        );
      }
    }
  }
  for (const name of Object.keys(nextSchemes)) {
    if (!(name in schemes)) note(context, false, `security scheme ${name}: added`);
  }

  // A first contract has nothing to break: everything in it is new.
  if (diff.firstContract) {
    diff.additive.unshift(...diff.breaking);
    diff.breaking = [];
  }
  return diff;
}

/** The text of a run: what it compared, what it found, and whether it passes. */
export function report(diff: Diff, comparedWith: string): { text: string; passed: boolean } {
  const lines: string[] = [];
  if (diff.firstContract) {
    lines.push(
      `${comparedWith} has no v1 path: this document is the first contract, so nothing can be broken.`,
    );
  } else {
    lines.push(`Compared with ${comparedWith}.`);
  }
  if (diff.breaking.length > 0) {
    lines.push(
      '',
      `Breaking changes (${diff.breaking.length}); v1 changes are additive, so these go to v2 with an ADR:`,
    );
    for (const entry of diff.breaking) lines.push(`  - ${entry}`);
  }
  if (diff.additive.length > 0) {
    lines.push('', `Additive changes (${diff.additive.length}):`);
    for (const entry of diff.additive) lines.push(`  - ${entry}`);
  }
  if (diff.breaking.length === 0 && diff.additive.length === 0) lines.push('', 'No change.');
  return { text: lines.join('\n'), passed: diff.breaking.length === 0 };
}

/** The same report as Markdown, for the summary of a CI job. */
export function markdown(diff: Diff, comparedWith: string): string {
  const { text, passed } = report(diff, comparedWith);
  return `### OpenAPI diff (v1): ${passed ? 'compatible' : 'BREAKING'}\n\n\`\`\`text\n${text}\n\`\`\`\n`;
}

const DOCUMENT = 'apps/web/src/generated/openapi-v1.json';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** The last release tag reachable from `HEAD` (`v<major>.<minor>.<patch>`), or `undefined` when there is none. */
export function lastReleaseTag(): string | undefined {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*') || undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.main) main();

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const file = option('--file') ?? DOCUMENT;
  const ref = option('--base') ?? lastReleaseTag();
  if (!ref) {
    console.log('No release tag is reachable from HEAD: there is no contract to compare with.');
    return;
  }
  let base: Obj = {};
  try {
    base = JSON.parse(git('show', `${ref}:${DOCUMENT}`)) as Obj;
  } catch {
    // The document did not exist at that tag: nothing was promised.
  }
  const head = JSON.parse(readFileSync(file, 'utf8')) as Obj;
  const diff = diffOpenApi(base, head);
  const { text, passed } = report(diff, ref);
  console.log(text);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${markdown(diff, ref)}\n`);
  if (!passed) process.exit(1);
}
