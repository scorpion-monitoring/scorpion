// The internal reads of kpi.impact through the whole pipeline (M12 sprint 1): the consortia and the tiles of one. Session auth, the plain
// permission `kpi.impact.read` held by the role `reviewer` and Admin and not by `user`, the list envelope, `Cache-Control: no-store`, and a 4xx
// (never a 500) for every bad input.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
type Who = Awaited<ReturnType<typeof started.signedIn>>;
let reviewer: Who;
let admin: Who;
let plain: Who;
let consortium: { id: string; name: string };
let other: { id: string };
let provider: { id: string };

beforeAll(async () => {
  started = await app.start({ impact: true });
  const pool = started.kernel.pool;
  reviewer = await started.signedIn('rita-impact', { roles: ['reviewer'] });
  admin = await started.signedIn('adam-impact', { roles: ['admin'] });
  plain = await started.signedIn('paul-impact', { roles: ['user'] });
  consortium = await makeOrganisation(pool, {
    type: 'consortium',
    name: 'Impact routes consortium',
  });
  other = await makeOrganisation(pool, { type: 'consortium', name: 'Impact routes other' });
  provider = await makeOrganisation(pool, { type: 'provider', name: 'Impact routes provider' });
  await makeService(pool, {
    public: true,
    stage: 'PROD',
    license: 'MIT',
    provider: provider.id,
    consortia: [consortium.id, other.id],
  });
  await makeService(pool, {
    public: false,
    stage: 'DEV',
    license: null,
    consortia: [consortium.id],
  });
}, 120_000);

const as = (who: Who) => ({ cookie: who.cookie, csrf: who.csrf });
const problemPaths = (body: unknown) =>
  ((body as { errors?: { in: string; path: string }[] }).errors ?? []).map(
    (e) => `${e.in}:${e.path}`,
  );
type Summary = {
  total: number;
  openSource: number;
  licenceDeprecated: number;
  licenceUnknown: number;
  otherLicence: number;
  stages: { key: string; label: string; active: boolean; count: number }[];
  otherStages: { key: string; count: number }[];
};

describe('who may call', () => {
  const paths = () => ['/kpi/impact/consortia', `/kpi/impact/summary?consortium=${consortium.id}`];

  it('answers an anonymous caller 401 on both routes [ASVS-8.2.1]', async () => {
    for (const path of paths()) expect((await started.get(path)).status, path).toBe(401);
  });

  it('answers a signed-in user 403 on both routes [ASVS-8.2.1]', async () => {
    for (const path of paths()) expect((await started.get(path, as(plain))).status, path).toBe(403);
  });

  it('answers a Reviewer and Admin 200 on both routes [ASVS-8.2.1]', async () => {
    for (const who of [reviewer, admin])
      for (const path of paths()) expect((await started.get(path, as(who))).status, path).toBe(200);
  });
});

describe('GET /kpi/impact/consortia', () => {
  it('lists the consortia and no provider in the envelope, never cached', async () => {
    const reply = await started.get('/kpi/impact/consortia', as(reviewer));
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = reply.body as {
      metadata: { currentPage: number; totalCount: number };
      result: { id: string; name: string; abbreviation: string }[];
    };
    expect(Object.keys(body).sort()).toEqual(['metadata', 'result']);
    expect(body.metadata.currentPage).toBe(0);
    expect(body.metadata.totalCount).toBe(body.result.length);
    const ids = body.result.map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining([consortium.id, other.id]));
    expect(ids).not.toContain(provider.id);
    expect(Object.keys(body.result[0]!).sort()).toEqual(['abbreviation', 'id', 'name']);
  });
});

describe('GET /kpi/impact/summary', () => {
  const get = (query: string, who: Who = reviewer) =>
    started.get(`/kpi/impact/summary?${query}`, as(who));

  it('counts the published services of the consortium by default, never cached, with the vocabulary labels', async () => {
    const reply = await get(`consortium=${consortium.id}`);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const body = reply.body as Summary;
    expect(Object.keys(body).sort()).toEqual([
      'licenceDeprecated',
      'licenceUnknown',
      'openSource',
      'otherLicence',
      'otherStages',
      'stages',
      'total',
    ]);
    expect(body).toMatchObject({ total: 1, openSource: 1, licenceUnknown: 0, otherStages: [] });
    expect(body.stages.find((line) => line.key === 'PROD')).toEqual({
      key: 'PROD',
      label: 'Production',
      active: true,
      count: 1,
    });
    expect(body.stages.find((line) => line.key === 'DEV')?.count).toBe(0);
  });

  it('counts every linked service with includeUnpublished=true and says so only for true', async () => {
    const all = (await get(`consortium=${consortium.id}&includeUnpublished=true`)).body as Summary;
    expect(all).toMatchObject({ total: 2, openSource: 1, licenceUnknown: 1 });
    expect(all.stages.find((line) => line.key === 'DEV')?.count).toBe(1);
    const off = (await get(`consortium=${consortium.id}&includeUnpublished=false`)).body as Summary;
    expect(off.total).toBe(1);
    expect((await get(`consortium=${consortium.id}&includeUnpublished=yes`)).status).toBe(422);
  });

  it('counts a service of two consortia once in each', async () => {
    expect(((await get(`consortium=${other.id}`)).body as Summary).total).toBe(1);
  });

  it('is 422 naming consortium for a missing, malformed, unknown and non-consortium value', async () => {
    for (const query of ['', 'consortium=x', `consortium=${ABSENT}`, `consortium=${provider.id}`]) {
      const reply = await get(query);
      expect(reply.status, query).toBe(422);
      expect(problemPaths(reply.body), query).toEqual(['query:consortium']);
    }
  });

  it('is 422 for an unknown query parameter and for a locale that is too long', async () => {
    expect((await get(`consortium=${consortium.id}&x=1`)).status).toBe(422);
    expect((await get(`consortium=${consortium.id}&locale=${'x'.repeat(40)}`)).status).toBe(422);
  });

  it('answers with no person, no contact point and no file in the body [ASVS-8.2.1]', async () => {
    const text = JSON.stringify(
      (await get(`consortium=${consortium.id}&includeUnpublished=true`)).body,
    );
    expect(text).not.toContain('email');
    expect(text).not.toContain('contact');
    expect(text).not.toContain('userId');
    expect(text).not.toContain('slug');
  });
});

describe('the surface', () => {
  it('has no public v1 route for the impact figures', async () => {
    expect((await started.getV1('/kpi/impact/summary')).status).toBe(404);
  });
});
