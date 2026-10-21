import { describe, expect, it } from 'vitest';
import { checkJsonSchema, type JsonSchema } from './json-schema-check.ts';

const object: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 5, pattern: '^[a-z]+$' },
    links: { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string' } },
    stage: { type: 'string', enum: ['DEV', 'PROD'], widget: 'select', default: 'DEV' },
    contact: {
      type: 'object',
      additionalProperties: false,
      properties: { email: { type: 'string' }, type: { type: 'string' } },
      dependentRequired: { email: ['type'], type: ['email'] },
    },
  },
};

const verdict = (schema: JsonSchema, value: unknown) =>
  checkJsonSchema(schema, value).map((issue) => `${issue.pointer || '/'} ${issue.keyword}`);

describe('checkJsonSchema', () => {
  it.each<[string, unknown, string[]]>([
    ['a good value', { name: 'abc' }, []],
    ['annotations change nothing', { name: 'abc', stage: 'PROD' }, []],
    ['a missing required property', {}, ['/name required']],
    ['an undefined value is missing', { name: undefined }, ['/name required']],
    ['null is not a string', { name: null }, ['/name type']],
    ['too short', { name: '' }, ['/name minLength', '/name pattern']],
    ['too long', { name: 'abcdef' }, ['/name maxLength']],
    ['against the pattern', { name: 'ABC' }, ['/name pattern']],
    ['an unknown property', { name: 'abc', extra: 1 }, ['/extra additionalProperties']],
    ['a value outside the enum', { name: 'abc', stage: 'XX' }, ['/stage enum']],
    ['too many items', { name: 'abc', links: ['a', 'b', 'c'] }, ['/links maxItems']],
    ['duplicate items', { name: 'abc', links: ['a', 'a'] }, ['/links uniqueItems']],
    ['an item of the wrong type', { name: 'abc', links: [1] }, ['/links/0 type']],
    [
      'one part of a pair',
      { name: 'abc', contact: { email: 'a' } },
      ['/contact/type dependentRequired'],
    ],
    [
      'the other part of a pair',
      { name: 'abc', contact: { type: 'a' } },
      ['/contact/email dependentRequired'],
    ],
    ['both parts of a pair', { name: 'abc', contact: { email: 'a', type: 'b' } }, []],
    ['an object where a string is expected', { name: {} }, ['/name type']],
  ])('%s', (_label, value, expected) => {
    expect(verdict(object, value)).toEqual(expected);
  });

  it('counts a number as an integer or a number, and checks its bounds', () => {
    const schema = { type: 'integer', minimum: 1, maximum: 3 };
    expect(verdict(schema, 2)).toEqual([]);
    expect(verdict(schema, 2.5)).toEqual(['/ type']);
    expect(verdict(schema, 0)).toEqual(['/ minimum']);
    expect(verdict(schema, 4)).toEqual(['/ maximum']);
    expect(verdict({ type: 'number' }, 1)).toEqual([]);
  });

  it('carries the limit of a rule and the name of what is missing', () => {
    expect(checkJsonSchema({ type: 'string', maxLength: 3 }, 'abcd')).toEqual([
      { pointer: '', keyword: 'maxLength', limit: 3 },
    ]);
  });

  it('escapes a key that holds a slash or a tilde in the pointer', () => {
    expect(
      verdict({ type: 'object', additionalProperties: false, properties: {} }, { 'a/b~c': 1 }),
    ).toEqual(['/a~1b~0c additionalProperties']);
  });

  it('reports a keyword it cannot check instead of skipping it', () => {
    expect(verdict({ oneOf: [{ type: 'string' }] }, 'x')).toEqual(['/ unsupported']);
    expect(verdict({ type: 'string', pattern: '(' }, 'x')).toEqual(['/ unsupported']);
    expect(checkJsonSchema({ $ref: '#/x' }, 1)[0]).toMatchObject({ detail: '$ref' });
  });

  it('accepts a value that one branch of anyOf accepts (a nullable string), and says anyOf when none does', () => {
    const nullable = { anyOf: [{ type: 'string', maxLength: 3 }, { type: 'null' }] };
    expect(verdict(nullable, 'abc')).toEqual([]);
    expect(verdict(nullable, null)).toEqual([]);
    expect(verdict(nullable, 'abcd')).toEqual(['/ anyOf']);
    expect(verdict(nullable, 4)).toEqual(['/ anyOf']);
    expect(
      verdict({ type: 'object', properties: { service: nullable } }, { service: 'toolong' }),
    ).toEqual(['/service anyOf']);
  });

  it('reads a pattern as a Unicode regular expression, unanchored unless it says so', () => {
    expect(verdict({ type: 'string', pattern: 'b' }, 'abc')).toEqual([]);
    expect(verdict({ type: 'string', pattern: '^b$' }, 'abc')).toEqual(['/ pattern']);
  });
});
