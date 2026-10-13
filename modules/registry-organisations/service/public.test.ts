// The public profile of an organisation (ADR-0036 part 2) over real Postgres. This module knows nothing of the
// services: an organisation is public exactly when an entry of the registry `org.publicReference` lists a public
// record that names it. A fixture contributes the entry, as registry.services does.
import { makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { fixtureContributor, useOrganisations } from '../test/harness.ts';

const h = useOrganisations();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

type Reference = { id: string; slug: string; name: string };
/** An entry that lists what `refs` holds for an organisation; the test changes `refs` between calls. */
function entry(id: string, refs: Map<string, Reference[]>) {
  return { id, list: (organisationId: string) => Promise.resolve(refs.get(organisationId) ?? []) };
}

const PUBLIC_FIELDS = [
  'abbreviation',
  'description',
  'id',
  'logoUrl',
  'name',
  'rorId',
  'sameAs',
  'services',
  'website',
];

describe('getPublicAsSystem and schemaOrgPublicAsSystem', () => {
  it('answer only for an organisation that a public record names, and the record is a pinned list [ASVS-8.2.3]', async () => {
    const refs = new Map<string, Reference[]>();
    const s = await h.start({
      extra: [fixtureContributor({ publicReferences: [entry('fixture.refs', refs)] })],
    });
    const org = await makeOrganisation(s.pool, {
      description: 'About',
      website: 'https://o.example',
      rorId: '02skbsp27',
      sameAs: ['https://example.org/o'],
    });
    await s.pool.query(
      "update org_organisation set contact_email = 'secret@example.org', contact_type = 'support', logo_hash = $2, logo_blob_id = $3 where id = $1",
      [org.id, 'e'.repeat(64), '018f3b7e-6666-7000-8000-000000000006'],
    );

    expect(await s.organisations.getPublicAsSystem(org.id)).toBeUndefined();
    expect(await s.organisations.schemaOrgPublicAsSystem(org.id)).toBeUndefined();

    refs.set(org.id, [{ id: ABSENT, slug: 'svc', name: 'A service' }]);
    const record = (await s.organisations.getPublicAsSystem(org.id))!;
    expect(Object.keys(record).sort()).toEqual(PUBLIC_FIELDS);
    expect(record).toMatchObject({
      id: org.id,
      rorId: '02skbsp27',
      logoUrl: `/api/internal/files/${'e'.repeat(64)}`,
      services: [{ id: ABSENT, slug: 'svc', name: 'A service' }],
    });
    expect(JSON.stringify(record)).not.toMatch(/secret@|support|memberCount|createdBy|"type"/);
    const profile = (await s.organisations.schemaOrgPublicAsSystem(org.id))!;
    expect(JSON.stringify(profile)).not.toMatch(/secret@|contactPoint/);

    refs.delete(org.id); // the record is unpublished: the organisation goes with it
    expect(await s.organisations.getPublicAsSystem(org.id)).toBeUndefined();
  });

  it('answer undefined for an unknown organisation and for an id that is no UUID, even when an entry lists something', async () => {
    const everything = {
      id: 'fixture.all',
      list: () => Promise.resolve([{ id: 'x', slug: 'y', name: 'z' }]),
    };
    const s = await h.start({ extra: [fixtureContributor({ publicReferences: [everything] })] });
    expect(await s.organisations.getPublicAsSystem(ABSENT)).toBeUndefined();
    expect(await s.organisations.getPublicAsSystem('nope')).toBeUndefined();
    expect(await s.organisations.schemaOrgPublicAsSystem(ABSENT)).toBeUndefined();
    expect(await s.organisations.schemaOrgPublicAsSystem('nope')).toBeUndefined();
  });

  it('are always undefined without a contributing module: nothing is public by itself', async () => {
    const s = await h.start();
    const org = await makeOrganisation(s.pool);
    expect(await s.organisations.getPublicAsSystem(org.id)).toBeUndefined();
  });

  it('merge the lists of several contributors, by name then id', async () => {
    const org = { id: '' };
    const a = {
      id: 'fixture.a',
      list: () => Promise.resolve([{ id: '2', slug: 'b', name: 'Beta' }]),
    };
    const b = {
      id: 'fixture.b',
      list: () =>
        Promise.resolve([
          { id: '1', slug: 'a', name: 'Alpha' },
          { id: '3', slug: 'b2', name: 'Beta' },
        ]),
    };
    const s = await h.start({
      extra: [
        fixtureContributor({ id: 'fixture.one', publicReferences: [a] }),
        fixtureContributor({ id: 'fixture.two', publicReferences: [b] }),
      ],
    });
    org.id = (await makeOrganisation(s.pool)).id;
    expect((await s.organisations.getPublicAsSystem(org.id))!.services.map((x) => x.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});

describe('a contribution to org.publicReference that is wrong fails at start', () => {
  it.each([
    ['without a list function', { id: 'fixture.refs', list: 'nope' }],
    ['without an id', { list: () => Promise.resolve([]) }],
    ['with an unknown field', { id: 'fixture.refs', list: () => Promise.resolve([]), extra: 1 }],
  ])('refuses an entry %s', async (_label, bad) => {
    await expect(
      h.build({ extra: [fixtureContributor({ publicReferences: [bad] })] }),
    ).rejects.toThrow();
  });
});
