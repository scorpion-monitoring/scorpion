// The Schema.org profile, the contact point rule and the trusted reads, over real Postgres. The
// denied case of every method is here; the builder itself is in schema-org.test.ts.
import { Forbidden, Invalid, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useOrganisations } from '../test/harness.ts';
import { serializeJsonLd } from './schema-org.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const CONTACT = { contactEmail: 'info@org.example', contactType: 'support' };
const PROPERTIES = [
  '@context',
  '@type',
  '@id',
  'name',
  'alternateName',
  'description',
  'url',
  'identifier',
  'sameAs',
  'logo',
  'contactPoint',
];

async function setup(logLines?: string[]) {
  const s = await h.start(logLines ? { logLines } : {});
  const admin = await s.actor('admin');
  const user = await s.actor('user');
  return { ...s, admin, user };
}

describe('schemaOrg', () => {
  it('maps the organisation, with the schemaType of its type, and nothing outside the property list', async () => {
    const { organisations, pool, user } = await setup();
    const row = await makeOrganisation(pool, {
      abbreviation: 'IPK',
      name: 'Leibniz Institute',
      description: 'Plant genetics',
      website: 'https://ipk.example.org',
      rorId: '02skbsp27',
      sameAs: ['https://www.wikidata.org/wiki/Q1'],
    });
    const profile = await organisations.schemaOrg(user, row.id);
    expect(profile).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Leibniz Institute',
      alternateName: 'IPK',
      url: 'https://ipk.example.org',
      identifier: { propertyID: 'ROR', value: 'https://ror.org/02skbsp27' },
      sameAs: ['https://ror.org/02skbsp27', 'https://www.wikidata.org/wiki/Q1'],
    });
    expect(profile['@id']).toMatch(new RegExp(`/organisations/${row.id}$`));
    expect(Object.keys(profile).every((key) => PROPERTIES.includes(key))).toBe(true);
  });

  it('uses the origin and the base path of the instance, not a constant', async () => {
    const { organisations, pool, user, kernel } = await setup();
    const row = await makeOrganisation(pool);
    const profile = await organisations.schemaOrg(user, row.id);
    expect(profile['@id']).toBe(`${kernel.config.ORIGIN}/organisations/${row.id}`);
  });

  it('is denied to an anonymous caller and to a person without the read permission, and refuses a bad id', async () => {
    const { organisations, pool, actor, user } = await setup();
    const row = await makeOrganisation(pool);
    await expect(organisations.schemaOrg(anonymous, row.id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(organisations.schemaOrg(await actor(), row.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(organisations.schemaOrg(user, 'nope')).rejects.toBeInstanceOf(Invalid);
    await expect(
      organisations.schemaOrg(user, '018f3b7e-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('writes hostile text in a way that stays inside a script block', async () => {
    const { organisations, pool, user } = await setup();
    const row = await makeOrganisation(pool, {
      name: '</script><script>alert(1)</script><!--',
      description: 'a & b c',
    });
    const text = serializeJsonLd(await organisations.schemaOrg(user, row.id));
    expect(text).not.toContain('<');
    expect(JSON.parse(text).name).toBe('</script><script>alert(1)</script><!--');
  });
});

describe('who sees the contact point', () => {
  it.each([
    // [setting, who, sees it]
    [true, 'admin', true],
    [true, 'user', true],
    [false, 'admin', true],
    [false, 'user', false],
  ] as const)(
    'with exposeContactPoint=%s, %s sees it: %s (in get and in the profile alike)',
    async (setting, who, sees) => {
      const s = await setup();
      await s.configure({ exposeContactPoint: setting });
      const row = await makeOrganisation(s.pool, CONTACT);
      const reader = who === 'admin' ? s.admin : s.user;
      const got = await s.organisations.get(reader, row.id);
      const profile = await s.organisations.schemaOrg(reader, row.id);
      if (sees) {
        expect(got).toMatchObject(CONTACT);
        expect(profile.contactPoint).toEqual({
          '@type': 'ContactPoint',
          email: CONTACT.contactEmail,
          contactType: CONTACT.contactType,
        });
      } else {
        expect(got).not.toHaveProperty('contactEmail');
        expect(got).not.toHaveProperty('contactType');
        expect(profile).not.toHaveProperty('contactPoint');
        expect(JSON.stringify(profile)).not.toContain(CONTACT.contactEmail);
      }
    },
  );

  it('defaults to on, and follows a change of the setting at once', async () => {
    const s = await setup();
    const row = await makeOrganisation(s.pool, CONTACT);
    expect(await s.organisations.get(s.user, row.id)).toHaveProperty('contactEmail');
    await s.configure({ exposeContactPoint: false });
    expect(await s.organisations.get(s.user, row.id)).not.toHaveProperty('contactEmail');
    await s.configure({ exposeContactPoint: true });
    expect(await s.organisations.get(s.user, row.id)).toHaveProperty('contactEmail');
  });

  it('shows nothing for an organisation without a contact point, to anyone', async () => {
    const s = await setup();
    const row = await makeOrganisation(s.pool);
    expect(await s.organisations.get(s.user, row.id)).toMatchObject({
      contactEmail: null,
      contactType: null,
    });
    expect(await s.organisations.schemaOrg(s.user, row.id)).not.toHaveProperty('contactPoint');
  });

  it('declares the scoped permission read-contact, which Admin holds and a plain user does not', async () => {
    const { authz, admin, user, pool } = await setup();
    const row = await makeOrganisation(pool, CONTACT);
    const resource = { type: 'organisation', id: row.id };
    const permission = 'registry.organisations.organisation.read-contact';
    expect(await authz.can(admin, permission, resource)).toBe(true);
    expect(await authz.can(user, permission, resource)).toBe(false);
  });

  it('never puts the contact point in a list row, an event, or a log line', async () => {
    const logLines: string[] = [];
    const { organisations, admin, user, events, dispatch } = await setup(logLines);
    const created = await organisations.create(admin, {
      type: 'provider',
      abbreviation: 'C',
      name: 'C',
      ...CONTACT,
    });
    await organisations.update(admin, created.id, {
      contactEmail: 'new@org.example',
      contactType: 'press',
    });
    await dispatch();
    const rows = (await organisations.list(user, {}, { page: 0, pageSize: 10 })).organisations;
    expect(JSON.stringify(rows)).not.toMatch(/org\.example/);
    expect(JSON.stringify(await events())).not.toMatch(/org\.example/);
    expect(logLines.join('')).not.toMatch(/org\.example/);
  });

  it('never shows the address of a user in an organisation response', async () => {
    const { organisations, pool, admin, user, actor } = await setup();
    const another = await actor('admin', 'user');
    const row = await makeOrganisation(pool, { ...CONTACT, createdBy: another.userId });
    const { rows: users } = await pool.query<{ email: string }>(
      'select email from identity_user where email is not null',
    );
    expect(users.length).toBeGreaterThanOrEqual(3);
    const responses = [
      await organisations.get(user, row.id),
      await organisations.get(admin, row.id),
      await organisations.list(admin, {}, { page: 0, pageSize: 10 }),
      await organisations.schemaOrg(user, row.id),
      await organisations.schemaOrg(admin, row.id),
      await organisations.update(admin, row.id, { description: 'changed' }),
    ];
    const text = JSON.stringify(responses);
    for (const { email } of users) expect(text).not.toContain(email);
    // The username of a user is not there either: the audit columns carry ids only.
    expect(text).not.toContain(another.username);
  });
});

describe('the trusted reads (no permission check, no contact point)', () => {
  it('finds organisations by id, once each, ignoring unknown and malformed ids', async () => {
    const { organisations, pool } = await setup();
    const a = await makeOrganisation(pool, { abbreviation: 'A', name: 'A', ...CONTACT });
    const b = await makeOrganisation(pool, { abbreviation: 'B', name: 'B' });
    const found = await organisations.findByIdsAsSystem([
      b.id,
      a.id,
      a.id,
      'nope',
      '018f3b7e-0000-7000-8000-000000000000',
    ]);
    expect(found.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(await organisations.findByIdsAsSystem([])).toEqual([]);
    expect(Object.keys(found[0]!).sort()).toEqual(
      [
        'abbreviation',
        'description',
        'id',
        'memberCount',
        'name',
        'rorId',
        'sameAs',
        'type',
        'typeKnown',
        'website',
      ].sort(),
    );
    expect(JSON.stringify(found)).not.toContain(CONTACT.contactEmail);
  });

  it('finds by type and abbreviation without case, and only within the type', async () => {
    const { organisations, pool } = await setup();
    const row = await makeOrganisation(pool, { type: 'provider', abbreviation: 'IPK' });
    expect((await organisations.findByAbbreviationAsSystem('provider', 'ipk'))?.id).toBe(row.id);
    expect(await organisations.findByAbbreviationAsSystem('consortium', 'IPK')).toBeUndefined();
    expect(await organisations.findByAbbreviationAsSystem('provider', 'nope')).toBeUndefined();
    // % and _ are text, not patterns
    expect(await organisations.findByAbbreviationAsSystem('provider', '%')).toBeUndefined();
  });

  it('says whether an organisation exists, and lists the types', async () => {
    const { organisations, pool } = await setup();
    const row = await makeOrganisation(pool);
    expect(await organisations.existsAsSystem(row.id)).toBe(true);
    expect(await organisations.existsAsSystem('018f3b7e-0000-7000-8000-000000000000')).toBe(false);
    expect(await organisations.existsAsSystem('nope')).toBe(false);
    expect((await organisations.listTypesAsSystem()).map((t) => t.id)).toEqual([
      'provider',
      'consortium',
    ]);
  });

  it('builds the profile without the contact point unless asked, and answers undefined for an unknown id', async () => {
    const { organisations, pool } = await setup();
    const row = await makeOrganisation(pool, CONTACT);
    expect(await organisations.toSchemaOrgAsSystem(row.id)).not.toHaveProperty('contactPoint');
    expect(
      await organisations.toSchemaOrgAsSystem(row.id, { includeContact: false }),
    ).not.toHaveProperty('contactPoint');
    expect(
      (await organisations.toSchemaOrgAsSystem(row.id, { includeContact: true }))?.contactPoint,
    ).toMatchObject({ email: CONTACT.contactEmail });
    expect(
      await organisations.toSchemaOrgAsSystem('018f3b7e-0000-7000-8000-000000000000'),
    ).toBeUndefined();
    expect(await organisations.toSchemaOrgAsSystem('nope')).toBeUndefined();
  });
});
