// The Schema.org profile and the anonymous reads of M7 sprint 3 (ADR-0036 part 2) through the whole pipeline over
// real Postgres: `GET /services/{id}/schema-org` for a signed-in reader, `GET /public/services/{ref}` and its
// `/schema-org`, and `GET /public/organisations/{id}` and its `/schema-org`. The rules proved here: a record that is
// not public answers the 404 of an unknown id (never 403) whatever the reason, an unpublish is seen at the next
// request, `service.allowPublic` off makes every public address a 404, the cache lifetime is one minute, the rate
// limit applies, and no contact point leaves in any of the answers. The service rules are in
// modules/registry-services/service/public.test.ts and profile.test.ts, the pinned fields in
// public-records.test.ts, the prototype in public-routes-prototype.test.ts.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const SECRET = 'team-secret@example.org';
const ORG_SECRET = 'org-secret@example.org';
const CACHE = 'public, max-age=60';

type Started = Awaited<ReturnType<typeof app.start>>;

/** Parses a reply with the response schema its route declares for the status and media type (the OpenAPI contract). */
function conforms(
  s: Started,
  reply: Reply,
  method: string,
  path: string,
  mime = 'application/json',
) {
  const found = s.kernel.routes.find(
    ({ route }) => route.method.toUpperCase() === method && route.path === path,
  );
  expect(found, `${method} ${path} is registered`).toBeDefined();
  const schema = (
    found!.route.responses as Record<
      number,
      { content?: Record<string, { schema?: { safeParse(v: unknown): { success: boolean } } }> }
    >
  )[reply.status]?.content?.[mime]?.schema;
  expect(schema, `${method} ${path} declares a ${reply.status} ${mime} answer`).toBeDefined();
  const body: unknown =
    mime === 'application/json' ? reply.body : JSON.parse(reply.bytes.toString('utf8'));
  expect(schema!.safeParse(body).success, JSON.stringify(body)).toBe(true);
  return body as Record<string, unknown>;
}

/** The problem without its request id, which differs for every request by design. */
const problemOf = (reply: Reply) => {
  const rest = { ...(reply.body as Record<string, unknown>) };
  delete rest.requestId;
  return rest;
};

async function world(options: Parameters<typeof app.start>[0] = {}) {
  const s = await app.start({ tokenCacheTtlMs: 0, ...options });
  const pool = s.kernel.pool;
  const provider = await makeOrganisation(pool, { type: 'provider', abbreviation: 'IPK' });
  const consortium = await makeOrganisation(pool, { type: 'consortium', abbreviation: 'DENBI' });
  const lonely = await makeOrganisation(pool, { type: 'provider', abbreviation: 'LONE' });
  await pool.query(
    "update org_organisation set contact_email = $2, contact_type = 'support' where id = any($1)",
    [[provider.id, consortium.id, lonely.id], ORG_SECRET],
  );
  const open = await makeService(pool, {
    provider: provider.id,
    consortia: [consortium.id],
    description: 'A public workbench',
    contactEmail: SECRET,
    contactType: 'support',
    license: 'MIT',
    iconBlobId: '018f3b7e-7777-7000-8000-000000000007',
    iconHash: 'f'.repeat(64),
    public: true,
    oldSlugs: ['the-old-slug'],
  });
  const closed = await makeService(pool, {
    provider: lonely.id,
    contactEmail: SECRET,
    contactType: 'support',
  });
  const people = {
    plain: await s.signedIn('plain-reader'),
    reviewer: await s.signedIn('rita-reviewer', { roles: ['reviewer'] }),
    admin: await s.signedIn('adminy-admin', { roles: ['admin'] }),
  };
  const setAllowPublic = async (value: boolean) => {
    const saved = await s.get('/settings/registry.services', as(people.admin));
    const put = await s.call('PUT', '/settings/registry.services', {
      ...as(people.admin),
      body: {
        version: (saved.body as { version: number }).version,
        values: { exposeContactPoint: true, allowPublic: value },
      },
    });
    expect(put.status).toBe(200);
  };
  const publish = (id: string, value: boolean) =>
    s.call('PUT', `/services/${id}/publication`, {
      ...as(people.reviewer),
      body: { public: value },
    });
  return { s, pool, provider, consortium, lonely, open, closed, people, setAllowPublic, publish };
}
type World = Awaited<ReturnType<typeof world>>;

/** Every public address of the sprint for one service and its organisations. */
const addresses = (w: World, ids = { service: w.open.id, org: w.provider.id }) => [
  `/public/services/${ids.service}`,
  `/public/services/${ids.service}/schema-org`,
  `/public/organisations/${ids.org}`,
  `/public/organisations/${ids.org}/schema-org`,
];

describe('GET /services/{id}/schema-org', () => {
  it('serves the profile of a private service to a plain User as ld+json, uncacheable by a shared cache', async () => {
    const w = await world();
    const reply = await w.s.get(`/services/${w.closed.id}/schema-org`, as(w.people.plain));
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('content-type')).toContain('application/ld+json');
    expect(reply.res.headers.get('cache-control')).toBe('private, no-cache');
    expect(reply.res.headers.get('x-content-type-options')).toBe('nosniff');
    const body = conforms(w.s, reply, 'GET', '/services/{id}/schema-org', 'application/ld+json');
    expect(body).toMatchObject({ '@type': 'Service', name: w.closed.name });
    expect(reply.bytes.toString()).not.toMatch(/[<>&]/);
  });

  it('never carries the contact point or the stage, for an Admin either [ASVS-8.2.3]', async () => {
    const w = await world();
    for (const who of ['plain', 'admin'] as const) {
      const text = (
        await w.s.get(`/services/${w.open.id}/schema-org`, as(w.people[who]))
      ).bytes.toString();
      expect(text, who).not.toContain(SECRET);
      expect(text, who).not.toContain(ORG_SECRET);
      expect(text, who).not.toMatch(/contactPoint|"PROD"/);
    }
  });

  it('answers 401 to an anonymous caller, 404 for an unknown service and 422 for a bad id', async () => {
    const w = await world();
    expect((await w.s.get(`/services/${w.open.id}/schema-org`)).status).toBe(401);
    expect((await w.s.get(`/services/${ABSENT}/schema-org`, as(w.people.plain))).status).toBe(404);
    expect((await w.s.get('/services/nope/schema-org', as(w.people.plain))).status).toBe(422);
  });

  it('is reached by a token that holds the read permission and by none that does not', async () => {
    const w = await world();
    const made = await w.s.post('/tokens', {
      ...as(w.people.plain),
      body: { name: 'reader', scopes: ['registry.services.service.read'] },
    });
    const { token } = made.body as { token: string };
    expect(
      (
        await w.s.get(`/services/${w.open.id}/schema-org`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    const other = await w.s.post('/tokens', {
      ...as(w.people.plain),
      body: { name: 'other', scopes: ['registry.organisations.organisation.read'] },
    });
    expect(
      (
        await w.s.get(`/services/${w.open.id}/schema-org`, {
          headers: { authorization: `Bearer ${(other.body as { token: string }).token}` },
        })
      ).status,
    ).toBe(403);
  });
});

describe('the public service routes', () => {
  it('answer an anonymous reader for a public service by id, slug and old slug, with the cache lifetime of a minute', async () => {
    const w = await world();
    for (const ref of [w.open.id, w.open.slug, 'the-old-slug']) {
      const reply = await w.s.get(`/public/services/${ref}`);
      expect(reply.status, ref).toBe(200);
      expect(reply.res.headers.get('cache-control')).toBe(CACHE);
      expect(reply.setCookie).toBeUndefined();
      const body = conforms(w.s, reply, 'GET', '/public/services/{ref}');
      expect(body).toMatchObject({
        id: w.open.id,
        slug: w.open.slug,
        license: 'MIT',
        provider: { id: w.provider.id, public: true },
        consortia: [{ id: w.consortium.id, public: true }],
        logoUrl: `/api/internal/files/${'f'.repeat(64)}`,
      });
    }
  });

  it('serves the JSON-LD of a public service, with the logo under the base path and no character that could end a script', async () => {
    const w = await world({ basePath: '/a/b' });
    const reply = await w.s.get(`/public/services/${w.open.slug}/schema-org`);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('content-type')).toContain('application/ld+json');
    expect(reply.res.headers.get('cache-control')).toBe(CACHE);
    const body = conforms(
      w.s,
      reply,
      'GET',
      '/public/services/{ref}/schema-org',
      'application/ld+json',
    );
    expect(body['@id']).toBe(`${w.s.kernel.config.ORIGIN}/a/b/services/${w.open.id}`);
    expect(body.logo).toEqual({
      '@type': 'ImageObject',
      url: `${w.s.kernel.config.ORIGIN}/a/b/api/internal/files/${'f'.repeat(64)}`,
    });
    expect(reply.bytes.toString()).not.toMatch(/[<>&]/);
  });

  it('give a session cookie, a stale one or a token no other answer', async () => {
    const w = await world();
    const anonymous = await w.s.get(`/public/services/${w.open.id}`);
    for (const options of [
      { cookie: w.people.plain.cookie },
      { cookie: 'stale' },
      { headers: { authorization: 'Bearer not-a-token-at-all' } },
    ]) {
      const reply = await w.s.get(`/public/services/${w.open.id}`, options);
      expect(reply.status).toBe(anonymous.status);
      expect(reply.body).toEqual(anonymous.body);
      expect(reply.setCookie).toBeUndefined();
    }
  });

  it('refuse a write: there is no public route that changes anything', async () => {
    const w = await world();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const reply = await w.s.call(method, `/public/services/${w.open.id}`, { body: {} });
      expect([404, 405], method).toContain(reply.status);
    }
  });
});

describe('the public organisation routes', () => {
  it('answer for the provider and a consortium of a public service, with its public services', async () => {
    const w = await world();
    for (const org of [w.provider, w.consortium]) {
      const reply = await w.s.get(`/public/organisations/${org.id}`);
      expect(reply.status).toBe(200);
      expect(reply.res.headers.get('cache-control')).toBe(CACHE);
      const body = conforms(w.s, reply, 'GET', '/public/organisations/{id}');
      expect(body).toMatchObject({
        id: org.id,
        services: [{ id: w.open.id, slug: w.open.slug, name: w.open.name }],
      });
      const ld = await w.s.get(`/public/organisations/${org.id}/schema-org`);
      expect(ld.status).toBe(200);
      expect(ld.res.headers.get('content-type')).toContain('application/ld+json');
      expect(ld.res.headers.get('cache-control')).toBe(CACHE);
      conforms(w.s, ld, 'GET', '/public/organisations/{id}/schema-org', 'application/ld+json');
    }
  });
});

describe('the identical 404', () => {
  it('is the answer for a private service, an unpublished one, an unknown id, an unknown slug and a ref that is neither, with one body [ASVS-8.2.1]', async () => {
    const w = await world();
    const gone = await makeService(w.pool, { provider: w.provider.id, public: true });
    expect((await w.publish(gone.id, false)).status).toBe(200);
    for (const suffix of ['', '/schema-org']) {
      const reference = await w.s.get(`/public/services/${ABSENT}${suffix}`);
      expect(reference.status).toBe(404);
      for (const ref of [w.closed.id, w.closed.slug, gone.id, gone.slug, 'no-such-slug']) {
        const reply = await w.s.get(`/public/services/${ref}${suffix}`);
        expect(reply.status, `${ref}${suffix}`).toBe(404);
        expect(problemOf(reply), `${ref}${suffix}`).toEqual(problemOf(reference));
        expect(reply.res.headers.get('content-type'), ref).toBe(
          reference.res.headers.get('content-type'),
        );
        expect(reply.res.headers.get('cache-control'), ref).toBe(
          reference.res.headers.get('cache-control'),
        );
        expect(reply.res.headers.get('cache-control') ?? '', ref).not.toContain('max-age');
      }
    }
  });

  it('is also the answer with public reads switched off, for a service that is public [ASVS-8.3.1]', async () => {
    const w = await world();
    const reference = await w.s.get(`/public/services/${ABSENT}`);
    await w.setAllowPublic(false);
    for (const ref of [w.open.id, w.open.slug, 'the-old-slug']) {
      for (const suffix of ['', '/schema-org']) {
        const reply = await w.s.get(`/public/services/${ref}${suffix}`);
        expect(reply.status, ref).toBe(404);
        expect(problemOf(reply)).toEqual(problemOf(reference));
      }
    }
    for (const org of [w.provider.id, w.consortium.id]) {
      expect((await w.s.get(`/public/organisations/${org}`)).status).toBe(404);
      expect((await w.s.get(`/public/organisations/${org}/schema-org`)).status).toBe(404);
    }
    await w.setAllowPublic(true);
    expect((await w.s.get(`/public/services/${w.open.id}`)).status).toBe(200);
  });

  it('is the answer for an organisation whose only link is to a private service, an unknown one and an id that is no UUID [ASVS-8.2.1]', async () => {
    const w = await world();
    const reference = await w.s.get(`/public/organisations/${ABSENT}`);
    expect(reference.status).toBe(404);
    const stray = await makeOrganisation(w.pool, { type: 'consortium' });
    for (const id of [w.lonely.id, stray.id, 'nope']) {
      for (const suffix of ['', '/schema-org']) {
        const reply = await w.s.get(`/public/organisations/${id}${suffix}`);
        expect(reply.status, `${id}${suffix}`).toBe(404);
        expect(problemOf(reply)).toEqual(problemOf(reference));
        expect(reply.res.headers.get('cache-control')).toBe(
          reference.res.headers.get('cache-control'),
        );
      }
    }
    // The 404 of an organisation and of a service differ in the thing named, never in why.
    expect(problemOf(reference).status).toBe(404);
  });

  it('never answers 403 or 401 on a public address, whoever asks [ASVS-8.3.1]', async () => {
    const w = await world();
    for (const who of [undefined, w.people.plain, w.people.reviewer]) {
      for (const path of [...addresses(w, { service: w.closed.id, org: w.lonely.id })]) {
        const reply = await w.s.get(path, who ? { cookie: who.cookie } : {});
        expect(reply.status, path).toBe(404);
      }
    }
  });
});

describe('an unpublish', () => {
  it('is seen at the next request on every public address, the service’s and its organisations’, and a republish brings them back [ASVS-8.2.1]', async () => {
    const w = await world();
    for (const path of addresses(w)) expect((await w.s.get(path)).status, path).toBe(200);
    expect((await w.publish(w.open.id, false)).status).toBe(200);
    for (const path of [...addresses(w), `/public/organisations/${w.consortium.id}`]) {
      expect((await w.s.get(path)).status, path).toBe(404);
    }
    expect((await w.publish(w.open.id, true)).status).toBe(200);
    for (const path of addresses(w)) expect((await w.s.get(path)).status, path).toBe(200);
  });

  it('keeps an organisation public while another public service names it', async () => {
    const w = await world();
    await makeService(w.pool, { provider: w.provider.id, public: true });
    expect((await w.publish(w.open.id, false)).status).toBe(200);
    expect((await w.s.get(`/public/organisations/${w.provider.id}`)).status).toBe(200);
    expect((await w.s.get(`/public/organisations/${w.consortium.id}`)).status).toBe(404);
  });

  it('is the only delay a shared cache adds: every 200 says it may be kept for 60 seconds and no more', async () => {
    const w = await world();
    for (const path of addresses(w)) {
      expect((await w.s.get(path)).res.headers.get('cache-control'), path).toBe(CACHE);
    }
  });
});

describe('no contact point leaves', () => {
  it('is in no public or profile answer: not the service’s, not an organisation’s [ASVS-8.2.3]', async () => {
    const w = await world();
    const answers = [
      ...(await Promise.all(addresses(w).map((path) => w.s.get(path)))),
      await w.s.get(`/public/services/${w.open.id}`, { cookie: w.people.admin.cookie }),
      await w.s.get(`/services/${w.open.id}/schema-org`, as(w.people.admin)),
      await w.s.get(`/organisations/${w.provider.id}/schema-org`, as(w.people.plain)),
    ];
    for (const reply of answers.slice(0, -1)) {
      const text = reply.bytes.toString();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(ORG_SECRET);
      expect(text).not.toMatch(/contactEmail|contactType|contactPoint/);
    }
  });
});

describe('the rate limit', () => {
  it.each([
    (w: World) => `/public/services/${w.open.id}`,
    (w: World) => `/public/services/${w.open.id}/schema-org`,
    (w: World) => `/public/organisations/${w.provider.id}`,
    (w: World) => `/public/organisations/${w.provider.id}/schema-org`,
  ])('applies to every public route (the default group)', async (path) => {
    const w = await world({ rateLimits: { default: { capacity: 2, refillPerSecond: 0.0001 } } });
    // The world's own calls (signing in) used the budget of other addresses; use a peer of our own.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await w.s.get(path(w), { peer: '198.51.100.9' })).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
  });
});
