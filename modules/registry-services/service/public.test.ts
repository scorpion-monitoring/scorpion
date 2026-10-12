// The anonymous reads of a service (ADR-0036 part 2), over real Postgres: a record is public only while the flag
// is set and the instance allows public reads, by id, slug or an old slug; every other case answers `undefined`
// alike (the route turns it into one 404); the public record is a pinned list of fields; the flag is read in the
// same statement as the record, so a publication racing a read gives a whole record or nothing; and an
// organisation is public exactly while a public service names it as provider or consortium.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import { world } from '../test/world.ts';

const h = useServices();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

const PUBLIC_SERVICE_FIELDS = [
  'consortia',
  'description',
  'id',
  'license',
  'name',
  'provider',
  'sameAs',
  'slug',
  'stage',
  'url',
];

async function publicWorld(options?: Parameters<typeof world>[1]) {
  const w = await world(h, options);
  await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
  return w;
}

describe('getPublicAsSystem', () => {
  it('reads a public service by id, by slug without regard to case, and by an old slug [ASVS-8.2.1]', async () => {
    const w = await publicWorld();
    await w.services.update(w.people.manager, w.svc.id, { slug: 'renamed-public' });
    for (const ref of [w.svc.id, 'renamed-public', 'RENAMED-PUBLIC', w.svc.slug, ` ${w.svc.id} `]) {
      expect(await w.services.getPublicAsSystem(ref), ref).toMatchObject({
        id: w.svc.id,
        slug: 'renamed-public',
      });
    }
  });

  it.each([
    ['a private service', async (w: Awaited<ReturnType<typeof world>>) => w.svc.id],
    ['an unknown id', async () => ABSENT],
    ['an unknown slug', async () => 'nobody-has-this'],
    ['a ref that is neither', async () => '../../etc/passwd'],
    ['an empty ref', async () => ''],
    ['a ref that is too long', async () => 'x'.repeat(201)],
  ])(
    'answers %s with undefined, with nothing to tell it from another [ASVS-8.2.1]',
    async (_n, ref) => {
      const w = await world(h);
      expect(await w.services.getPublicAsSystem(await ref(w))).toBeUndefined();
      expect(await w.services.schemaOrgPublicAsSystem(await ref(w))).toBeUndefined();
    },
  );

  it('stops answering at once when the service is unpublished, and again when it is republished', async () => {
    const w = await publicWorld();
    expect(await w.services.getPublicAsSystem(w.svc.id)).toBeDefined();
    await w.services.setPublication(w.people.admin, w.svc.id, { public: false });
    expect(await w.services.getPublicAsSystem(w.svc.id)).toBeUndefined();
    expect(await w.services.getPublicAsSystem(w.svc.slug)).toBeUndefined();
    await w.services.setPublication(w.people.admin, w.svc.id, { public: true });
    expect(await w.services.getPublicAsSystem(w.svc.id)).toBeDefined();
  });

  it('answers nothing while public reads are switched off, even for a service that is public', async () => {
    const w = await publicWorld();
    await w.configure({ exposeContactPoint: true, allowPublic: false });
    expect(await w.services.getPublicAsSystem(w.svc.id)).toBeUndefined();
    expect(await w.services.getPublicAsSystem(w.svc.slug)).toBeUndefined();
    expect(await w.services.schemaOrgPublicAsSystem(w.svc.id)).toBeUndefined();
    expect(await w.services.listPublicByOrganisationAsSystem(w.provider.id)).toEqual([]);
    await w.configure({ exposeContactPoint: true, allowPublic: true });
    expect(await w.services.getPublicAsSystem(w.svc.id)).toBeDefined();
  });

  it('is a pinned list of fields: no contact point, no member, no audit column, no published_*, no values [ASVS-8.2.3]', async () => {
    const w = await publicWorld();
    await w.pool.query(
      "update svc_service set contact_email = 'team-secret@example.org', contact_type = 'support', description = 'About', url = 'https://x.example', icon_blob_id = $2, icon_hash = $3 where id = $1",
      [w.svc.id, '018f3b7e-3333-7000-8000-000000000003', 'c'.repeat(64)],
    );
    const record = (await w.services.getPublicAsSystem(w.svc.id))!;
    expect(Object.keys(record).sort()).toEqual([...PUBLIC_SERVICE_FIELDS, 'logoUrl'].sort());
    expect(record.logoUrl).toBe(`/api/internal/files/${'c'.repeat(64)}`);
    expect(JSON.stringify(record)).not.toMatch(/team-secret|support|published|createdBy|updatedBy/);
  });

  it('leaves logoUrl out without an icon', async () => {
    const w = await publicWorld();
    expect(Object.keys((await w.services.getPublicAsSystem(w.svc.id))!).sort()).toEqual(
      PUBLIC_SERVICE_FIELDS,
    );
  });

  it('names the provider and the consortia as { id, name, public }, consortia by name', async () => {
    const w = await publicWorld();
    const a = await makeOrganisation(w.pool, { type: 'consortium', name: 'Alpha consortium' });
    const z = await makeOrganisation(w.pool, { type: 'consortium', name: 'Zeta consortium' });
    await w.services.update(w.people.member, w.svc.id, {
      consortia: [z.id, a.id, w.consortium.id],
    });
    const record = (await w.services.getPublicAsSystem(w.svc.id))!;
    expect(record.provider).toEqual({ id: w.provider.id, name: expect.any(String), public: true });
    expect(record.consortia.map((c) => c.name)).toEqual(
      [...record.consortia.map((c) => c.name)].sort((x, y) => x.localeCompare(y)),
    );
    expect(record.consortia.map((c) => c.id).sort()).toEqual([a.id, z.id, w.consortium.id].sort());
    expect(record.consortia.every((c) => c.public === true)).toBe(true);
  });

  it('shows the stage as the service’s own term', async () => {
    const w = await publicWorld();
    expect((await w.services.getPublicAsSystem(w.svc.id))!.stage).toBe((await w.row()).stage);
  });
});

describe('getPublicAsSystem racing a publication', () => {
  it('gives a whole record or nothing while a service is switched back and forth, never a partial one [ASVS-8.2.1]', async () => {
    const w = await world(h);
    const reads: (Awaited<ReturnType<typeof w.services.getPublicAsSystem>> | 'gone')[] = [];
    const read = async () => {
      const record = await w.services.getPublicAsSystem(w.svc.id);
      reads.push(record ?? 'gone');
    };
    for (let round = 0; round < 6; round++) {
      await Promise.all([
        w.services.setPublication(w.people.reviewer, w.svc.id, { public: round % 2 === 0 }),
        ...Array.from({ length: 12 }, read),
      ]);
    }
    expect(reads.length).toBe(72);
    for (const record of reads) {
      if (record === 'gone') continue;
      expect(record.id).toBe(w.svc.id);
      expect(record.provider.id).toBe(w.provider.id);
      expect(record.consortia.map((c) => c.id)).toEqual([w.consortium.id]);
    }
  });

  it('answers a service that is made public after a read from then on, and not before', async () => {
    const w = await world(h);
    expect(await w.services.getPublicAsSystem(w.svc.id)).toBeUndefined();
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    expect(await w.services.getPublicAsSystem(w.svc.id)).toBeDefined();
  });
});

describe('listPublicByOrganisationAsSystem', () => {
  it('lists the public services of a provider and of a consortium, by name, and no private one', async () => {
    const w = await publicWorld();
    const second = await makeService(w.pool, {
      provider: w.provider.id,
      consortia: [w.consortium.id],
      name: 'AAA first by name',
      public: true,
    });
    const hidden = await makeService(w.pool, {
      provider: w.provider.id,
      consortia: [w.consortium.id],
    });
    for (const id of [w.provider.id, w.consortium.id]) {
      const list = await w.services.listPublicByOrganisationAsSystem(id);
      expect(list.map((s) => s.id)).toEqual([second.id, w.svc.id]);
      expect(list.map((s) => s.id)).not.toContain(hidden.id);
      expect(Object.keys(list[0]!).sort()).toEqual(['id', 'name', 'slug']);
    }
  });

  it('is empty for an organisation of private services only, an unknown one and a bad id', async () => {
    const w = await world(h);
    expect(await w.services.listPublicByOrganisationAsSystem(w.provider.id)).toEqual([]);
    expect(await w.services.listPublicByOrganisationAsSystem(ABSENT)).toEqual([]);
    expect(await w.services.listPublicByOrganisationAsSystem('nope')).toEqual([]);
  });

  it('lists a service once for an organisation that holds two roles on it', async () => {
    const w = await publicWorld();
    await w.pool.query(
      "insert into svc_service_organisation (id, service_id, organisation_id, role) values ($1, $2, $3, 'consortium')",
      ['018f3b7e-4444-7000-8000-000000000004', w.svc.id, w.provider.id],
    );
    expect(await w.services.listPublicByOrganisationAsSystem(w.provider.id)).toHaveLength(1);
  });
});

describe('the public profile of an organisation (the registry org.publicReference)', () => {
  const orgs = (w: Awaited<ReturnType<typeof world>>) =>
    w.kernel.services.get('registry.organisations') as {
      getPublicAsSystem: (id: string) => Promise<Record<string, unknown> | undefined>;
      schemaOrgPublicAsSystem: (id: string) => Promise<Record<string, unknown> | undefined>;
    };

  it('exists for the provider and a consortium of a public service, with the services as { id, slug, name } [ASVS-8.2.1]', async () => {
    const w = await publicWorld();
    for (const id of [w.provider.id, w.consortium.id]) {
      const record = (await orgs(w).getPublicAsSystem(id))!;
      expect(record).toMatchObject({
        id,
        services: [{ id: w.svc.id, slug: w.svc.slug, name: w.svc.name }],
      });
      expect(await orgs(w).schemaOrgPublicAsSystem(id)).toMatchObject({ '@type': 'Organization' });
    }
  });

  it('is a pinned list of fields: no type, no contact point, no member count, no audit column [ASVS-8.2.3]', async () => {
    const w = await publicWorld();
    await w.pool.query(
      "update org_organisation set contact_email = 'org-secret@example.org', contact_type = 'support', description = 'D', website = 'https://o.example', logo_hash = $2, logo_blob_id = $3 where id = $1",
      [w.provider.id, 'd'.repeat(64), '018f3b7e-5555-7000-8000-000000000005'],
    );
    const record = (await orgs(w).getPublicAsSystem(w.provider.id))!;
    expect(Object.keys(record).sort()).toEqual(
      [
        'abbreviation',
        'description',
        'id',
        'logoUrl',
        'name',
        'rorId',
        'sameAs',
        'services',
        'website',
      ].sort(),
    );
    expect(JSON.stringify(record)).not.toMatch(/org-secret|support|memberCount|createdBy|"type"/);
    expect(JSON.stringify(await orgs(w).schemaOrgPublicAsSystem(w.provider.id))).not.toContain(
      'org-secret',
    );
  });

  it('does not exist for an organisation whose only link is to a private service, for an unknown one and for a bad id', async () => {
    const w = await world(h);
    const lonely = await makeOrganisation(w.pool, { type: 'provider' });
    await makeService(w.pool, { provider: lonely.id });
    for (const id of [w.provider.id, lonely.id, ABSENT, 'nope']) {
      expect(await orgs(w).getPublicAsSystem(id), id).toBeUndefined();
      expect(await orgs(w).schemaOrgPublicAsSystem(id), id).toBeUndefined();
    }
  });

  it('goes the moment its last public service is unpublished, and with public reads switched off', async () => {
    const w = await publicWorld();
    expect(await orgs(w).getPublicAsSystem(w.provider.id)).toBeDefined();
    await w.configure({ exposeContactPoint: true, allowPublic: false });
    expect(await orgs(w).getPublicAsSystem(w.provider.id)).toBeUndefined();
    await w.configure({ exposeContactPoint: true, allowPublic: true });
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: false });
    expect(await orgs(w).getPublicAsSystem(w.provider.id)).toBeUndefined();
    expect(await orgs(w).getPublicAsSystem(w.consortium.id)).toBeUndefined();
  });

  it('stays while another public service still names it', async () => {
    const w = await publicWorld();
    await makeService(w.pool, { provider: w.provider.id, public: true });
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: false });
    expect((await orgs(w).getPublicAsSystem(w.provider.id))!.services).toHaveLength(1);
    expect(await orgs(w).getPublicAsSystem(w.consortium.id)).toBeUndefined();
  });
});
