// The organisation routes through the whole pipeline (session, CSRF, permission, validation, error
// mapping) over real Postgres. The denied cases of every route are in
// defect-01.privilege-escalation.test.ts. Each answer is also parsed with the response schema of its
// route, so the generated OpenAPI document and the real answer cannot differ.
import { createApiClient, unwrap, type ApiClient } from '@scorpion/contracts/client';
import { generateOpenApiDocument, type AppRoute } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import { JPEG_EXIF_MARK, makeJpegWithExif, makeOrganisation, makePng } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { SURFACE_PREFIX } from './app.ts';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const start = (options: Parameters<typeof app.start>[0] = {}) => app.start(options);
type Started = Awaited<ReturnType<typeof start>>;
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const admin = (s: Started) => s.signedIn('adminy', { roles: ['admin'] });
interface Page<T> {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: T[];
}
interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
}

/** Parses a reply with the response schema its route declares for the status (the OpenAPI contract). */
function conforms(s: Started, reply: Reply, method: string, path: string) {
  const found = s.kernel.routes.find(
    ({ route }) => route.method.toUpperCase() === method && route.path === path,
  );
  expect(found, `${method} ${path} is registered`).toBeDefined();
  const schema = (
    found!.route.responses as Record<
      number,
      { content?: Record<string, { schema?: { safeParse(v: unknown): { success: boolean } } }> }
    >
  )[reply.status]?.content?.['application/json']?.schema;
  expect(schema, `${method} ${path} declares a ${reply.status} answer`).toBeDefined();
  expect(schema!.safeParse(reply.body).success, JSON.stringify(reply.body)).toBe(true);
}

describe('GET /organisations', () => {
  it('answers a plain user with the legacy envelope, 0-based, sorted by abbreviation then id', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    await makeOrganisation(s.kernel.pool, { abbreviation: 'B' });
    await makeOrganisation(s.kernel.pool, { abbreviation: 'A' });
    await makeOrganisation(s.kernel.pool, { abbreviation: 'C' });
    const reply = await s.get('/organisations?page=1&pageSize=2', as(user));
    expect(reply.status).toBe(200);
    const body = reply.body as Page<{ abbreviation: string }>;
    expect(body.metadata).toEqual({ currentPage: 1, pageSize: 2, totalCount: 3, totalPages: 2 });
    expect(body.result.map((o) => o.abbreviation)).toEqual(['C']);
    conforms(s, reply, 'GET', '/organisations');
  });

  it('filters by q and type, and answers 422 for a bad page or an unknown query field', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    await makeOrganisation(s.kernel.pool, { abbreviation: 'IPK', type: 'provider' });
    await makeOrganisation(s.kernel.pool, { abbreviation: 'NFDI', type: 'consortium' });
    const byType = await s.get('/organisations?type=consortium', as(user));
    expect(
      (byType.body as Page<{ abbreviation: string }>).result.map((o) => o.abbreviation),
    ).toEqual(['NFDI']);
    const byQ = await s.get('/organisations?q=ip', as(user));
    expect((byQ.body as Page<{ abbreviation: string }>).result.map((o) => o.abbreviation)).toEqual([
      'IPK',
    ]);
    for (const bad of [
      '?page=-1',
      '?pageSize=0',
      '?pageSize=101',
      '?colour=red',
      '?q=' + 'x'.repeat(101),
    ]) {
      const reply = await s.get(`/organisations${bad}`, as(user));
      expect(reply.status, bad).toBe(422);
    }
  });

  it('does not put the contact point, the links or the audit columns in a row', async () => {
    const s = await start();
    const root = await admin(s);
    await makeOrganisation(s.kernel.pool, {
      contactEmail: 'info@example.org',
      contactType: 'support',
      sameAs: ['https://a.org'],
    });
    const reply = await s.get('/organisations', as(root));
    expect(JSON.stringify(reply.body)).not.toMatch(
      /info@example\.org|contactEmail|sameAs|createdBy/,
    );
  });

  it('answers 401 to an anonymous caller', async () => {
    const s = await start();
    expect((await s.get('/organisations')).status).toBe(401);
  });
});

/** Saves `organisation.exposeContactPoint` through the generic settings route, as an administrator would. */
async function setExposeContactPoint(
  s: Started,
  root: { cookie: string; csrf: string },
  value: boolean,
) {
  const current = (await s.get('/settings/registry.organisations', as(root))).body as {
    version: number;
  };
  const saved = await s.call('PUT', '/settings/registry.organisations', {
    ...as(root),
    body: { version: current.version, values: { exposeContactPoint: value } },
  });
  expect(saved.status).toBe(200);
}

describe('GET /organisations/{id}', () => {
  it('shows a plain user the record with the contact point while the setting is on, and without it when it is off; an administrator always sees all of it', async () => {
    const s = await start();
    const root = await admin(s);
    const user = await s.signedIn('plain');
    const row = await makeOrganisation(s.kernel.pool, {
      description: 'd',
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
      contactEmail: 'info@example.org',
      contactType: 'support',
    });
    const asUser = await s.get(`/organisations/${row.id}`, as(user));
    expect(asUser.status).toBe(200);
    expect(asUser.body).toMatchObject({
      id: row.id,
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
      contactEmail: 'info@example.org',
    });
    expect(JSON.stringify(asUser.body)).not.toMatch(/createdBy|logoUrl/);
    conforms(s, asUser, 'GET', '/organisations/{id}');
    await setExposeContactPoint(s, root, false);
    const hidden = await s.get(`/organisations/${row.id}`, as(user));
    expect(JSON.stringify(hidden.body)).not.toMatch(/info@example\.org|contactEmail|createdBy/);
    conforms(s, hidden, 'GET', '/organisations/{id}');
    const asAdmin = await s.get(`/organisations/${row.id}`, as(root));
    expect(asAdmin.body).toMatchObject({
      contactEmail: 'info@example.org',
      contactType: 'support',
    });
    conforms(s, asAdmin, 'GET', '/organisations/{id}');
  });

  it('answers 404 for an unknown id and 422 for an id that is no UUID, as problem+json', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const missing = await s.get('/organisations/018f3b7e-0000-7000-8000-000000000000', as(user));
    expect(missing.status).toBe(404);
    expect(missing.res.headers.get('content-type')).toMatch(/application\/problem\+json/);
    expect((await s.get('/organisations/nope', as(user))).status).toBe(422);
  });
});

describe('POST, PATCH and DELETE /organisations', () => {
  it('creates (201), changes and deletes an organisation by id', async () => {
    const s = await start();
    const root = await admin(s);
    const created = await s.post('/organisations', {
      ...as(root),
      body: {
        type: 'provider',
        abbreviation: 'IPK',
        name: 'Leibniz Institute',
        rorId: 'https://ror.org/02skbsp27',
        sameAs: ['https://a.org/'],
        contactEmail: 'info@example.org',
        contactType: 'support',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
      memberCount: 0,
    });
    conforms(s, created, 'POST', '/organisations');
    const id = (created.body as { id: string }).id;

    const patched = await s.call('PATCH', `/organisations/${id}`, {
      ...as(root),
      body: { description: 'text', website: null },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ description: 'text', website: null });
    conforms(s, patched, 'PATCH', '/organisations/{id}');

    const deleted = await s.call('DELETE', `/organisations/${id}`, as(root));
    expect(deleted.status).toBe(204);
    expect((await s.get(`/organisations/${id}`, as(root))).status).toBe(404);
    expect((await s.call('DELETE', `/organisations/${id}`, as(root))).status).toBe(404);
  });

  it('answers 409 for a duplicate and 422 for bad input, naming the field, never 500', async () => {
    const s = await start();
    const root = await admin(s);
    const base = { type: 'provider', abbreviation: 'IPK', name: 'Leibniz' };
    expect((await s.post('/organisations', { ...as(root), body: base })).status).toBe(201);
    const duplicate = await s.post('/organisations', {
      ...as(root),
      body: { ...base, name: 'Other' },
    });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as Problem).errors?.[0]?.path).toBe('abbreviation');

    const bad: [string, Record<string, unknown>, string][] = [
      ['an unknown type', { ...base, abbreviation: 'X1', name: 'X1', type: 'nope' }, 'type'],
      [
        'a javascript: website',
        { ...base, abbreviation: 'X2', name: 'X2', website: 'javascript:alert(1)' },
        'website',
      ],
      [
        'a ROR id with a forbidden letter',
        { ...base, abbreviation: 'X3', name: 'X3', rorId: '02skbsu27' },
        'rorId',
      ],
      [
        'an address without a type',
        { ...base, abbreviation: 'X4', name: 'X4', contactEmail: 'a@b.org' },
        'contactEmail',
      ],
      ['an unknown field', { ...base, abbreviation: 'X5', name: 'X5', colour: 'red' }, ''],
      ['a missing name', { type: 'provider', abbreviation: 'X6' }, 'name'],
    ];
    for (const [label, body, path] of bad) {
      const reply = await s.post('/organisations', { ...as(root), body });
      expect(reply.status, label).toBe(422);
      expect(reply.res.headers.get('content-type')).toMatch(/problem\+json/);
      if (path)
        expect(
          (reply.body as Problem).errors?.map((e) => e.path),
          label,
        ).toContain(path);
    }
    const tooBig = await s.post('/organisations', {
      ...as(root),
      body: { ...base, abbreviation: 'X7', name: 'X7', description: 'x'.repeat(100_000) },
    });
    expect(tooBig.status).toBe(422);
  });

  it('answers 403 to a plain user, changes nothing, and 401 to an anonymous caller', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const row = await makeOrganisation(s.kernel.pool, { description: 'keep' });
    expect(
      (
        await s.post('/organisations', {
          ...as(user),
          body: { type: 'provider', abbreviation: 'X', name: 'X' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.call('PATCH', `/organisations/${row.id}`, {
          ...as(user),
          body: { name: 'defaced' },
        })
      ).status,
    ).toBe(403);
    expect((await s.call('DELETE', `/organisations/${row.id}`, as(user))).status).toBe(403);
    expect(
      (await s.post('/organisations', { body: { type: 'provider', abbreviation: 'X', name: 'X' } }))
        .status,
    ).toBe(401);
    const { rows } = await s.kernel.pool.query<{ description: string; name: string }>(
      'select description, name from org_organisation where id = $1',
      [row.id],
    );
    expect(rows).toEqual([{ description: 'keep', name: row.name }]);
  });

  it('writes an audit entry for each write, with the route template and no body', async () => {
    const s = await start();
    const root = await admin(s);
    const created = await s.post('/organisations', {
      ...as(root),
      body: { type: 'provider', abbreviation: 'IPK', name: 'Leibniz' },
    });
    const id = (created.body as { id: string }).id;
    await s.call('PATCH', `/organisations/${id}`, {
      ...as(root),
      body: { description: 'secret text' },
    });
    await s.call('DELETE', `/organisations/${id}`, as(root));
    await s.kernel.dispatcher.dispatchOnce();
    const { rows } = await s.kernel.pool.query<{
      action: string;
      path: string | null;
      body: unknown;
      source: string;
    }>(
      "select action, path, body, source from audit_event where path like '/api/internal/organisations%' or action like 'registry.organisation.%' order by occurred_at, id",
    );
    const api = rows.filter((r) => r.source === 'api').map((r) => `${r.action} ${r.path}`);
    expect(api).toEqual([
      'api.POST /api/internal/organisations',
      'api.PATCH /api/internal/organisations/{id}',
      'api.DELETE /api/internal/organisations/{id}',
    ]);
    expect(rows.filter((r) => r.source === 'api').every((r) => r.body === null)).toBe(true);
    expect(
      rows
        .filter((r) => r.source === 'event')
        .map((r) => r.action)
        .sort(),
    ).toEqual([
      'registry.organisation.created@1',
      'registry.organisation.deleted@1',
      'registry.organisation.updated@1',
    ]);
  });
});

describe('GET /organisation-types', () => {
  it('lists the seeded types, in the list envelope, with the label of the locale', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const reply = await s.get('/organisation-types?locale=de', as(user));
    expect(reply.status).toBe(200);
    const body = reply.body as Page<{ id: string; label: string; membership: boolean }>;
    expect(body.result.map((t) => [t.id, t.label, t.membership])).toEqual([
      ['provider', 'Anbieter', true],
      ['consortium', 'Konsortium', true],
    ]);
    expect(body.metadata.currentPage).toBe(0);
    conforms(s, reply, 'GET', '/organisation-types');
  });
});

describe('a module that contributes to the registries, through the whole app', () => {
  it('adds a type, and a delete is refused with 409 organisation-in-use that names the module only', async () => {
    const referenced = new Set<string>();
    const fixture = defineModule({
      id: 'fixture.funders',
      version: '0.1.0',
      contributes: {
        'org.type': [
          {
            id: 'funder',
            labels: { en: 'Funder' },
            membership: false,
            schemaType: 'FundingAgency',
            order: 30,
          },
        ],
        'org.usage': [
          {
            id: 'fixture.funders',
            count: (_tx: unknown, id: string) => Promise.resolve(referenced.has(id) ? 1 : 0),
          },
        ],
      },
    });
    const s = await start({
      extraModules: [
        {
          id: 'fixture.funders',
          manifest: fixture,
          requires: ['@scorpion/registry-organisations'],
        },
      ],
    });
    const root = await admin(s);
    const types = await s.get('/organisation-types', as(root));
    expect((types.body as Page<{ id: string }>).result.map((t) => t.id)).toEqual([
      'provider',
      'consortium',
      'funder',
    ]);
    const created = await s.post('/organisations', {
      ...as(root),
      body: { type: 'funder', abbreviation: 'DFG', name: 'DFG' },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    referenced.add(id);
    const refused = await s.call('DELETE', `/organisations/${id}`, as(root));
    expect(refused.status).toBe(409);
    const problem = refused.body as Problem;
    expect(problem.type).toMatch(/organisation-in-use$/);
    expect(problem.detail).toContain('fixture.funders');
    expect(problem.detail).not.toContain(id);
    const patched = await s.call('PATCH', `/organisations/${id}`, {
      ...as(root),
      body: { type: 'provider' },
    });
    expect(patched.status).toBe(409);
    referenced.clear();
    expect((await s.call('DELETE', `/organisations/${id}`, as(root))).status).toBe(204);
  });
});

describe('GET /organisations/{id}/schema-org', () => {
  it('answers JSON-LD with the right media type, a private cache header and the shape of the OpenAPI route', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const row = await makeOrganisation(s.kernel.pool, {
      abbreviation: 'IPK',
      name: 'Leibniz </script> Institute',
      website: 'https://ipk.example.org',
      rorId: '02skbsp27',
    });
    const reply = await s.get(`/organisations/${row.id}/schema-org`, as(user));
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('content-type')).toBe('application/ld+json; charset=utf-8');
    expect(reply.res.headers.get('cache-control')).toBe('private, no-cache');
    expect(reply.bytes.toString()).not.toContain('<'); // serializeJsonLd, also for the API
    expect(reply.body).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${s.kernel.config.ORIGIN}/organisations/${row.id}`,
      name: 'Leibniz </script> Institute',
      alternateName: 'IPK',
      url: 'https://ipk.example.org',
    });
    // The route's own schema accepts the answer, and the answer holds no property outside it.
    const found = s.kernel.routes.find(
      ({ route }) => route.path === '/organisations/{id}/schema-org',
    )!;
    const schema = (
      found.route.responses as Record<
        number,
        { content: Record<string, { schema: { safeParse(v: unknown): { success: boolean } } }> }
      >
    )[200]!.content['application/ld+json']!.schema;
    expect(schema.safeParse(reply.body).success).toBe(true);
  });

  it('builds the URLs below the base path of the instance', async () => {
    const s = await start({ basePath: '/a/b' });
    const user = await s.signedIn('plain');
    const row = await makeOrganisation(s.kernel.pool, { logoBlobId: null, logoHash: null });
    const reply = await s.get(`/organisations/${row.id}/schema-org`, as(user));
    expect((reply.body as { '@id': string })['@id']).toBe(
      `${s.kernel.config.ORIGIN}/a/b/organisations/${row.id}`,
    );
  });

  it('shows the contact point to an administrator, to a plain user while the setting is on, and hides it when it is off', async () => {
    const s = await start();
    const root = await admin(s);
    const user = await s.signedIn('plain');
    const row = await makeOrganisation(s.kernel.pool, {
      contactEmail: 'info@example.org',
      contactType: 'support',
    });
    const path = `/organisations/${row.id}/schema-org`;
    const contactOf = async (who: { cookie: string; csrf: string }) =>
      (await s.get(path, as(who))).body as { contactPoint?: unknown };
    expect((await contactOf(user)).contactPoint).toEqual({
      '@type': 'ContactPoint',
      email: 'info@example.org',
      contactType: 'support',
    });
    await setExposeContactPoint(s, root, false);
    const plain = await s.get(path, as(user));
    expect(plain.bytes.toString()).not.toContain('info@example.org');
    expect(plain.body).not.toHaveProperty('contactPoint');
    expect((await contactOf(root)).contactPoint).toBeDefined();
    await setExposeContactPoint(s, root, true);
    expect((await contactOf(user)).contactPoint).toBeDefined();
  });

  it('answers 404 for an unknown id, 422 for a malformed one and 401 without a session', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const missing = await s.get(
      '/organisations/018f3b7e-0000-7000-8000-000000000000/schema-org',
      as(user),
    );
    expect(missing.status).toBe(404);
    expect(missing.res.headers.get('content-type')).toMatch(/application\/problem\+json/);
    expect((await s.get('/organisations/nope/schema-org', as(user))).status).toBe(422);
    const row = await makeOrganisation(s.kernel.pool);
    expect((await s.get(`/organisations/${row.id}/schema-org`)).status).toBe(401);
  });

  it('is readable through the typed client, which returns the parsed JSON', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const row = await makeOrganisation(s.kernel.pool, { abbreviation: 'IPK', name: 'Leibniz' });
    const api: ApiClient = createApiClient({
      basePath: '/',
      origin: 'http://api.test',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const reply = await s.get(
          new URL(request.url).pathname.replace('/api/internal', ''),
          as(user),
        );
        return new Response(new Uint8Array(reply.bytes), {
          status: reply.status,
          headers: reply.res.headers,
        });
      },
    });
    const profile = await unwrap(
      api.GET('/organisations/{id}/schema-org', { params: { path: { id: row.id } } }),
    );
    expect(profile).toMatchObject({
      '@type': 'Organization',
      name: 'Leibniz',
      alternateName: 'IPK',
    });
  });
});

describe('PUT and DELETE /organisations/{id}/logo', () => {
  const MiB = 1024 * 1024;
  const upload = (
    s: Started,
    who: { cookie: string; csrf: string },
    id: string,
    body: Uint8Array,
  ) => s.call('PUT', `/organisations/${id}/logo`, { ...as(who), body });
  const stored = async (s: Started) =>
    (
      await s.kernel.pool.query<{ hash: string; data: Buffer; held: boolean }>(
        'select hash, data, unreferenced_since is null as held from blob_blob order by created_at',
      )
    ).rows;

  it('lets an administrator upload, replace and remove a logo, and serves the file', async () => {
    const s = await start();
    const root = await admin(s);
    const row = await makeOrganisation(s.kernel.pool);
    const first = await upload(s, root, row.id, makePng(24));
    expect(first.status).toBe(200);
    const { logoUrl } = first.body as { logoUrl: string };
    expect(logoUrl).toMatch(/^\/api\/internal\/files\/[0-9a-f]{64}$/);
    conforms(s, first, 'PUT', '/organisations/{id}/logo');
    const file = await s.get(logoUrl.replace('/api/internal', ''));
    expect(file.status).toBe(200);
    expect(file.res.headers.get('content-type')).toBe('image/png');
    // It shows in the record and in the profile, below the base path.
    expect((await s.get(`/organisations/${row.id}`, as(root))).body).toMatchObject({ logoUrl });
    const profile = (await s.get(`/organisations/${row.id}/schema-org`, as(root))).body as {
      logo: { url: string };
    };
    expect(profile.logo.url).toBe(`${s.kernel.config.ORIGIN}${logoUrl}`);

    const second = await upload(s, root, row.id, makePng(32));
    expect((second.body as { logoUrl: string }).logoUrl).not.toBe(logoUrl);
    expect((await stored(s)).map((blob) => blob.held)).toEqual([false, true]);

    const removed = await s.call('DELETE', `/organisations/${row.id}/logo`, as(root));
    expect(removed.status).toBe(200);
    expect(removed.body).not.toHaveProperty('logoUrl');
    conforms(s, removed, 'DELETE', '/organisations/{id}/logo');
    expect((await stored(s)).every((blob) => !blob.held)).toBe(true);
    expect((await s.call('DELETE', `/organisations/${row.id}/logo`, as(root))).status).toBe(404);
  });

  it('strips the EXIF of a JPEG and sanitises an SVG with a script', async () => {
    const s = await start();
    const root = await admin(s);
    const row = await makeOrganisation(s.kernel.pool);
    expect((await upload(s, root, row.id, makeJpegWithExif())).status).toBe(200);
    expect((await stored(s))[0]!.data.toString('latin1')).not.toContain(JPEG_EXIF_MARK);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4"/></svg>',
    );
    expect((await upload(s, root, row.id, svg)).status).toBe(200);
    expect((await stored(s))[1]!.data.toString()).not.toMatch(/script|alert|onload/);
  });

  it('refuses a text file named .png (422) and keeps the old logo', async () => {
    const s = await start();
    const root = await admin(s);
    const row = await makeOrganisation(s.kernel.pool);
    const first = await upload(s, root, row.id, makePng(24));
    const bad = await s.call('PUT', `/organisations/${row.id}/logo`, {
      ...as(root),
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('<html>logo.png</html>'),
    });
    expect(bad.status).toBe(422);
    expect(bad.res.headers.get('content-type')).toMatch(/problem\+json/);
    expect((await s.get(`/organisations/${row.id}`, as(root))).body).toMatchObject({
      logoUrl: (first.body as { logoUrl: string }).logoUrl,
    });
  });

  it('refuses a body above the upload ceiling (413) and stores nothing', async () => {
    const s = await start();
    const root = await admin(s);
    const row = await makeOrganisation(s.kernel.pool);
    expect((await upload(s, root, row.id, new Uint8Array(8 * MiB + 1))).status).toBe(413);
    expect(await stored(s)).toEqual([]);
  });

  it('answers 404 for an unknown organisation and 422 for a malformed id', async () => {
    const s = await start();
    const root = await admin(s);
    expect((await upload(s, root, '018f3b7e-0000-7000-8000-000000000000', makePng())).status).toBe(
      404,
    );
    expect((await upload(s, root, 'nope', makePng())).status).toBe(422);
    expect(await stored(s)).toEqual([]);
  });

  it('is denied to a plain user (403, no file stored) and to nobody signed in (401)', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const row = await makeOrganisation(s.kernel.pool);
    expect((await upload(s, user, row.id, makePng())).status).toBe(403);
    expect((await s.call('DELETE', `/organisations/${row.id}/logo`, as(user))).status).toBe(403);
    expect(await stored(s)).toEqual([]);
    expect((await s.call('PUT', `/organisations/${row.id}/logo`, { body: makePng() })).status).toBe(
      401,
    );
  });

  it('releases the logo when the organisation is deleted', async () => {
    const s = await start();
    const root = await admin(s);
    const row = await makeOrganisation(s.kernel.pool);
    await upload(s, root, row.id, makePng(24));
    expect((await s.call('DELETE', `/organisations/${row.id}`, as(root))).status).toBe(204);
    expect((await stored(s)).every((blob) => !blob.held)).toBe(true);
    expect((await s.kernel.pool.query('select 1 from blob_reference')).rows).toEqual([]);
  });
});

describe('the OpenAPI document', () => {
  it('lists the organisation routes under the internal prefix with their permissions', async () => {
    const s = await start();
    const routes: AppRoute[] = s.kernel.routes
      .filter(({ module }) => module === 'registry.organisations')
      .map(({ route, surface }) => ({ ...route, path: `${SURFACE_PREFIX[surface]}${route.path}` }));
    const document = generateOpenApiDocument(routes, { title: 'Organisations', version: '1' });
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      '/api/internal/account/memberships',
      '/api/internal/memberships',
      '/api/internal/memberships/summary',
      '/api/internal/memberships/{id}/decision',
      '/api/internal/memberships/{id}/remove',
      '/api/internal/memberships/{id}/role',
      '/api/internal/organisation-types',
      '/api/internal/organisations',
      '/api/internal/organisations/{id}',
      '/api/internal/organisations/{id}/logo',
      '/api/internal/organisations/{id}/members',
      '/api/internal/organisations/{id}/membership',
      '/api/internal/organisations/{id}/schema-org',
    ]);
    const profile = document.paths?.['/api/internal/organisations/{id}/schema-org']?.get;
    expect(JSON.stringify(profile)).toContain('application/ld+json');
    expect(document.paths?.['/api/internal/organisations']?.post).toMatchObject({
      'x-permission': 'registry.organisations.organisation.manage',
    });
    expect(document.paths?.['/api/internal/organisations/{id}']?.get).toMatchObject({
      'x-permission': 'registry.organisations.organisation.read',
    });
    // Delegated (ADR-0034, Decision 14): the plain permission at the route, the service decides.
    expect(document.paths?.['/api/internal/organisations/{id}']?.patch).toMatchObject({
      'x-permission': 'registry.organisations.organisation.read',
    });
    expect(document.paths?.['/api/internal/organisations/{id}/logo']?.put).toMatchObject({
      'x-permission': 'registry.organisations.organisation.read',
    });
    expect(document.paths?.['/api/internal/organisations/{id}/logo']?.delete).toMatchObject({
      'x-permission': 'registry.organisations.organisation.read',
    });
    expect(document.paths?.['/api/internal/organisations/{id}']?.delete).toMatchObject({
      'x-permission': 'registry.organisations.organisation.manage',
    });
  });
});
