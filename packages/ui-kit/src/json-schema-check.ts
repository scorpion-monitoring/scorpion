// A small checker for the JSON Schemas the server sends a form (`GET /services/schema`): the subset that the
// field types' `jsonSchema()` use. It is the browser's half of "validated in the browser and on the server":
// the person is told about a mistake before the request, and the server still judges every value.
//
// Pure, no Svelte and no dependency. A keyword that asserts something this file does not implement (`oneOf`,
// `$ref`, `not`, ...) is reported as an issue of its own (`unsupported`) instead of being skipped, so a schema
// that outgrows the checker fails loudly in a test and in the browser, and never passes silently. Annotation
// keywords (`title`, `description`, `default`, `format`, `widget`, ...) change nothing, as in Draft 2020-12
// where `format` is an annotation unless asked to assert: the generated schemas carry a `pattern` for what
// they want checked. Lengths count UTF-16 units, as `z.string().max()` does on the server.
export type JsonSchema = { readonly [key: string]: unknown };

/** What one failed rule says: where (a JSON pointer into the value), which keyword, and its limit if it has one. */
export interface SchemaIssue {
  pointer: string;
  keyword:
    | 'type'
    | 'required'
    | 'additionalProperties'
    | 'enum'
    | 'const'
    | 'minLength'
    | 'maxLength'
    | 'pattern'
    | 'minimum'
    | 'maximum'
    | 'minItems'
    | 'maxItems'
    | 'uniqueItems'
    | 'dependentRequired'
    | 'unsupported';
  /** `maxLength`, `maxItems`, ...: the number the rule names. For `unsupported`, the keyword's name is in `detail`. */
  limit?: number;
  /** For `unsupported`: the keyword. For `dependentRequired`: the key that is missing. */
  detail?: string;
}

const ASSERTIONS_NOT_HANDLED = [
  '$ref',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'patternProperties',
  'propertyNames',
  'contains',
  'prefixItems',
  'multipleOf',
  'dependentSchemas',
  'minProperties',
  'maxProperties',
  'exclusiveMinimum',
  'exclusiveMaximum',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const childPointer = (parent: string, segment: string | number) =>
  `${parent}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

const matchesType = (expected: string, value: unknown): boolean => {
  const actual = typeOf(value);
  return actual === expected || (expected === 'number' && actual === 'integer');
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const regexes = new Map<string, RegExp | null>();
function regexOf(pattern: string): RegExp | null {
  if (!regexes.has(pattern)) {
    try {
      regexes.set(pattern, new RegExp(pattern, 'u'));
    } catch {
      regexes.set(pattern, null);
    }
  }
  return regexes.get(pattern)!;
}

function visit(schema: JsonSchema, value: unknown, pointer: string, issues: SchemaIssue[]): void {
  for (const keyword of ASSERTIONS_NOT_HANDLED) {
    if (keyword in schema) issues.push({ pointer, keyword: 'unsupported', detail: keyword });
  }
  const type = schema.type;
  if (typeof type === 'string' && !matchesType(type, value)) {
    issues.push({ pointer, keyword: 'type', detail: type });
    return;
  }
  if (Array.isArray(type) && !type.some((entry) => matchesType(String(entry), value))) {
    issues.push({ pointer, keyword: 'type', detail: type.join('|') });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => same(entry, value))) {
    issues.push({ pointer, keyword: 'enum' });
  }
  if ('const' in schema && !same(schema.const, value)) issues.push({ pointer, keyword: 'const' });

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ pointer, keyword: 'minLength', limit: schema.minLength });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ pointer, keyword: 'maxLength', limit: schema.maxLength });
    }
    if (typeof schema.pattern === 'string') {
      const regex = regexOf(schema.pattern);
      if (regex === null) issues.push({ pointer, keyword: 'unsupported', detail: 'pattern' });
      else if (!regex.test(value)) issues.push({ pointer, keyword: 'pattern' });
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ pointer, keyword: 'minimum', limit: schema.minimum });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ pointer, keyword: 'maximum', limit: schema.maximum });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ pointer, keyword: 'minItems', limit: schema.minItems });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ pointer, keyword: 'maxItems', limit: schema.maxItems });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) issues.push({ pointer, keyword: 'uniqueItems' });
    }
    if (isObject(schema.items)) {
      value.forEach((item, index) =>
        visit(schema.items as JsonSchema, item, childPointer(pointer, index), issues),
      );
    }
  }

  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && value[key] === undefined) {
          issues.push({ pointer: childPointer(pointer, key), keyword: 'required' });
        }
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      const rule = properties[key];
      if (isObject(rule)) visit(rule, entry, childPointer(pointer, key), issues);
      else if (schema.additionalProperties === false) {
        issues.push({ pointer: childPointer(pointer, key), keyword: 'additionalProperties' });
      }
    }
    if (isObject(schema.dependentRequired)) {
      for (const [key, needed] of Object.entries(schema.dependentRequired)) {
        if (value[key] === undefined || !Array.isArray(needed)) continue;
        for (const other of needed) {
          if (typeof other === 'string' && value[other] === undefined) {
            issues.push({
              pointer: childPointer(pointer, other),
              keyword: 'dependentRequired',
              detail: key,
            });
          }
        }
      }
    }
  }
}

/**
 * The rules of `schema` that `value` breaks, in the order found (none: it fits). `undefined` stands for a
 * missing value in an object; `null` is a value of its own, and fails a `type: string`.
 */
export function checkJsonSchema(schema: JsonSchema, value: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  visit(schema, value, '', issues);
  return issues;
}
