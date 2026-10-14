import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffOpenApi, markdown, report } from './openapi-diff.ts';

type Obj = Record<string, unknown>;

const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const object = (properties: Obj, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});
const query = (name: string, schema: unknown, required = false) => ({
  name,
  in: 'query',
  required,
  schema,
});

/** A document with one `GET /things`; `change` edits the operation. */
function document(change: (operation: Obj) => void = () => {}, extra: Obj = {}): Obj {
  const operation: Obj = {
    'x-permission': 'm.things.v1.read',
    security: [{ HTTPBearer: [] }, { APIKeyHeader: [] }],
    parameters: [query('page', { type: 'string', pattern: '^\\d{1,9}$' })],
    responses: {
      200: json(
        object({ id: { type: 'string' }, name: { type: 'string' }, kind: { enum: ['a', 'b'] } }, [
          'id',
          'name',
        ]),
      ),
      401: { description: 'no token' },
    },
  };
  change(operation);
  return {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: { '/things': { get: operation } },
    components: {
      securitySchemes: {
        HTTPBearer: { type: 'http', scheme: 'bearer' },
        APIKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
    ...extra,
  };
}

const post = (operation: Obj) => {
  operation.requestBody = {
    required: true,
    ...json(object({ title: { type: 'string', maxLength: 100 } }, ['title'])),
  };
};

const answer = (operation: Obj): Obj =>
  (((operation.responses as Obj)['200'] as Obj).content as Obj)['application/json'] as Obj;
const answerSchema = (operation: Obj): Obj => answer(operation).schema as Obj;
const props = (operation: Obj): Obj => answerSchema(operation).properties as Obj;

describe('diffOpenApi: what breaks a client', () => {
  type Change = (operation: Obj) => void;
  const none: Change = () => {};
  // [what happened, how the base looks, how the head looks, a part of the finding]
  const breaking: [string, Change, Change, string][] = [
    ['a removed response field', none, (o) => delete props(o).name, 'field name removed'],
    [
      'a response field that is no longer always sent',
      none,
      (o) => (answerSchema(o).required = ['id']),
      'field name is no longer always sent',
    ],
    [
      'a response type that now allows null',
      none,
      (o) => (props(o).name = { type: ['string', 'null'] }),
      'type now also allows null',
    ],
    [
      'a response type that changes',
      none,
      (o) => (props(o).id = { type: 'integer' }),
      'type now also allows integer',
    ],
    [
      'a removed enum value',
      none,
      (o) => (props(o).kind = { enum: ['a'] }),
      'enum value "b" removed',
    ],
    [
      'a removed response status',
      none,
      (o) => delete (o.responses as Obj)['401'],
      'response 401 removed',
    ],
    [
      'a removed response media type',
      none,
      (o) => (((o.responses as Obj)['200'] as Obj).content = {}),
      'media type application/json removed',
    ],
    ['a removed query parameter', none, (o) => (o.parameters = []), 'parameter query page removed'],
    [
      'a query parameter that is now required',
      none,
      (o) => (o.parameters = [query('page', { type: 'string', pattern: '^\\d{1,9}$' }, true)]),
      'parameter query page is now required',
    ],
    [
      'a new required query parameter',
      none,
      (o) =>
        (o.parameters = [...(o.parameters as unknown[]), query('q', { type: 'string' }, true)]),
      'parameter query q added (required)',
    ],
    [
      'a query parameter that is no longer a string',
      none,
      (o) => (o.parameters = [query('page', { type: 'integer' })]),
      'type no longer allows string',
    ],
    [
      'a different pattern',
      none,
      (o) => (o.parameters = [query('page', { type: 'string', pattern: '^\\d{1,3}$' })]),
      'pattern',
    ],
    [
      'a new constraint on a parameter',
      none,
      (o) =>
        (o.parameters = [query('page', { type: 'string', pattern: '^\\d{1,9}$', maxLength: 3 })]),
      'maxLength undefined → 3 (stricter)',
    ],
    [
      'an operation that now needs a token',
      (o) => (delete o.security, delete o['x-permission']),
      none,
      'now needs a token',
    ],
    [
      'a security scheme that is no longer accepted',
      none,
      (o) => (o.security = [{ HTTPBearer: [] }]),
      'security scheme APIKeyHeader no longer accepted',
    ],
    [
      'a different scope',
      none,
      (o) => (o['x-permission'] = 'm.things.v2.read'),
      'the scope it needs changed',
    ],
    [
      'a route that stops being public',
      (o) => ((o['x-public'] = true), delete o.security),
      (o) => delete o['x-public'],
      'no longer public',
    ],
  ];

  it.each(breaking)('fails %s', (_name, changeBase, changeHead, expected) => {
    const diff = diffOpenApi(document(changeBase), document(changeHead));
    expect(diff.firstContract).toBe(false);
    expect(diff.breaking.join('\n')).toContain(expected);
  });

  const additive: [string, (operation: Obj) => void, string][] = [
    ['a new response field', (o) => (props(o).extra = { type: 'string' }), 'field extra added'],
    [
      'a new enum value',
      (o) => (props(o).kind = { enum: ['a', 'b', 'c'] }),
      'enum value "c" added',
    ],
    [
      'a new optional query parameter',
      (o) => (o.parameters = [...(o.parameters as unknown[]), query('q', { type: 'string' })]),
      'parameter query q added',
    ],
    [
      'a new response status',
      (o) => ((o.responses as Obj)['422'] = { description: 'bad input' }),
      'response 422 added',
    ],
    [
      'a response field that is now always sent',
      (o) => (
        (props(o).extra = { type: 'string' }),
        (answerSchema(o).required = ['id', 'name', 'extra'])
      ),
      'field extra added',
    ],
    ['a response type that is narrower', (o) => (props(o).name = { type: 'string' }), ''],
  ];

  it.each(additive)('allows %s', (_name, change, expected) => {
    const diff = diffOpenApi(document(), document(change));
    expect(diff.breaking).toEqual([]);
    if (expected) expect(diff.additive.join('\n')).toContain(expected);
  });

  it('allows a looser bound on a parameter and says so', () => {
    const bounded = (maxLength: number) => (o: Obj) =>
      (o.parameters = [query('page', { type: 'string', maxLength })]);
    const diff = diffOpenApi(document(bounded(3)), document(bounded(5)));
    expect(diff.breaking).toEqual([]);
    expect(diff.additive).toEqual(['GET /things parameter query page: maxLength 3 → 5']);
    expect(diffOpenApi(document(bounded(5)), document(bounded(3))).breaking).toEqual([
      'GET /things parameter query page: maxLength 5 → 3 (stricter)',
    ]);
  });

  it('allows a new path, a new method and a new security scheme, and says so', () => {
    const head = document();
    (head.paths as Obj)['/more'] = { get: { responses: { 200: { description: 'ok' } } } };
    (asObj(asObj(head.paths)['/things']) as Obj).post = {
      responses: { 200: { description: 'ok' } },
    };
    (asObj(head.components).securitySchemes as Obj).OAuth = { type: 'oauth2' };
    const diff = diffOpenApi(document(), head);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive).toEqual([
      'POST /things: added',
      'GET /more: added',
      'security scheme OAuth: added',
    ]);
  });

  it('allows the security the document of v0.10.0 added to routes that already needed a token', () => {
    const before = document((o) => delete o.security);
    const diff = diffOpenApi(before, document());
    expect(diff.breaking).toEqual([]);
    expect(diff.additive).toEqual([
      'GET /things: security scheme HTTPBearer accepted',
      'GET /things: security scheme APIKeyHeader accepted',
    ]);
  });

  it('allows nothing to change', () => {
    expect(diffOpenApi(document(), document())).toEqual({
      breaking: [],
      additive: [],
      firstContract: false,
    });
  });
});

describe('diffOpenApi: removals', () => {
  it('fails a removed path', () => {
    const head = document();
    delete (head.paths as Obj)['/things'];
    (head.paths as Obj)['/other'] = {};
    expect(diffOpenApi(document(), head).breaking).toEqual(['GET /things: removed']);
  });

  it('fails a removed method', () => {
    const base = document();
    (asObj(asObj(base.paths)['/things']) as Obj).post = { responses: {} };
    expect(diffOpenApi(base, document()).breaking).toEqual(['POST /things: removed']);
  });

  it('fails a removed security scheme and a changed one', () => {
    const removed = document();
    delete asObj(asObj(removed.components).securitySchemes).APIKeyHeader;
    expect(diffOpenApi(document(), removed).breaking).toContain(
      'security scheme APIKeyHeader: removed',
    );
    const changed = document();
    asObj(asObj(asObj(changed.components).securitySchemes).APIKeyHeader).name = 'X-Key';
    expect(diffOpenApi(document(), changed).breaking).toContain(
      'security scheme APIKeyHeader: name X-API-Key → X-Key',
    );
  });
});

describe('diffOpenApi: a request', () => {
  const withBody = (change: (body: Obj) => void = () => {}) =>
    document((o) => {
      post(o);
      change(o.requestBody as Obj);
    });
  const schemaOf = (body: Obj): Obj => asObj(asObj(asObj(body.content)['application/json']).schema);

  const breaking: [string, (body: Obj) => void, string][] = [
    [
      'a new required field',
      (b) => {
        schemaOf(b).properties = { ...asObj(schemaOf(b).properties), note: { type: 'string' } };
        schemaOf(b).required = ['title', 'note'];
      },
      'field note added (required)',
    ],
    [
      'an optional field that becomes required',
      (b) => {
        schemaOf(b).properties = { ...asObj(schemaOf(b).properties), note: { type: 'string' } };
        schemaOf(b).required = ['title', 'note'];
      },
      '',
    ],
    ['a removed field', (b) => delete asObj(schemaOf(b).properties).title, 'field title removed'],
    [
      'a narrowed type',
      (b) => (asObj(schemaOf(b).properties).title = { type: 'integer' }),
      'type no longer allows string',
    ],
    [
      'a smaller maximum length',
      (b) => (asObj(schemaOf(b).properties).title = { type: 'string', maxLength: 50 }),
      'maxLength 100 → 50 (stricter)',
    ],
  ];
  it.each(breaking)('fails %s', (_name, change, expected) => {
    const base = withBody((b) => {
      // An optional `note` exists in the base for the "becomes required" row.
      if (_name === 'an optional field that becomes required') {
        schemaOf(b).properties = { ...asObj(schemaOf(b).properties), note: { type: 'string' } };
      }
    });
    const diff = diffOpenApi(base, withBody(change));
    expect(diff.breaking.length).toBeGreaterThan(0);
    if (expected) expect(diff.breaking.join('\n')).toContain(expected);
  });

  it('allows a new optional field and a larger maximum length', () => {
    const diff = diffOpenApi(
      withBody(),
      withBody((b) => {
        schemaOf(b).properties = {
          title: { type: 'string', maxLength: 200 },
          note: { type: 'string' },
        };
      }),
    );
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.join('\n')).toContain('field note added');
  });

  it('fails a body that is now required and one that is gone', () => {
    const optional = document(
      (o) => (o.requestBody = { required: false, ...json(object({}, [])) }),
    );
    const required = document((o) => (o.requestBody = { required: true, ...json(object({}, [])) }));
    expect(diffOpenApi(optional, required).breaking).toEqual([
      'GET /things: request body is now required',
    ]);
    expect(diffOpenApi(required, document()).breaking).toEqual([
      'GET /things: request body removed',
    ]);
    expect(diffOpenApi(document(), required).breaking).toEqual([
      'GET /things: request body added (required)',
    ]);
  });
});

const asObj = (value: unknown): Obj => value as Obj;

describe('diffOpenApi: references', () => {
  const withRef = (properties: Obj): Obj =>
    document(
      (o) => {
        ((o.responses as Obj)['200'] as Obj).content = {
          'application/json': { schema: { $ref: '#/components/schemas/Thing' } },
        };
      },
      {
        components: {
          schemas: { Thing: object(properties, ['id']) },
          securitySchemes: asObj(document().components).securitySchemes,
        },
      },
    );

  it('follows a $ref on both sides', () => {
    const diff = diffOpenApi(
      withRef({ id: { type: 'string' }, name: { type: 'string' } }),
      withRef({ id: { type: 'string' } }),
    );
    expect(diff.breaking.join('\n')).toContain('field name removed');
  });

  it('does not loop on a schema that contains itself', () => {
    const tree = (extra: Obj) => ({
      type: 'object',
      properties: { child: { $ref: '#/components/schemas/Thing' }, ...extra },
    });
    const diff = diffOpenApi(
      withRef({ id: { type: 'string' }, child: tree({}) }),
      withRef({ id: { type: 'string' }, child: tree({ more: { type: 'string' } }) }),
    );
    expect(diff.breaking).toEqual([]);
    expect(diff.additive.join('\n')).toContain('field more added');
  });

  it('reads anyOf as the union of its branches', () => {
    const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });
    const diff = diffOpenApi(
      withRef({ id: { type: 'string' }, note: nullable('string') }),
      withRef({ id: { type: 'string' }, note: { type: 'string' } }),
    );
    // A response that can no longer be null is safe for a reader.
    expect(diff.breaking).toEqual([]);
    const wider = diffOpenApi(
      withRef({ id: { type: 'string' }, note: { type: 'string' } }),
      withRef({ id: { type: 'string' }, note: nullable('string') }),
    );
    expect(wider.breaking.join('\n')).toContain('type now also allows null');
  });
});

describe('a document with no paths', () => {
  const empty = { openapi: '3.1.0', info: { title: 't', version: '1' }, paths: {} };

  it('is the first contract: it passes, and says so', () => {
    const diff = diffOpenApi(empty, document());
    expect(diff.firstContract).toBe(true);
    expect(diff.breaking).toEqual([]);
    expect(diff.additive).toContain('GET /things: added');
    const { text, passed } = report(diff, 'v0.9.0');
    expect(passed).toBe(true);
    expect(text).toContain('v0.9.0 has no v1 path: this document is the first contract');
  });

  it('is also what a tag without the document gives', () => {
    expect(diffOpenApi({}, document()).firstContract).toBe(true);
  });

  it('still leaves nothing to compare when both are empty', () => {
    expect(report(diffOpenApi(empty, empty), 'v0.9.0')).toMatchObject({ passed: true });
  });
});

describe('the report', () => {
  it('lists what breaks, and fails', () => {
    const head = document();
    delete asObj(head.paths)['/things'];
    asObj(head.paths)['/other'] = {};
    const { text, passed } = report(diffOpenApi(document(), head), 'v0.10.0');
    expect(passed).toBe(false);
    expect(text).toContain('Compared with v0.10.0.');
    expect(text).toContain('Breaking changes (1)');
    expect(text).toContain('  - GET /things: removed');
    expect(markdown(diffOpenApi(document(), head), 'v0.10.0')).toContain('BREAKING');
  });

  it('prints what is additive, and passes', () => {
    const { text, passed } = report(
      diffOpenApi(
        document(),
        document((o) => (props(o).extra = { type: 'string' })),
      ),
      'v0.10.0',
    );
    expect(passed).toBe(true);
    expect(text).toContain('Additive changes (1)');
  });
});

describe('the committed document', () => {
  const file = resolve(import.meta.dirname, '../apps/web/src/generated/openapi-v1.json');
  const committed = JSON.parse(readFileSync(file, 'utf8')) as Obj;

  it('is compatible with itself', () => {
    expect(diffOpenApi(committed, committed)).toEqual({
      breaking: [],
      additive: [],
      firstContract: false,
    });
  });

  it('breaks when a route of it is taken away', () => {
    const head = structuredClone(committed);
    delete asObj(head.paths)['/providers'];
    expect(diffOpenApi(committed, head).breaking).toEqual(['GET /providers: removed']);
  });
});
