import { describe, expect, it } from 'vitest';
import { generateV1Document, V1_SECURITY_SCHEMES } from './openapi.ts';
import { createRoute, z } from './route.ts';

const ok = {
  200: {
    description: 'ok',
    content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
  },
};

const guarded = (path: string, permission: string, description?: string) =>
  createRoute({
    method: 'get',
    path,
    permission,
    ...(description ? { description } : {}),
    responses: ok,
  });
const open = createRoute({
  method: 'get',
  path: '/openapi.json',
  public: true,
  publicReason: 'the description of the API holds no record',
  responses: ok,
});

type Operation = { description?: string; security?: unknown; 'x-permission'?: string };
const operation = (document: ReturnType<typeof generateV1Document>, path: string): Operation =>
  (document.paths?.[path] as Record<string, Operation>).get!;

describe('generateV1Document', () => {
  it('declares both ways to send a token', () => {
    const { components } = generateV1Document([guarded('/a', 'mod.a.v1.read')]);
    expect(components?.securitySchemes).toEqual(V1_SECURITY_SCHEMES);
    expect(V1_SECURITY_SCHEMES.HTTPBearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(V1_SECURITY_SCHEMES.APIKeyHeader).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
  });

  const cases: [string, string | undefined, string][] = [
    ['a route without a description', undefined, 'Needs the scope `mod.a.v1.read`.'],
    [
      'a route with a description',
      'Lists the things.',
      'Lists the things.\n\nNeeds the scope `mod.a.v1.read`.',
    ],
  ];
  it.each(cases)('says which scope %s needs', (_name, description, expected) => {
    const document = generateV1Document([guarded('/a', 'mod.a.v1.read', description)]);
    expect(operation(document, '/a').description).toBe(expected);
    expect(operation(document, '/a')['x-permission']).toBe('mod.a.v1.read');
  });

  it('accepts either scheme on a route that needs a scope', () => {
    const document = generateV1Document([guarded('/a', 'mod.a.v1.read')]);
    expect(operation(document, '/a').security).toEqual([{ HTTPBearer: [] }, { APIKeyHeader: [] }]);
  });

  it('puts no security on the public route and leaves its description alone', () => {
    const document = generateV1Document([guarded('/a', 'mod.a.v1.read'), open]);
    const spec = operation(document, '/openapi.json');
    expect(spec).not.toHaveProperty('security');
    expect(spec.description ?? '').not.toContain('Needs the scope');
  });

  it('declares the schemes for a document with no route as well', () => {
    const document = generateV1Document([]);
    expect(document.components?.securitySchemes).toEqual(V1_SECURITY_SCHEMES);
    expect(document.paths ?? {}).toEqual({});
  });
});
