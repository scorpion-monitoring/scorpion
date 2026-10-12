// The service routes through the whole pipeline (session, CSRF, permission, validation, error mapping)
// over real Postgres. The denied cases of every route are in defect-01.privilege-escalation.test.ts. Each
// answer is also parsed with the response schema of its route, so the generated OpenAPI document and the
// real answer cannot differ. The service rules are in modules/registry-services/service/services.test.ts.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
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
  errors?: { in?: string; path: string; message: string }[];
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

let n = 0;
const slug = () => `rt-${++n}-${Math.random().toString(36).slice(2, 6)}`;

async function world() {
  const s = await start();
  const root = await admin(s);
  const user = await s.signedIn('plain');
  const provider = await makeOrganisation(s.kernel.pool, { type: 'provider' });
  const consortium = await makeOrganisation(s.kernel.pool, { type: 'consortium' });
  return { ...s, s, root, user, provider, consortium };
}

describe('GET /services', () => {
  it('answers a plain user with the legacy envelope, 0-based, sorted by name then id', async () => {
    const { s, user, provider } = await world();
    for (const name of ['B', 'A', 'C']) {
      await makeService(s.kernel.pool, { name, provider: provider.id });
    }
    const reply = await s.get('/services?page=1&pageSize=2', as(user));
    expect(reply.status).toBe(200);
    const body = reply.body as Page<{ name: string; organisations: { role: string }[] }>;
    expect(body.metadata).toEqual({ currentPage: 1, pageSize: 2, totalCount: 3, totalPages: 2 });
    expect(body.result.map((r) => r.name)).toEqual(['C']);
    expect(body.result[0]!.organisations.map((o) => o.role)).toEqual(['provider']);
    conforms(s, reply, 'GET', '/services');
  });

  it('searches, sorts in either direction, and answers 422 for a bad parameter', async () => {
    const { s, user, provider } = await world();
    await makeService(s.kernel.pool, { slug: 'galaxy', name: 'Galaxy', provider: provider.id });
    await makeService(s.kernel.pool, { slug: 'zebra', name: 'Zebra', provider: provider.id });
    const names = async (query: string) =>
      ((await s.get(`/services${query}`, as(user))).body as Page<{ name: string }>).result.map(
        (r) => r.name,
      );
    expect(await names('?q=GAL')).toEqual(['Galaxy']);
    expect(await names('?sort=slug&dir=desc')).toEqual(['Zebra', 'Galaxy']);
    for (const bad of [
      '?page=-1',
      '?pageSize=0',
      '?pageSize=101',
      '?sort=colour',
      '?dir=up',
      '?x=1',
    ]) {
      expect((await s.get(`/services${bad}`, as(user))).status, bad).toBe(422);
    }
  });

  it('does not put the contact point, the description, the links or the audit columns in a row', async () => {
    const { s, root, provider } = await world();
    await makeService(s.kernel.pool, {
      provider: provider.id,
      contactEmail: 'ops@example.org',
      contactType: 'support',
      description: 'private words',
      sameAs: ['https://a.example'],
      createdBy: root.user.id,
    });
    const reply = await s.get('/services', as(root));
    expect(JSON.stringify(reply.body)).not.toMatch(
      /ops@example\.org|contactEmail|private words|sameAs|createdBy/,
    );
  });

  it('answers 401 to an anonymous caller', async () => {
    const { s } = await world();
    expect((await s.get('/services')).status).toBe(401);
  });
});

describe('GET /services/{id} and /services/by-slug/{slug}', () => {
  it('answers the record, by id and by slug, and an old slug with redirectedFrom', async () => {
    const { s, user, provider, consortium } = await world();
    const row = await makeService(s.kernel.pool, {
      slug: 'galaxy-eu',
      oldSlugs: ['galaxy'],
      provider: provider.id,
      consortia: [consortium.id],
      license: 'MIT',
    });
    const byId = await s.get(`/services/${row.id}`, as(user));
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({
      id: row.id,
      slug: 'galaxy-eu',
      license: 'MIT',
      public: false,
    });
    expect((byId.body as { organisations: unknown[] }).organisations).toHaveLength(2);
    conforms(s, byId, 'GET', '/services/{id}');

    const bySlug = await s.get('/services/by-slug/GALAXY-EU', as(user));
    expect(bySlug.status).toBe(200);
    expect(bySlug.body).not.toHaveProperty('redirectedFrom');
    conforms(s, bySlug, 'GET', '/services/by-slug/{slug}');

    const old = await s.get('/services/by-slug/galaxy', as(user));
    expect(old.body).toMatchObject({ id: row.id, slug: 'galaxy-eu', redirectedFrom: 'galaxy' });
    conforms(s, old, 'GET', '/services/by-slug/{slug}');
  });

  it('answers 404 for an unknown id or slug and 422 for an id that is no UUID, as problem+json', async () => {
    const { s, user } = await world();
    const missing = await s.get('/services/0198f9c0-1234-7abc-8def-0123456789ab', as(user));
    expect(missing.status).toBe(404);
    expect(missing.res.headers.get('content-type')).toContain('application/problem+json');
    expect((await s.get('/services/by-slug/nobody', as(user))).status).toBe(404);
    const bad = await s.get('/services/galaxy', as(user));
    expect(bad.status).toBe(422);
    expect((bad.body as Problem).errors?.[0]?.path).toBe('id');
  });

  it('shows the contact point by the setting, never to the list', async () => {
    const { s, user, root, provider } = await world();
    const row = await makeService(s.kernel.pool, {
      provider: provider.id,
      contactEmail: 'ops@example.org',
      contactType: 'support',
    });
    expect(await s.get(`/services/${row.id}`, as(user))).toMatchObject({
      body: { contactEmail: 'ops@example.org', contactType: 'support' },
    });
    const current = (await s.get('/settings/registry.services', as(root))).body as {
      version: number;
    };
    const saved = await s.call('PUT', '/settings/registry.services', {
      ...as(root),
      body: { version: current.version, values: { exposeContactPoint: false, allowPublic: true } },
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify((await s.get(`/services/${row.id}`, as(user))).body)).not.toContain(
      'ops@example.org',
    );
    expect(JSON.stringify((await s.get(`/services/${row.id}`, as(root))).body)).toContain(
      'ops@example.org',
    );
  });
});

describe('POST /services', () => {
  it('creates the service for an administrator: 201, the whole record, the event, the audit flag', async () => {
    const { s, root, provider, consortium } = await world();
    const name = slug();
    const reply = await s.call('POST', '/services', {
      ...as(root),
      body: {
        slug: name,
        name: 'Galaxy',
        license: 'MIT',
        stage: 'PROD',
        description: 'Workflows',
        url: 'https://galaxy.example',
        sameAs: ['https://doi.org/10.1/x'],
        provider: provider.id,
        consortia: [consortium.id],
        contact: { email: 'ops@galaxy.example', type: 'Support' },
      },
    });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({
      slug: name,
      license: 'MIT',
      stage: 'PROD',
      public: false,
      contactEmail: 'ops@galaxy.example',
      createdBy: root.user.id,
    });
    conforms(s, reply, 'POST', '/services');
    const stored = await s.kernel.pool.query<{ n: number }>(
      'select count(*)::int as n from svc_service where slug = $1',
      [name],
    );
    expect(stored.rows[0]!.n).toBe(1);
    const events = await s.kernel.pool.query(
      "select payload from kernel_outbox where name = 'registry.service.created@1'",
    );
    expect(events.rows).toHaveLength(1);
    expect(JSON.stringify(events.rows)).not.toMatch(/Galaxy|galaxy\.example/);
  });

  it('answers 409 with a problem type for a taken slug, naming the field only', async () => {
    const { s, root, provider } = await world();
    const name = slug();
    const body = { slug: name, name: 'One', provider: provider.id };
    expect((await s.call('POST', '/services', { ...as(root), body })).status).toBe(201);
    const again = await s.call('POST', '/services', {
      ...as(root),
      body: { ...body, slug: name.toUpperCase() },
    });
    expect(again.status).toBe(409);
    expect(again.res.headers.get('content-type')).toContain('application/problem+json');
    expect(again.body).toMatchObject({
      type: expect.stringContaining('slug-taken') as string,
      status: 409,
    });
    expect((again.body as Problem).errors).toEqual([
      { in: 'body', path: 'slug', message: 'This slug is already taken.' },
    ]);
  });

  it('answers 422, never 500, for an unknown organisation, a wrong type, a missing provider, an unknown stage and licence', async () => {
    const { s, root, provider, consortium } = await world();
    const ghost = '0198f9c0-1234-7abc-8def-0123456789ab';
    const cases: [string, Record<string, unknown>, string][] = [
      ['an unknown provider', { provider: ghost }, 'provider'],
      ['a consortium as provider', { provider: consortium.id }, 'provider'],
      ['an unknown consortium', { provider: provider.id, consortia: [ghost] }, 'consortia.0'],
      ['an unknown stage', { provider: provider.id, stage: 'BETA' }, 'stage'],
      ['an unknown licence', { provider: provider.id, license: 'Proprietary-X' }, 'license'],
      ['a bad slug', { provider: provider.id, slug: 'new' }, 'slug'],
      ['a key no field owns', { provider: provider.id, public: true }, 'public'],
    ];
    for (const [label, extra, path] of cases) {
      const reply = await s.call('POST', '/services', {
        ...as(root),
        body: { slug: slug(), name: 'X', ...extra },
      });
      expect(reply.status, label).toBe(422);
      expect(reply.res.headers.get('content-type'), label).toContain('application/problem+json');
      expect(
        (reply.body as Problem).errors?.map((e) => e.path),
        label,
      ).toContain(path);
    }
    const missing = await s.call('POST', '/services', {
      ...as(root),
      body: { slug: slug(), name: 'X' },
    });
    expect(missing.status).toBe(422);
    const none = await s.kernel.pool.query<{ n: number }>(
      'select count(*)::int as n from svc_service',
    );
    expect(none.rows[0]!.n).toBe(0);
  });

  it('answers 422 for a body of the wrong shape and 413 for one that is too large', async () => {
    const { s, root, provider } = await world();
    for (const body of [[], 'text', { slug: 5, name: 'X', provider: provider.id }]) {
      const reply = await s.call('POST', '/services', { ...as(root), body });
      expect(reply.status, JSON.stringify(body)).toBe(422);
    }
    const huge = await s.call('POST', '/services', {
      ...as(root),
      body: { slug: slug(), name: 'X', provider: provider.id, description: 'x'.repeat(70_000) },
    });
    expect([413, 422]).toContain(huge.status);
  });

  it('is denied to a plain user with 403 and to an anonymous caller with 401, and writes nothing', async () => {
    const { s, user, provider } = await world();
    const body = { slug: slug(), name: 'X', provider: provider.id };
    expect((await s.call('POST', '/services', { ...as(user), body })).status).toBe(403);
    expect((await s.call('POST', '/services', { body })).status).toBe(401);
    const none = await s.kernel.pool.query<{ n: number }>(
      'select count(*)::int as n from svc_service',
    );
    expect(none.rows[0]!.n).toBe(0);
  });
});

describe('GET /licenses and GET /service-roles', () => {
  it('search the SPDX list, deprecated ids marked, in the envelope', async () => {
    const { s, user } = await world();
    const reply = await s.get('/licenses?q=gpl-2.0&limit=5', as(user));
    expect(reply.status).toBe(200);
    const body = reply.body as Page<{ id: string; deprecated: boolean }>;
    expect(body.metadata.currentPage).toBe(0);
    expect(body.result.length).toBeLessThanOrEqual(5);
    expect(body.result.find((l) => l.id === 'GPL-2.0')?.deprecated).toBe(true);
    conforms(s, reply, 'GET', '/licenses');
    for (const bad of ['?limit=0', '?limit=101', '?limit=x', '?q=' + 'x'.repeat(101), '?z=1']) {
      expect((await s.get(`/licenses${bad}`, as(user))).status, bad).toBe(422);
    }
    expect((await s.get('/licenses')).status).toBe(401);
  });

  it('list the roles from the registry with the label of the locale', async () => {
    const { s, user } = await world();
    const reply = await s.get('/service-roles?locale=de', as(user));
    expect(reply.status).toBe(200);
    const body = reply.body as Page<{ id: string; label: string; min: number; max: number }>;
    expect(body.result.map((r) => [r.id, r.label, r.min, r.max])).toEqual([
      ['provider', 'Anbieter', 1, 1],
      ['consortium', 'Konsortium', 0, 20],
    ]);
    conforms(s, reply, 'GET', '/service-roles');
    expect((await s.get('/service-roles')).status).toBe(401);
  });
});
