// public-api as the kernel sees it, and its two pure parts: the origin rule and the document builder.
import { createRoute, z } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import manifest, { buildSpec, isOrigin, settingsSchema, specRoute } from './module.ts';
import packageJson from './package.json' with { type: 'json' };

describe('the manifest', () => {
  it('has the id, no tables, no permissions and its settings', () => {
    expect(manifest.id).toBe('public-api');
    expect(manifest.schema).toBeUndefined();
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.settings).toBe(settingsSchema);
  });

  it('depends on core.settings only, with core.audit and core.ui-shell as optional peers, and on no data module', () => {
    expect(
      Object.keys(packageJson.dependencies).filter((name) => name.startsWith('@scorpion/')),
    ).toEqual(['@scorpion/contracts', '@scorpion/core-settings', '@scorpion/kernel']);
    expect(Object.keys(packageJson.peerDependencies).sort()).toEqual([
      '@scorpion/core-audit',
      '@scorpion/core-ui-shell',
    ]);
    expect(packageJson.peerDependenciesMeta['@scorpion/core-audit'].optional).toBe(true);
    expect(packageJson.peerDependenciesMeta['@scorpion/core-ui-shell'].optional).toBe(true);
  });

  it('registers one route, the spec, as the only public v1 route', () => {
    expect(specRoute.public).toBe(true);
    expect(specRoute.publicReason).toBeTruthy();
    expect(specRoute.method).toBe('get');
    expect(specRoute.path).toBe('/openapi.json');
  });
});

describe('settingsSchema', () => {
  it('defaults to same origin only and the default title', () => {
    expect(settingsSchema.parse({})).toEqual({ corsOrigins: [] });
  });

  it.each([
    ['https://app.example.org', true],
    ['http://localhost:5173', true],
    ['https://app.example.org:8443', true],
    ['*', false],
    ['https://*.example.org', false],
    ['null', false],
    ['https://app.example.org/', false],
    ['https://app.example.org/path', false],
    ['https://App.Example.org', false],
    ['app.example.org', false],
    ['ftp://app.example.org', false],
    ['javascript:alert(1)', false],
    ['https://user@app.example.org', false],
    ['', false],
  ])('isOrigin(%s) is %s', (value, expected) => {
    expect(isOrigin(value)).toBe(expected);
    expect(settingsSchema.safeParse({ corsOrigins: [value] }).success).toBe(expected);
  });

  it('caps the list, and takes no unknown key', () => {
    const many = Array.from({ length: 51 }, (_, i) => `https://a${i}.example.org`);
    expect(settingsSchema.safeParse({ corsOrigins: many }).success).toBe(false);
    expect(settingsSchema.safeParse({ corsOrigins: [], other: 1 }).success).toBe(false);
  });

  it('takes a contact only as a name, an address and an http(s) URL', () => {
    expect(
      settingsSchema.safeParse({
        contactEmail: 'api@example.org',
        contactUrl: 'https://example.org',
      }).success,
    ).toBe(true);
    expect(settingsSchema.safeParse({ contactEmail: 'nope' }).success).toBe(false);
    expect(settingsSchema.safeParse({ contactUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(settingsSchema.safeParse({ contactUrl: 'ftp://example.org' }).success).toBe(false);
    expect(settingsSchema.safeParse({ specTitle: '' }).success).toBe(false);
  });
});

describe('buildSpec()', () => {
  const route = createRoute({
    method: 'get',
    path: '/things',
    permission: 'x.things.v1.read',
    responses: {
      200: {
        description: 'ok',
        content: { 'application/json': { schema: z.object({ a: z.string() }) } },
      },
    },
  });
  const internal = createRoute({
    method: 'get',
    path: '/secret',
    permission: 'x.things.read',
    responses: { 200: { description: 'ok' } },
  });
  const routes = [
    { module: 'x', surface: 'v1' as const, route, handler: (() => undefined) as never },
    {
      module: 'x',
      surface: 'internal' as const,
      route: internal,
      handler: (() => undefined) as never,
    },
  ];
  const defaults = settingsSchema.parse({});

  it('describes the v1 routes only, with the permission each needs', () => {
    const document = buildSpec(routes, defaults);
    expect(Object.keys(document.paths ?? {})).toEqual(['/things']);
    expect(document.paths?.['/things']?.get).toMatchObject({ 'x-permission': 'x.things.v1.read' });
    expect(document.info).toEqual({
      title: 'Public API',
      version: '1',
      description: 'The public API, version 1.',
    });
    expect(document.servers).toBeUndefined();
  });

  it('puts the title, the description, the contact and the server URL from its arguments', () => {
    const document = buildSpec(
      routes,
      settingsSchema.parse({
        specTitle: 'T',
        specDescription: 'D',
        contactName: 'N',
        contactEmail: 'a@example.org',
      }),
      'https://example.org/base/api/v1',
    );
    expect(document.info).toEqual({
      title: 'T',
      version: '1',
      description: 'D',
      contact: { name: 'N', email: 'a@example.org' },
    });
    expect(document.servers).toEqual([{ url: 'https://example.org/base/api/v1' }]);
  });
});
