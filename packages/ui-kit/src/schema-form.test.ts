import { z } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import {
  describeField,
  describeRoot,
  emptyValue,
  errorsByPointer,
  groupChildren,
  hasErrorsUnder,
  humanize,
  messagesFor,
  pointerOf,
  prune,
  resolve,
  labelOfPointer,
  variantIndex,
  variantSeed,
  variantLabel,
  type JsonSchema,
} from './schema-form.ts';

const json = (schema: z.ZodType): JsonSchema =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

describe('humanize', () => {
  it.each([
    ['inactivityDays', 'Inactivity days'],
    ['perMinute', 'Per minute'],
    ['smtp', 'Smtp'],
    ['mail_from', 'Mail from'],
    ['oidc-providers', 'Oidc providers'],
    ['a', 'A'],
    ['', ''],
  ])('writes %s as %s', (key, expected) => {
    expect(humanize(key)).toBe(expected);
  });
});

describe('pointerOf', () => {
  it.each([
    ['sessions.absoluteDays', undefined, '/sessions/absoluteDays'],
    ['values.sessions.absoluteDays', 'values', '/sessions/absoluteDays'],
    ['values.oidcProviders.0.id', 'values', '/oidcProviders/0/id'],
    ['values', 'values', ''],
    ['/sessions/absoluteDays', 'values', '/sessions/absoluteDays'],
    ['password', undefined, '/password'],
    ['', undefined, ''],
    ['a/b', undefined, '/a~1b'],
  ])('maps %s (prefix %s) to %s', (path, prefix, expected) => {
    expect(pointerOf(path, prefix)).toBe(expected);
  });
});

describe('errorsByPointer', () => {
  it('groups the messages by field and joins two on one field', () => {
    const errors = errorsByPointer(
      { 'values.a.b': ['one'], 'a.b': ['two'], 'values.c.0': ['three'], values: ['whole'] },
      'values',
    );
    expect(Object.fromEntries(errors)).toEqual({
      '/a/b': ['one', 'two'],
      '/c/0': ['three'],
      '': ['whole'],
    });
  });

  it('finds the messages of a field, of what is below it, and says whether a section has any', () => {
    const errors = errorsByPointer({ 'a.list.1': ['bad item'], 'a.name': ['empty'] });
    expect(messagesFor(errors, '/a/name')).toEqual(['empty']);
    expect(messagesFor(errors, '/a/list')).toEqual([]);
    expect(messagesFor(errors, '/a/list', true)).toEqual(['bad item']);
    expect(hasErrorsUnder(errors, '/a')).toBe(true);
    expect(hasErrorsUnder(errors, '/b')).toBe(false);
    // `/a/li` is not a parent of `/a/list`.
    expect(hasErrorsUnder(errors, '/a/li')).toBe(false);
  });
});

describe('describeRoot', () => {
  const schema = json(
    z.strictObject({
      localAccounts: z.boolean().default(true).meta({ title: 'Local accounts', group: 'Access' }),
      name: z.string().min(1).max(40).meta({ description: 'The name', order: 2 }),
      note: z.string().max(2000).optional(),
      port: z.number().int().min(1).max(65535).default(25),
      ratio: z.number().min(0).max(1).optional(),
      mode: z.enum(['a', 'b']).default('a'),
      secret: z.string().meta({ writeOnly: true }).optional(),
      logo: z.string().optional().meta({ widget: 'logo', 'x-group': 'Look' }),
      tags: z.array(z.string()).max(5).default([]),
      limits: z
        .strictObject({ burst: z.int().min(1), perMinute: z.number() })
        .default({ burst: 1, perMinute: 1 }),
      providers: z
        .array(z.strictObject({ id: z.string(), scopes: z.array(z.string()).default([]) }))
        .default([]),
      free: z.record(z.string(), z.unknown()).optional(),
    }),
  );
  const root = describeRoot(schema);
  const field = (key: string) => root.children.find((child) => child.key === key)!;

  it('draws an object with a field for every property, in declaration order unless `order` says otherwise', () => {
    expect(root.kind).toBe('object');
    expect(root.children.map((child) => child.key)).toEqual([
      'localAccounts',
      'note',
      'port',
      'ratio',
      'mode',
      'secret',
      'logo',
      'tags',
      'limits',
      'providers',
      'free',
      'name', // order: 2
    ]);
  });

  it('reads the kind of every property', () => {
    expect(Object.fromEntries(root.children.map((child) => [child.key, child.kind]))).toEqual({
      localAccounts: 'boolean',
      name: 'string',
      note: 'text',
      port: 'integer',
      ratio: 'number',
      mode: 'enum',
      secret: 'password',
      logo: 'string',
      tags: 'scalarArray',
      limits: 'object',
      providers: 'objectArray',
      free: 'opaque',
    });
  });

  it('takes label, description, group, order and widget from the meta keys, with the x- names too', () => {
    expect(field('localAccounts')).toMatchObject({ label: 'Local accounts', group: 'Access' });
    expect(field('name')).toMatchObject({ description: 'The name', order: 2, label: 'Name' });
    expect(field('logo')).toMatchObject({ widget: 'logo', group: 'Look' });
    expect(field('port').label).toBe('Port');
  });

  it('reads the limits of a field and whether it is required', () => {
    expect(field('name')).toMatchObject({ minLength: 1, maxLength: 40, required: true });
    expect(field('port')).toMatchObject({
      minimum: 1,
      maximum: 65535,
      required: false,
      defaultValue: 25,
    });
    expect(field('tags')).toMatchObject({ maxItems: 5 });
    expect(field('mode').options).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ]);
    expect(field('secret').writeOnly).toBe(true);
  });

  it('gives every field a JSON pointer, also inside objects and for the item of an array', () => {
    expect(field('limits').children.map((child) => child.pointer)).toEqual([
      '/limits/burst',
      '/limits/perMinute',
    ]);
    const item = describeField(field('providers').items!, schema, {
      pointer: '/providers/0',
      key: '0',
      required: true,
    });
    expect(item.children.map((child) => [child.pointer, child.kind])).toEqual([
      ['/providers/0/id', 'string'],
      ['/providers/0/scopes', 'scalarArray'],
    ]);
  });
});

describe('describeField', () => {
  it('follows a $ref and merges allOf', () => {
    const root: JsonSchema = {
      $defs: { name: { type: 'string', maxLength: 10, title: 'Name' } },
      type: 'object',
      properties: { a: { $ref: '#/$defs/name' } },
    };
    const node = describeRoot(root);
    expect(node.children[0]).toMatchObject({ kind: 'string', label: 'Name', maxLength: 10 });
    expect(
      resolve(
        { allOf: [{ type: 'object', properties: { x: { type: 'string' } } }, { required: ['x'] }] },
        {},
      ),
    ).toMatchObject({ type: 'object', required: ['x'], properties: { x: { type: 'string' } } });
  });

  it('treats anyOf with null as a nullable field', () => {
    const node = describeField(json(z.string().nullable()), {}, { pointer: '/x', key: 'x' });
    expect(node).toMatchObject({ kind: 'string', nullable: true });
    const number = describeField(
      json(z.number().int().nullable()),
      {},
      { pointer: '/x', key: 'x' },
    );
    expect(number).toMatchObject({ kind: 'integer', nullable: true });
  });

  it('draws a union of objects as a choice, and an array of them as an array of objects', () => {
    const schema = json(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('smtp'), host: z.string() }),
        z.object({ type: z.literal('none') }),
      ]),
    );
    const node = describeField(schema, schema, { pointer: '/t', key: 't' });
    expect(node.kind).toBe('oneOf');
    expect(node.variants).toHaveLength(2);
    const list = describeField(
      json(z.array(z.union([z.string(), z.number()]))),
      {},
      { pointer: '/l', key: 'l' },
    );
    expect(list.kind).toBe('opaque');
  });

  it('leaves a shape it cannot draw as opaque', () => {
    for (const schema of [
      {},
      { type: 'object' },
      { const: 1 },
      { type: 'array' },
      { type: 'null' },
    ]) {
      expect(describeField(schema, schema, { pointer: '/x', key: 'x' }).kind).toBe('opaque');
    }
  });

  it('makes a long string a text area', () => {
    expect(
      describeField({ type: 'string', maxLength: 100_000 }, {}, { pointer: '/t', key: 't' }).kind,
    ).toBe('text');
    expect(
      describeField({ type: 'string', maxLength: 100 }, {}, { pointer: '/t', key: 't' }).kind,
    ).toBe('string');
  });
});

describe('groupChildren', () => {
  it('puts the loose fields first and the groups in the order they are first used', () => {
    const schema = json(
      z.strictObject({
        a: z.string().meta({ group: 'Two' }),
        b: z.string(),
        c: z.string().meta({ group: 'One' }),
        d: z.string().meta({ group: 'Two' }),
      }),
    );
    const groups = groupChildren(describeRoot(schema).children);
    expect(groups.map((group) => [group.name, group.fields.map((field) => field.key)])).toEqual([
      [undefined, ['b']],
      ['Two', ['a', 'd']],
      ['One', ['c']],
    ]);
  });
});

describe('emptyValue', () => {
  const schema = json(
    z.strictObject({
      on: z.boolean().default(true),
      name: z.string(),
      tags: z.array(z.string()).default([]),
      nested: z
        .strictObject({ n: z.number().default(3), required: z.string() })
        .default({ n: 3, required: 'x' }),
      free: z.string().optional(),
    }),
  );
  const root = describeRoot(schema);

  it('uses the default, else the empty value of the kind', () => {
    expect(emptyValue(root)).toEqual({
      on: true,
      name: '',
      tags: [],
      nested: { n: 3, required: 'x' },
    });
  });

  it('copies a default, so editing the form never edits the schema', () => {
    const value = emptyValue(root) as { tags: string[] };
    value.tags.push('x');
    expect((emptyValue(root) as { tags: string[] }).tags).toEqual([]);
  });
});

describe('prune', () => {
  const schema = json(
    z.strictObject({
      name: z.string().optional(),
      email: z.string().nullable().optional(),
      port: z.number().optional(),
      secret: z.string().meta({ writeOnly: true }).optional(),
      tags: z.array(z.string()).default([]),
      list: z.array(z.strictObject({ id: z.string(), note: z.string().optional() })).default([]),
      nested: z.strictObject({ a: z.string().optional() }).default({}),
    }),
  );
  const root = describeRoot(schema);

  it.each([
    [{ name: '' }, {}],
    [{ name: 'x' }, { name: 'x' }],
    [{ port: Number.NaN }, {}],
    [{ port: 0 }, { port: 0 }],
    [{ secret: '' }, {}],
    [{ secret: 'new' }, { secret: 'new' }],
    [{ tags: ['a', '', 'b'] }, { tags: ['a', 'b'] }],
    [{ nested: { a: '' } }, { nested: {} }],
    [{ list: [{ id: 'a', note: '' }] }, { list: [{ id: 'a' }] }],
    [{ email: '' }, { email: null }],
    // A key the schema does not name is kept: the form must not drop what it cannot draw.
    [{ other: 1 }, { other: 1 }],
  ])('sends %j as %j', (input, expected) => {
    expect(prune(input, root)).toEqual(expected);
  });
});

describe('variantIndex and variantLabel', () => {
  const variants: JsonSchema[] = [
    { type: 'object', properties: { type: { const: 'smtp' }, host: { type: 'string' } } },
    { type: 'object', properties: { type: { const: 'none' } } },
    { title: 'Custom', type: 'object', properties: { kind: { enum: ['x', 'y'] } } },
  ];

  it.each([
    [{ type: 'smtp', host: 'h' }, 0],
    [{ type: 'none' }, 1],
    [{ kind: 'y' }, 2],
    [{ type: 'other' }, -1],
    ['text', -1],
    [null, -1],
  ])('matches %j to variant %i', (value, expected) => {
    expect(variantIndex(variants, value)).toBe(expected);
  });

  it('names a variant by its title, its pinned value, or its number', () => {
    const option = (n: number) => `Option ${n}`;
    expect(variantLabel(variants[0]!, 0, option)).toBe('smtp');
    expect(variantLabel(variants[2]!, 2, option)).toBe('Custom');
    expect(variantLabel({ type: 'object' }, 4, option)).toBe('Option 5');
  });
});

describe('variantSeed', () => {
  it('pins const and one-value enum properties', () => {
    expect(
      variantSeed({
        type: 'object',
        properties: {
          type: { const: 'smtp' },
          kind: { enum: ['x'] },
          host: { type: 'string' },
          many: { enum: ['a', 'b'] },
        },
      }),
    ).toEqual({ type: 'smtp', kind: 'x' });
  });

  it('marks a const field as fixed, so the form never draws it', () => {
    const node = describeField({ const: 'smtp' }, {}, { pointer: '/type', key: 'type' });
    expect(node.fixed).toBe(true);
    expect(describeField({ type: 'string' }, {}, { pointer: '/x', key: 'x' }).fixed).toBe(false);
  });
});

describe('labelOfPointer', () => {
  const schema = json(
    z.strictObject({
      sessions: z.strictObject({ inactivityDays: z.number() }).meta({ title: 'Sessions' }),
      providers: z
        .array(z.strictObject({ clientId: z.string().meta({ title: 'Client ID' }) }))
        .meta({ title: 'Providers' }),
    }),
  );
  const root = describeRoot(schema);
  const item = (n: number) => `Item ${n}`;

  it.each([
    ['/sessions/inactivityDays', 'Sessions › Inactivity days'],
    ['/providers/1/clientId', 'Providers › Item 2 › Client ID'],
    ['/providers', 'Providers'],
    ['/unknown/part', 'Unknown › Part'],
    ['', ''],
  ])('names %s as %s', (pointer, expected) => {
    expect(labelOfPointer(root, pointer, item)).toBe(pointer === '' ? root.label : expected);
  });
});
