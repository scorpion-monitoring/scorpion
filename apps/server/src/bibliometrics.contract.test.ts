// The contract test of the routes of bibliometrics (M16 sprints 1 and 2, ADR-0056) through the whole pipeline: every
// answer matches the schema its route declares, every status is one the route documents, errors are problem details, the
// list uses the envelope with 0-based pages, and nothing is cached. Real Postgres, the real authoriser, a stub DOI resolver
// and the stub OpenAlex adapter (NODE_ENV=test).
import {
  addPublicationRoute,
  listPublicationsRoute,
  publicationHistoryRoute,
  publicationHistorySchema,
  publicationListSchema,
  publicationSchema,
  refreshAcceptedSchema,
  refreshCitationsRoute,
  removePublicationRoute,
} from '@scorpion/bibliometrics/public';
import { listEnvelope, PROBLEM_CONTENT_TYPE, problemSchema } from '@scorpion/contracts';
import { createStubDoiResolver } from '@scorpion/integrations';
import { makeMembership, makeOrganisation, makePublication, makeService } from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
type Who = { cookie: string; csrf: string };
const people: Record<'admin' | 'member' | 'stranger', Who> = {} as never;
let svc: { id: string };
let otherSvc: { id: string };
const KNOWN = '10.5555/contract-known';

const suffix = Math.random().toString(36).slice(2, 8);
let n = 0;
const doi = () => `10.5555/contract-${suffix}-${++n}`;
const base = (serviceId: string) => `/bibliometrics/services/${serviceId}/publications`;
const session = (who: Who) => ({ cookie: who.cookie, csrf: who.csrf });

beforeAll(async () => {
  started = await app.start({
    bibliometrics: {
      resolver: createStubDoiResolver({
        [KNOWN]: {
          title: 'A known paper',
          authors: ['Ada Example'],
          issued: { date: '2024-03', precision: 'month' },
          container: 'Journal of Contracts',
          type: 'journal-article',
        },
      }),
    },
  });
  const pool = started.kernel.pool;
  const provider = await makeOrganisation(pool, { type: 'provider' });
  const other = await makeOrganisation(pool, { type: 'provider' });
  svc = await makeService(pool, { provider: provider.id });
  otherSvc = await makeService(pool, { provider: other.id });
  people.admin = await started.signedIn(`biblio-admin-${suffix}`, { roles: ['admin'] });
  const member = await started.signedIn(`biblio-member-${suffix}`);
  await makeMembership(pool, { organisationId: provider.id, userId: member.user.id });
  people.member = member;
  people.stranger = await started.signedIn(`biblio-stranger-${suffix}`);
});

/** The status is one the route documents, and an error is a problem document. */
function documented(route: { responses: Record<string | number, unknown> }, reply: Reply) {
  expect(Object.keys(route.responses), `status ${reply.status}`).toContain(String(reply.status));
  if (reply.status >= 400) {
    expect(reply.res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(problemSchema.safeParse(reply.body).success).toBe(true);
  }
}

describe(`GET ${listPublicationsRoute.path}`, () => {
  const envelope = listEnvelope(publicationSchema);

  it('carries the citation total of the service, null while nothing is counted, and null counts per row', async () => {
    const provider = await makeOrganisation(started.kernel.pool, { type: 'provider' });
    const fresh = await makeService(started.kernel.pool, { provider: provider.id });
    await makePublication(started.kernel.pool, { serviceId: fresh.id, metadata: {} });
    const reply = await started.get(base(fresh.id), session(people.stranger));
    documented(listPublicationsRoute, reply);
    const body = publicationListSchema.parse(reply.body);
    expect(body.citations).toEqual({ source: 'openalex', total: null, found: 0, of: 1 });
    expect(body.result[0]).toMatchObject({ citedByCount: null, citationsAsOf: null });
  });

  it('answers the envelope with 0-based pages, 5 per page by default, never cached', async () => {
    for (let i = 0; i < 6; i++)
      await makePublication(started.kernel.pool, { serviceId: svc.id, metadata: {} });
    const reply = await started.get(base(svc.id), session(people.stranger));
    documented(listPublicationsRoute, reply);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = envelope.parse(reply.body);
    expect(body.metadata).toMatchObject({ currentPage: 0, pageSize: 5 });
    expect(body.metadata.totalCount).toBeGreaterThanOrEqual(6);
    expect(body.result).toHaveLength(5);

    const last = await started.get(`${base(svc.id)}?page=1&pageSize=50`, session(people.stranger));
    expect(envelope.parse(last.body).metadata).toMatchObject({ currentPage: 1, pageSize: 50 });
  });

  it.each([
    ['anonymous', 401, () => base(svc.id), undefined],
    ['an unknown service', 404, () => base(crypto.randomUUID()), 'stranger'],
    ['a service id that is no uuid', 422, () => base('not-a-uuid'), 'stranger'],
    ['a page size over 50', 422, () => `${base(svc.id)}?pageSize=51`, 'stranger'],
    ['a negative page', 422, () => `${base(svc.id)}?page=-1`, 'stranger'],
    ['an unknown query parameter', 422, () => `${base(svc.id)}?sort=doi`, 'stranger'],
  ] as const)('answers %s with %i', async (_label, status, path, who) => {
    const reply = await started.get(path(), who ? session(people[who]) : {});
    documented(listPublicationsRoute, reply);
    expect(reply.status).toBe(status);
  });
});

describe(`POST ${addPublicationRoute.path}`, () => {
  it('is rate limited with the default bucket', () => {
    expect(addPublicationRoute.rateLimit).toBe('default');
  });

  it('answers 201 with the publication and its metadata, never cached', async () => {
    const reply = await started.post(base(svc.id), {
      ...session(people.member),
      body: { doi: `https://doi.org/${KNOWN.toUpperCase()}` },
    });
    documented(addPublicationRoute, reply);
    expect(reply.status).toBe(201);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(publicationSchema.parse(reply.body)).toMatchObject({
      serviceId: svc.id,
      doi: KNOWN,
      metadata: { status: 'ok', title: 'A known paper', issued: '2024-03' },
    });
  });

  it('answers 409 for a DOI the service lists already', async () => {
    const value = doi();
    expect(
      (await started.post(base(svc.id), { ...session(people.admin), body: { doi: value } })).status,
    ).toBe(201);
    const reply = await started.post(base(svc.id), {
      ...session(people.member),
      body: { doi: `doi:${value}` },
    });
    documented(addPublicationRoute, reply);
    expect(reply.status).toBe(409);
  });

  it('answers 422 naming `doi` for a bad DOI', async () => {
    const reply = await started.post(base(svc.id), {
      ...session(people.member),
      body: { doi: 'not a doi' },
    });
    documented(addPublicationRoute, reply);
    expect(reply.status).toBe(422);
    expect((reply.body as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual([
      'doi',
    ]);
  });

  it.each([
    ['no doi', {}],
    ['an unknown field', { doi: '10.5555/x', extra: 1 }],
    ['a doi over 512 characters', { doi: `10.5555/${'a'.repeat(600)}` }],
    ['a doi that is no string', { doi: 42 }],
  ])('answers 422 for a body with %s', async (_label, body) => {
    const reply = await started.post(base(svc.id), { ...session(people.member), body });
    documented(addPublicationRoute, reply);
    expect(reply.status).toBe(422);
  });

  it.each([
    ['anonymous', 401, undefined, () => svc.id],
    ['a signed-in non-member', 403, 'stranger', () => svc.id],
    ['an unknown service', 404, 'admin', () => crypto.randomUUID()],
  ] as const)('answers %s with %i', async (_label, status, who, serviceId) => {
    const reply = await started.post(base(serviceId()), {
      ...(who ? session(people[who]) : {}),
      body: { doi: doi() },
    });
    documented(addPublicationRoute, reply);
    expect(reply.status).toBe(status);
  });
});

describe(`DELETE ${removePublicationRoute.path}`, () => {
  it('answers 204 with no body and removes the publication', async () => {
    const row = await makePublication(started.kernel.pool, { serviceId: svc.id });
    const reply = await started.call('DELETE', `${base(svc.id)}/${row.id}`, session(people.member));
    documented(removePublicationRoute, reply);
    expect(reply.status).toBe(204);
    expect(reply.bytes).toHaveLength(0);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(
      (await started.call('DELETE', `${base(svc.id)}/${row.id}`, session(people.member))).status,
    ).toBe(404);
  });

  it('answers 404 for a publication of another service, and leaves it [ASVS-8.2.2]', async () => {
    const theirs = await makePublication(started.kernel.pool, { serviceId: otherSvc.id });
    const reply = await started.call(
      'DELETE',
      `${base(svc.id)}/${theirs.id}`,
      session(people.admin),
    );
    documented(removePublicationRoute, reply);
    expect(reply.status).toBe(404);
    const { rows } = await started.kernel.pool.query(
      'select 1 from biblio_publication where id = $1',
      [theirs.id],
    );
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['anonymous', 401, undefined, () => `${base(svc.id)}/${crypto.randomUUID()}`],
    ['a signed-in non-member', 403, 'stranger', () => `${base(svc.id)}/${crypto.randomUUID()}`],
    ['a publication id that is no uuid', 422, 'admin', () => `${base(svc.id)}/nope`],
  ] as const)('answers %s with %i', async (_label, status, who, path) => {
    const reply = await started.call('DELETE', path(), who ? session(people[who]) : {});
    documented(removePublicationRoute, reply);
    expect(reply.status).toBe(status);
  });
});

describe(`GET ${publicationHistoryRoute.path}`, () => {
  const history = (serviceId: string, publicationId: string) =>
    `${base(serviceId)}/${publicationId}/history`;

  it('answers the points of a publication, oldest first, never cached', async () => {
    const pool = started.kernel.pool;
    const row = await makePublication(pool, { serviceId: svc.id, metadata: {} });
    await pool.query(
      `with runs as (
         insert into biblio_citation_run (id, trigger, source)
         select gen_random_uuid(), 'schedule', 'openalex' from generate_series(1, 2) returning id
       ), numbered as (select id, row_number() over () as n from runs)
       insert into biblio_citation_snapshot (run_id, doi, source, cited_by_count, taken_at)
       select id, $1, 'openalex', 10 + n, now() - make_interval(days => (2 - n)::int * 7) from numbered`,
      [row.doi],
    );
    const reply = await started.get(history(svc.id, row.id), session(people.stranger));
    documented(publicationHistoryRoute, reply);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = publicationHistorySchema.parse(reply.body);
    expect(body).toMatchObject({ publicationId: row.id, doi: row.doi });
    expect(body.points.map((point) => point.citedByCount)).toEqual([11, 12]);
  });

  const historyCases: [string, number, 'stranger' | undefined, () => Promise<string>][] = [
    ['anonymous', 401, undefined, () => Promise.resolve(history(svc.id, crypto.randomUUID()))],
    [
      'a publication of another service',
      404,
      'stranger',
      async () =>
        history(
          svc.id,
          (await makePublication(started.kernel.pool, { serviceId: otherSvc.id })).id,
        ),
    ],
    [
      'an unknown service',
      404,
      'stranger',
      () => Promise.resolve(history(crypto.randomUUID(), crypto.randomUUID())),
    ],
    [
      'a publication id that is no uuid',
      422,
      'stranger',
      () => Promise.resolve(history(svc.id, 'nope')),
    ],
  ];
  it.each(historyCases)('answers %s with %i', async (_label, status, who, path) => {
    const reply = await started.get(await path(), who ? session(people[who]) : {});
    documented(publicationHistoryRoute, reply);
    expect(reply.status).toBe(status);
  });
});

describe(`POST ${refreshCitationsRoute.path}`, () => {
  const refresh = (serviceId: string) => `/bibliometrics/services/${serviceId}/citations/refresh`;

  it('is rate limited with the strict bucket', () => {
    expect(refreshCitationsRoute.rateLimit).toBe('strict');
  });

  it('answers 202 with the run ids, never cached, then 429 with Retry-After within ten minutes [ASVS-8.2.1]', async () => {
    const reply = await started.post(refresh(svc.id), session(people.member));
    documented(refreshCitationsRoute, reply);
    expect(reply.status).toBe(202);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(refreshAcceptedSchema.parse(reply.body).runIds).toHaveLength(1);

    const again = await started.post(refresh(svc.id), session(people.admin));
    documented(refreshCitationsRoute, again);
    expect(again.status).toBe(429);
    const wait = Number(again.res.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(600);
  });

  const refreshCases: [string, number, 'stranger' | 'admin' | undefined, () => string][] = [
    ['anonymous', 401, undefined, () => otherSvc.id],
    ['a signed-in non-member', 403, 'stranger', () => otherSvc.id],
    ['an unknown service', 404, 'admin', () => crypto.randomUUID()],
    ['a service id that is no uuid', 422, 'admin', () => 'not-a-uuid'],
  ];
  it.each(refreshCases)('answers %s with %i', async (_label, status, who, serviceId) => {
    const reply = await started.post(refresh(serviceId()), who ? session(people[who]) : {});
    documented(refreshCitationsRoute, reply);
    expect(reply.status).toBe(status);
  });
});
