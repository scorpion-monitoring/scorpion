// The service of kpi.impact on real Postgres: denied per caller class, the consortium check, two consortia, the published switch, the labels in
// the caller's language and the licence verdicts through the stub SPDX adapter (never the live fetch).
import { Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useImpact } from '../test/harness.ts';
import { paths, rejection, uniq } from '../test/world.ts';

const h = useImpact();
const anonymous: Actor = { kind: 'anonymous' };
const ABSENT = '0198f9c0-1234-7abc-8def-0123456789ab';

async function setup() {
  const s = await h.start();
  const reviewer = await s.actor('reviewer');
  const admin = await s.actor('admin');
  const user = await s.actor('user');
  const nobody = await s.actor();
  const consortium = await makeOrganisation(s.pool, { type: 'consortium', name: uniq('Cons') });
  const provider = await makeOrganisation(s.pool, { type: 'provider', name: uniq('Prov') });
  return { ...s, reviewer, admin, user, nobody, consortium, provider };
}

const stageCount = (tiles: { stages: { key: string; count: number }[] }, key: string) =>
  tiles.stages.find((line) => line.key === key)?.count;

describe('who may read', () => {
  it('refuses an anonymous caller with 401, a user and a person with no role with 403, and serves a Reviewer and Admin [ASVS-8.2.1]', async () => {
    const s = await setup();
    const query = { consortium: s.consortium.id };
    expect(await rejection(s.impact.consortia(anonymous))).toBeInstanceOf(Unauthorized);
    expect(await rejection(s.impact.summary(anonymous, query))).toBeInstanceOf(Unauthorized);
    for (const caller of [s.user, s.nobody]) {
      expect(await rejection(s.impact.consortia(caller))).toBeInstanceOf(Forbidden);
      expect(await rejection(s.impact.summary(caller, query))).toBeInstanceOf(Forbidden);
    }
    for (const caller of [s.reviewer, s.admin]) {
      expect((await s.impact.consortia(caller)).map((c) => c.id)).toContain(s.consortium.id);
      expect((await s.impact.summary(caller, query)).total).toBe(0);
    }
  });

  it('checks the permission before it looks at the consortium, so a refused caller learns nothing about an id [ASVS-8.2.1]', async () => {
    const s = await setup();
    expect(await rejection(s.impact.summary(s.user, { consortium: ABSENT }))).toBeInstanceOf(
      Forbidden,
    );
    expect(await rejection(s.impact.summary(s.user, { consortium: s.provider.id }))).toBeInstanceOf(
      Forbidden,
    );
  });
});

describe('the consortium', () => {
  it('is a 422 naming consortium for a value that is no id, an unknown id and an organisation that is no consortium', async () => {
    const s = await setup();
    for (const consortium of ['x', '', ABSENT, s.provider.id]) {
      const error = await rejection(s.impact.summary(s.reviewer, { consortium }));
      expect(error.status).toBe(422);
      expect(paths(error)).toEqual(['query:consortium']);
    }
  });

  it('lists the consortia and not the providers, by name without case then id', async () => {
    const s = await setup();
    const tag = Math.random().toString(36).slice(2, 8);
    const b = await makeOrganisation(s.pool, { type: 'consortium', name: `bravo ${tag}` });
    const a = await makeOrganisation(s.pool, { type: 'consortium', name: `Alpha ${tag}` });
    const listed = await s.impact.consortia(s.reviewer);
    expect(listed.filter((c) => c.name.endsWith(tag)).map((c) => c.id)).toEqual([a.id, b.id]);
    expect(listed.map((c) => c.id)).not.toContain(s.provider.id);
  });
});

describe('the counts', () => {
  it('counts a service of two consortia once in each, and a service with none in neither', async () => {
    const s = await setup();
    const other = await makeOrganisation(s.pool, { type: 'consortium', name: uniq('Other') });
    await makeService(s.pool, {
      public: true,
      provider: s.provider.id,
      stage: 'PROD',
      consortia: [s.consortium.id, other.id],
    });
    await makeService(s.pool, { public: true, stage: 'DEV', consortia: [s.consortium.id] });
    await makeService(s.pool, { public: true, provider: s.provider.id, stage: 'PROD' });
    const here = await s.impact.summary(s.reviewer, { consortium: s.consortium.id });
    const there = await s.impact.summary(s.reviewer, { consortium: other.id });
    expect(here.total).toBe(2);
    expect(there.total).toBe(1);
    expect(stageCount(here, 'PROD')).toBe(1);
    expect(stageCount(here, 'DEV')).toBe(1);
    expect(stageCount(there, 'PROD')).toBe(1);
  });

  it('counts only published services by default and every linked one with includeUnpublished', async () => {
    const s = await setup();
    await makeService(s.pool, { public: true, consortia: [s.consortium.id], license: 'MIT' });
    await makeService(s.pool, { public: false, consortia: [s.consortium.id], license: 'MIT' });
    const query = { consortium: s.consortium.id };
    expect((await s.impact.summary(s.reviewer, query)).total).toBe(1);
    expect(
      (await s.impact.summary(s.reviewer, { ...query, includeUnpublished: false })).total,
    ).toBe(1);
    const all = await s.impact.summary(s.reviewer, { ...query, includeUnpublished: true });
    expect(all.total).toBe(2);
    expect(all.openSource).toBe(2);
  });

  it('judges the licence by the SPDX list: OSI and current is open source, a deprecated id is not, an unknown id or none is unknown', async () => {
    const s = await setup();
    const link = { public: true, consortia: [s.consortium.id] };
    await makeService(s.pool, { ...link, license: 'MIT' });
    await makeService(s.pool, { ...link, license: 'apache-2.0' });
    await makeService(s.pool, { ...link, license: 'GPL-2.0' });
    await makeService(s.pool, { ...link, license: 'Not-A-Licence' });
    await makeService(s.pool, { ...link, license: null });
    const tiles = await s.impact.summary(s.reviewer, { consortium: s.consortium.id });
    expect(tiles).toMatchObject({
      total: 5,
      openSource: 2,
      licenceDeprecated: 1,
      licenceUnknown: 2,
      otherLicence: 0,
    });
  });

  it('gives an empty consortium a line for every term at zero', async () => {
    const s = await setup();
    const tiles = await s.impact.summary(s.reviewer, { consortium: s.consortium.id });
    expect(tiles.total).toBe(0);
    expect(tiles.stages.length).toBeGreaterThanOrEqual(4);
    expect(tiles.stages.every((line) => line.count === 0 && line.label.length > 0)).toBe(true);
    expect(tiles.otherStages).toEqual([]);
  });
});
