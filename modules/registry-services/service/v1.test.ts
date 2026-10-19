// The v1 reads of the service (ADR-0037, M8 sprint 2) against real Postgres: the real authoriser decides, the catalogue
// query function answers the list. Each method has a denied case; a list has a zero, one and many case; a service with
// zero, one and two consortia is one row each (defect 15).
import { Forbidden, Invalid, NotFound, Unauthorized } from '@scorpion/contracts';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import { anonymous, rejection, uniq } from '../test/world.ts';

const h = useServices();
const PAGE = { page: 0, pageSize: 100 };
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

async function world() {
  const s = await h.start();
  const user = await s.actor('user');
  const p1 = await makeOrganisation(s.pool, {
    abbreviation: uniq('P1'),
    name: uniq('Provider one'),
  });
  const p2 = await makeOrganisation(s.pool, {
    abbreviation: uniq('P2'),
    name: uniq('Provider two'),
  });
  const c1 = await makeOrganisation(s.pool, {
    type: 'consortium',
    abbreviation: uniq('C1'),
    name: 'Consortium A',
  });
  const c2 = await makeOrganisation(s.pool, {
    type: 'consortium',
    abbreviation: uniq('C2'),
    name: 'Consortium B',
  });
  const zero = await makeService(s.pool, {
    slug: uniq('b-zero'),
    provider: p1.id,
    stage: 'PROD',
    license: 'MIT',
  });
  const one = await makeService(s.pool, {
    slug: uniq('A-one'),
    provider: p1.id,
    consortia: [c1.id],
    stage: 'PROD',
    public: true,
  });
  const two = await makeService(s.pool, {
    slug: uniq('c-two'),
    provider: p2.id,
    consortia: [c2.id, c1.id],
    stage: 'DEV',
    license: 'MIT',
  });
  return { ...s, user, p1, p2, c1, c2, zero, one, two };
}

describe('listV1', () => {
  it('has a `category` of null and no `category` filter when no module adds one (a profile without KPI sets)', async () => {
    const { services, user, zero } = await world();
    const { services: rows } = await services.listV1(user, {}, PAGE);
    expect(rows.every((row) => row.category === null)).toBe(true);
    const error = await rejection(services.listV1(user, { category: ['Any set'] }, PAGE));
    expect(error).toBeInstanceOf(Invalid);
    expect(error.errors?.[0]).toMatchObject({ in: 'query', path: 'category' });
    expect((await services.getV1(user, zero.id)).category).toBeNull();
  });

  it('answers a list of zero, then one row per service with zero, one and two consortia, by slug without case and then id', async () => {
    const empty = await h.start();
    const reader = await empty.actor('user');
    expect(await empty.services.listV1(reader, {}, PAGE)).toEqual({ services: [], total: 0 });

    const { services, user, p1, p2, c1, c2, zero, one, two } = await world();
    const { services: rows, total } = await services.listV1(user, {}, PAGE);
    expect(total).toBe(3);
    expect(rows.map((r) => r.id)).toEqual([one.id, zero.id, two.id]); // A-one, b-zero, c-two
    const [r1, r0, r2] = rows;
    expect(r0).toMatchObject({
      abbreviation: zero.slug,
      provider: p1.abbreviation,
      providerId: p1.id,
      consortia: [],
      consortiaIds: [],
      stage: 'PROD',
      license: 'MIT',
      public: false,
    });
    expect(r1).toMatchObject({ consortia: [c1.abbreviation], consortiaIds: [c1.id], public: true });
    // By consortium name, then id, with the ids in the same order as the abbreviations.
    expect(r2).toMatchObject({
      provider: p2.abbreviation,
      consortia: [c1.abbreviation, c2.abbreviation],
      consortiaIds: [c1.id, c2.id],
      license: 'MIT',
    });
    const second = await services.listV1(user, {}, { page: 1, pageSize: 2 });
    expect(second.services.map((r) => r.id)).toEqual([two.id]);
    expect(second.total).toBe(3);
  });

  it('returns a pinned row: never the contact point, the icon, the description, the values or an audit column', async () => {
    const { services, pool, user, p1 } = await world();
    await makeService(pool, {
      provider: p1.id,
      contactEmail: 'secret@example.org',
      contactType: 'support',
      description: 'About',
      iconBlobId: '018f3b7e-6666-7000-8000-000000000006',
      iconHash: 'e'.repeat(64),
      values: { category: ['x'] },
      createdBy: '018f3b7e-7777-7000-8000-000000000007',
    });
    const { services: rows } = await services.listV1(user, {}, PAGE);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'abbreviation',
          'category',
          'consortia',
          'consortiaIds',
          'id',
          'license',
          'name',
          'provider',
          'providerId',
          'public',
          'stage',
        ].sort(),
      );
    }
    expect(JSON.stringify(rows)).not.toMatch(/secret@|support|About|createdBy|iconUrl/);
  });

  it('puts only the organisations with the role consortium into consortia', async () => {
    const { services, pool, user, p1, c1 } = await world();
    const other = await makeOrganisation(pool, { type: 'consortium', abbreviation: uniq('OTH') });
    const odd = await makeService(pool, {
      slug: uniq('odd'),
      provider: p1.id,
      consortia: [c1.id],
      organisations: [{ organisationId: other.id, role: 'funder' }],
    });
    const { services: rows } = await services.listV1(user, { services: [odd.slug] }, PAGE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.consortia).toEqual([c1.abbreviation]);
  });

  it('filters by service and provider abbreviation (a list, without case), stage and licence, and totalCount counts the filtered set [ASVS-8.2.3]', async () => {
    const { services, user, p1, p2, zero, one, two } = await world();
    const ids = async (filter: Parameters<typeof services.listV1>[1], page = PAGE) =>
      (await services.listV1(user, filter, page)).services.map((r) => r.id);
    expect(await ids({ services: [zero.slug.toUpperCase()] })).toEqual([zero.id]);
    expect(await ids({ services: [one.slug, two.slug] })).toEqual([one.id, two.id]);
    expect(await ids({ providers: [p1.abbreviation.toLowerCase()] })).toEqual([one.id, zero.id]);
    expect(await ids({ providers: [p1.abbreviation, p2.abbreviation] })).toEqual([
      one.id,
      zero.id,
      two.id,
    ]);
    expect(await ids({ providers: [p1.abbreviation], stage: ['DEV'] })).toEqual([]);
    expect(await ids({ stage: ['PROD', 'DEV'], license: ['MIT'] })).toEqual([zero.id, two.id]);
    expect(await ids({ providers: [p1.abbreviation], license: ['MIT'] })).toEqual([zero.id]);
    const page = await services.listV1(
      user,
      { providers: [p1.abbreviation] },
      { page: 0, pageSize: 1 },
    );
    expect(page.services).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it('is 422 for an abbreviation that names nothing, a stage or licence that names nothing, and the internal :none', async () => {
    const { services, user, zero, c1 } = await world();
    for (const filter of [
      { services: ['no-such-service'] },
      { services: [zero.slug, 'no-such-service'] },
      { providers: ['no-such-provider'] },
      { stage: ['NOPE'] },
      { license: ['NOT-A-LICENCE'] },
      { stage: [':none'] },
      { license: [':none'] },
    ]) {
      await expect(
        services.listV1(user, filter, PAGE),
        JSON.stringify(filter),
      ).rejects.toBeInstanceOf(Invalid);
    }
    // A consortium is no provider.
    await expect(
      services.listV1(user, { providers: [c1.abbreviation] }, PAGE),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('is denied to an anonymous caller and to a person without the permission, the plain read included', async () => {
    const { services, actor } = await world();
    await expect(services.listV1(anonymous, {}, PAGE)).rejects.toBeInstanceOf(Unauthorized);
    await expect(services.listV1(await actor(), {}, PAGE)).rejects.toBeInstanceOf(Forbidden);
    await expect(services.listV1(await actor('reviewer'), {}, PAGE)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});

describe('getV1', () => {
  it('returns the row with the description, the address and the links, a private service included, and never the contact point', async () => {
    const { services, pool, user, p1, c1 } = await world();
    const row = await makeService(pool, {
      slug: uniq('rec'),
      provider: p1.id,
      consortia: [c1.id],
      description: 'About',
      url: 'https://rec.example.org',
      sameAs: ['https://example.org/rec'],
      contactEmail: 'secret@example.org',
      contactType: 'support',
      iconBlobId: '018f3b7e-6666-7000-8000-000000000006',
      iconHash: 'e'.repeat(64),
      values: { category: ['x'] },
    });
    const record = await services.getV1(user, row.id);
    expect(record).toMatchObject({
      id: row.id,
      abbreviation: row.slug,
      public: false,
      description: 'About',
      url: 'https://rec.example.org',
      sameAs: ['https://example.org/rec'],
      provider: p1.abbreviation,
      consortia: [c1.abbreviation],
    });
    expect(Object.keys(record).sort()).toEqual(
      [
        'abbreviation',
        'category',
        'consortia',
        'consortiaIds',
        'description',
        'id',
        'license',
        'name',
        'provider',
        'providerId',
        'public',
        'sameAs',
        'stage',
        'url',
      ].sort(),
    );
    expect(JSON.stringify(record)).not.toMatch(/secret@|support|iconUrl|values|\["x"\]/);
  });

  it('is NotFound for an unknown id, Invalid for one that is no UUID, and denied without the permission', async () => {
    const { services, user, zero, actor } = await world();
    await expect(services.getV1(user, ABSENT)).rejects.toBeInstanceOf(NotFound);
    await expect(services.getV1(user, 'not-a-uuid')).rejects.toBeInstanceOf(Invalid);
    await expect(services.getV1(anonymous, zero.id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(services.getV1(await actor(), zero.id)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('schemaOrgV1', () => {
  it('is the profile of the internal route, without the contact point, for a private service too', async () => {
    const { services, pool, user, p1, c1 } = await world();
    const row = await makeService(pool, {
      slug: uniq('so'),
      provider: p1.id,
      consortia: [c1.id],
      description: 'About',
      url: 'https://so.example.org',
      contactEmail: 'secret@example.org',
      contactType: 'support',
    });
    const profile = await services.schemaOrgV1(user, row.id);
    expect(profile).toEqual(await services.schemaOrg(user, row.id));
    expect(profile).toMatchObject({ '@type': 'Service', alternateName: row.slug });
    expect(JSON.stringify(profile)).not.toMatch(/secret@|support|contactPoint/);
  });

  it('is NotFound, Invalid and denied like the other reads', async () => {
    const { services, user, zero, actor } = await world();
    await expect(services.schemaOrgV1(user, ABSENT)).rejects.toBeInstanceOf(NotFound);
    await expect(services.schemaOrgV1(user, 'not-a-uuid')).rejects.toBeInstanceOf(Invalid);
    await expect(services.schemaOrgV1(anonymous, zero.id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(services.schemaOrgV1(await actor('reviewer'), zero.id)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});
