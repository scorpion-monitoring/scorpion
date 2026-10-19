// The RDF reads of kpi.framework (M9 sprint 4) through the whole pipeline over real Postgres: the public pair
// (`/public/kpi/rimo.ttl` and `.jsonld`, no token, a short max-age, an ETag and 304), what neither pair may ever say (a
// service, a person, a token, a value: checked on a database full of them), and who is refused on the token-bearing pair.
// The shape of the answers and the harness cases for the token-bearing pair are in kpi.contract.test.ts.
import {
  makeIndicator,
  makeKpiSet,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
type Started = Awaited<ReturnType<typeof app.start>>;
const SCOPE = 'kpi.framework.v1.read';
const PUBLIC = [
  { path: '/public/kpi/rimo.ttl', type: 'text/turtle; charset=utf-8' },
  { path: '/public/kpi/rimo.jsonld', type: 'application/ld+json; charset=utf-8' },
] as const;
const V1 = ['/kpi/rimo.ttl', '/kpi/rimo.jsonld'] as const;

async function tokenFor(s: Started, who: { cookie: string; csrf: string }, scopes: string[]) {
  const reply = await s.post('/tokens', {
    ...who,
    body: { name: `t-${Math.random().toString(36).slice(2, 9)}`, scopes },
  });
  expect(reply.status).toBe(201);
  return (reply.body as { token: string }).token;
}
const text = (reply: Reply) => reply.bytes.toString('utf8');

async function world(s: Started) {
  const pool = s.kernel.pool;
  const a = await makeIndicator(pool, { name: 'Rdf page views', unit: 'count', min: 0 });
  const b = await makeIndicator(pool, {
    name: 'Rdf uptime',
    unit: 'percent',
    valueType: 'percentage',
  });
  const set = await makeKpiSet(pool, {
    name: 'Rdf set',
    rimoCategory: 'Web_application',
    indicators: [
      { indicatorId: a.id, necessity: 'mandatory' },
      { indicatorId: b.id, necessity: 'optional' },
    ],
    evaluation: { indicatorId: a.id, aggregate: 'sum' },
  });
  return { a, b, set };
}

describe('the public RDF reads', () => {
  it.each(PUBLIC)(
    '$path answers without credentials, with a short max-age and an ETag, and sets no cookie',
    async ({ path, type }) => {
      const s = await app.start({ kpi: true, publicApi: true });
      await world(s);
      const reply = await s.get(path);
      expect(reply.status).toBe(200);
      expect(reply.res.headers.get('content-type')).toBe(type);
      expect(reply.res.headers.get('cache-control')).toBe('public, max-age=300');
      expect(reply.res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(reply.res.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/);
      expect(reply.setCookie).toBeUndefined();
      expect(text(reply)).toContain('Rdf page views');
      expect(reply.res.headers.get('x-request-id')).toBeTruthy();
    },
  );

  it.each(PUBLIC)(
    '$path answers 304 to a matching If-None-Match, in every form a client sends it, and 200 to another',
    async ({ path }) => {
      const s = await app.start({ kpi: true, publicApi: true });
      await world(s);
      const first = await s.get(path);
      const etag = first.res.headers.get('etag')!;
      for (const header of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
        const again = await s.get(path, { headers: { 'if-none-match': header } });
        expect(again.status, header).toBe(304);
        expect(again.bytes.length).toBe(0);
        expect(again.res.headers.get('etag')).toBe(etag);
        expect(again.res.headers.get('cache-control')).toBe('public, max-age=300');
      }
      const other = await s.get(path, { headers: { 'if-none-match': '"0000"' } });
      expect(other.status).toBe(200);
      expect(text(other)).toBe(text(first));
    },
  );

  it.each(PUBLIC)(
    '$path has a new ETag after a definition changed and serves the new text',
    async ({ path }) => {
      const s = await app.start({ kpi: true, publicApi: true });
      await world(s);
      const before = await s.get(path);
      await makeIndicator(s.kernel.pool, { name: 'Rdf added later' });
      const after = await s.get(path);
      expect(after.res.headers.get('etag')).not.toBe(before.res.headers.get('etag'));
      expect(text(after)).toContain('Rdf added later');
      expect(
        (await s.get(path, { headers: { 'if-none-match': before.res.headers.get('etag')! } }))
          .status,
      ).toBe(200);
    },
  );

  it.each(PUBLIC)(
    '$path is 422 for any query parameter, so junk cannot fragment a shared cache',
    async ({ path }) => {
      const s = await app.start({ kpi: true, publicApi: true });
      expect((await s.get(`${path}?cache=1`)).status).toBe(422);
    },
  );

  it('are the same documents as the token-bearing reads', async () => {
    const s = await app.start({ kpi: true, publicApi: true });
    await world(s);
    const token = await tokenFor(s, await s.signedIn('rdf-same'), [SCOPE]);
    const headers = { authorization: `Bearer ${token}` };
    for (const [index, { path }] of PUBLIC.entries()) {
      const open = await s.get(path);
      const guarded = await s.getV1(V1[index]!, { headers });
      expect(text(guarded)).toBe(text(open));
    }
  });

  it('serve a database that has no indicator at all', async () => {
    const s = await app.start({ kpi: true, publicApi: true });
    for (const { path } of PUBLIC) expect((await s.get(path)).status).toBe(200);
  });

  it('are not there in a profile without kpi.framework', async () => {
    const s = await app.start({ publicApi: true });
    for (const { path } of PUBLIC) expect((await s.get(path)).status).toBe(404);
  });
});

describe('what the RDF reads never say', () => {
  it('has no service, person, token, contact or value in any of the four answers, on a database full of them [ASVS-8.3.1]', async () => {
    const s = await app.start({ kpi: true, publicApi: true });
    const pool = s.kernel.pool;
    const { a, b, set } = await world(s);
    const mark = 'leakmark7731';
    const owner = await s.signedIn(`${mark}owner`, { email: `${mark}@secret.example.org` });
    const provider = await makeOrganisation(pool, {
      type: 'provider',
      abbreviation: `${mark.toUpperCase()}-ORG`,
      name: `${mark} organisation`,
    });
    const service = await makeService(pool, {
      slug: `${mark.toLowerCase()}-svc`,
      name: `${mark} service`,
      description: `${mark} description`,
      url: `https://${mark.toLowerCase()}.example.org/`,
      contactEmail: `${mark}-contact@secret.example.org`,
      contactType: 'support',
      publishedBy: owner.user.id,
      provider: provider.id,
      public: true,
    });
    await makeServiceKpis(pool, { serviceId: service.id, setId: set.id, extras: [b.id] });
    const token = await tokenFor(s, owner, [SCOPE]);

    const answers: Reply[] = [];
    for (const { path } of PUBLIC) answers.push(await s.get(path));
    for (const path of V1)
      answers.push(await s.getV1(path, { headers: { authorization: `Bearer ${token}` } }));
    expect(answers.map((reply) => reply.status)).toEqual([200, 200, 200, 200]);

    const forbidden = [
      mark,
      mark.toUpperCase(),
      token,
      token.slice(0, 12),
      service.id,
      service.slug,
      provider.id,
      owner.user.id,
      owner.user.username,
      'secret.example.org',
      '/services/',
      '/organisations/',
      '/users/',
    ];
    for (const reply of answers) {
      const body = text(reply);
      const headers = JSON.stringify([...reply.res.headers.entries()]);
      for (const needle of forbidden) {
        expect(body.includes(needle), `${reply.res.url} body has ${needle}`).toBe(false);
        expect(headers.includes(needle), `${reply.res.url} headers have ${needle}`).toBe(false);
      }
      // The definitions are there, so the check can fail.
      expect(body).toContain('Rdf page views');
    }
    // The headline of the set's evaluation (an aggregate) and the number of services using a set are not definitions either.
    for (const reply of answers) {
      expect(text(reply)).not.toMatch(/aggregate|headline|evaluation/i);
    }
  });
});

describe('who is refused on the token-bearing reads', () => {
  it.each(V1)(
    '%s: no credentials 401, a made-up token 401, a token of another scope 403, as problem+json',
    async (path) => {
      const s = await app.start({ kpi: true, publicApi: true });
      const who = await s.signedIn('rdf-denied');
      const other = await tokenFor(s, who, ['registry.services.v1.read']);
      const cases: [Record<string, string>, number][] = [
        [{}, 401],
        [{ authorization: 'Bearer scp_nonsense' }, 401],
        [{ authorization: `Bearer ${other}` }, 403],
      ];
      for (const [headers, status] of cases) {
        const reply = await s.getV1(path, { headers });
        expect(reply.status).toBe(status);
        expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
        expect(text(reply)).not.toContain('@prefix');
      }
    },
  );

  it.each(V1)(
    '%s: a session answers only for a person who holds the permission [ASVS-8.2.1]',
    async (path) => {
      const allowed = await app.start({ kpi: true, publicApi: true });
      const reader = await allowed.signedIn('rdf-session-yes');
      expect((await allowed.getV1(path, { cookie: reader.cookie })).status).toBe(200);
      const restricted = await app.start({
        kpi: true,
        publicApi: true,
        permissions: ['core.identity.me.read'],
      });
      const other = await restricted.signedIn('rdf-session-no');
      const denied = await restricted.getV1(path, { cookie: other.cookie });
      expect(denied.status).toBe(403);
      expect(text(denied)).not.toContain('@prefix');
    },
  );

  it.each(V1)(
    '%s: a token whose owner lacks the permission is 403 even with the scope [ASVS-8.2.1]',
    async (path) => {
      const s = await app.start({
        kpi: true,
        publicApi: true,
        permissions: ['core.identity.me.read'],
      });
      const who = await s.signedIn('rdf-lacks');
      const created = await s.post('/tokens', { ...who, body: { name: 'lacks', scopes: [SCOPE] } });
      // Either the token cannot be created with a scope the owner lacks, or it is refused when used.
      if (created.status === 201) {
        const reply = await s.getV1(path, {
          headers: { authorization: `Bearer ${(created.body as { token: string }).token}` },
        });
        expect(reply.status).toBe(403);
      } else {
        expect([403, 422]).toContain(created.status);
      }
    },
  );
});
