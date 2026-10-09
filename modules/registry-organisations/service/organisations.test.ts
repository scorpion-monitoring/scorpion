// Every method of the organisation service against real Postgres: the real authoriser decides, events
// travel through the real outbox. Each method has a denied case; each write has a rollback case.
import { Forbidden, Invalid, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useOrganisations } from '../test/harness.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const PAGE = { page: 0, pageSize: 50 };

async function setup() {
  const s = await h.start();
  const admin = await s.actor('admin');
  const user = await s.actor('user');
  return { ...s, admin, user };
}

/** Makes the outbox refuse an insert, so the event of a write cannot be stored. */
async function breakOutbox(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_outbox() returns trigger as $$
    begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_outbox before insert on kernel_outbox
      for each row execute function test_break_outbox();`);
  return () => pool.query('drop trigger test_break_outbox on kernel_outbox');
}

type Pool = Awaited<ReturnType<typeof setup>>['pool'];
const count = async (pool: Pool) =>
  (await pool.query<{ n: number }>('select count(*)::int as n from org_organisation')).rows[0]!.n;
const one = async <T extends object>(pool: Pool, text: string, id: string) =>
  (await pool.query<T>(text, [id])).rows[0]!;

describe('list', () => {
  it('lets a plain user read, sorted by abbreviation and then id, with the envelope numbers', async () => {
    const { organisations, pool, user } = await setup();
    await makeOrganisation(pool, { abbreviation: 'beta', name: 'B' });
    await makeOrganisation(pool, { abbreviation: 'Alpha', name: 'A' });
    await makeOrganisation(pool, { abbreviation: 'Gamma', name: 'G' });
    const { organisations: rows, total } = await organisations.list(user, {}, PAGE);
    expect(rows.map((r) => r.abbreviation)).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(total).toBe(3);
    const page2 = await organisations.list(user, {}, { page: 1, pageSize: 2 });
    expect(page2.organisations.map((r) => r.abbreviation)).toEqual(['Gamma']);
    expect(page2.total).toBe(3);
  });

  it('never carries the contact point, the links or the audit columns in a row', async () => {
    const { organisations, pool, admin } = await setup();
    await makeOrganisation(pool, {
      contactEmail: 'info@example.org',
      contactType: 'support',
      sameAs: ['https://a.org'],
      rorId: '02skbsp27',
    });
    const { organisations: rows } = await organisations.list(admin, {}, PAGE);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ['abbreviation', 'id', 'memberCount', 'name', 'type', 'typeKnown'].sort(),
    );
  });

  it('filters by type and searches abbreviation and name without case, treating % _ and \\ as text', async () => {
    const { organisations, pool, user } = await setup();
    await makeOrganisation(pool, { type: 'provider', abbreviation: 'IPK', name: 'Plant Genetics' });
    await makeOrganisation(pool, { type: 'consortium', abbreviation: 'NFDI', name: 'Data' });
    await makeOrganisation(pool, { type: 'provider', abbreviation: 'P100', name: '100% sure' });
    await makeOrganisation(pool, { type: 'provider', abbreviation: 'Pxxx', name: 'a_b' });
    await makeOrganisation(pool, { type: 'provider', abbreviation: 'Pyyy', name: 'back\\slash' });
    const find = async (filter: { q?: string; type?: string }) =>
      (await organisations.list(user, filter, PAGE)).organisations.map((r) => r.abbreviation);
    expect(await find({ type: 'consortium' })).toEqual(['NFDI']);
    expect(await find({ q: 'ipk' })).toEqual(['IPK']);
    expect(await find({ q: 'GENETICS' })).toEqual(['IPK']);
    expect(await find({ q: '%' })).toEqual(['P100']);
    expect(await find({ q: '_' })).toEqual(['Pxxx']);
    expect(await find({ q: '\\' })).toEqual(['Pyyy']);
    expect(await find({ q: 'a_b' })).toEqual(['Pxxx']);
    expect(await find({ q: 'nothing', type: 'provider' })).toEqual([]);
    expect(await find({ q: '  ipk ' })).toEqual(['IPK']);
  });

  it('is denied to an anonymous caller and to a signed-in person without the permission', async () => {
    const { organisations, actor } = await setup();
    await expect(organisations.list(anonymous, {}, PAGE)).rejects.toBeInstanceOf(Unauthorized);
    const nobody = await actor(); // no role at all
    await expect(organisations.list(nobody, {}, PAGE)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('get', () => {
  it('shows a plain user the descriptive fields and the contact point (setting on) but not the audit columns', async () => {
    const { organisations, pool, user } = await setup();
    const row = await makeOrganisation(pool, {
      description: 'text',
      website: 'https://example.org',
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
      contactEmail: 'info@example.org',
      contactType: 'support',
    });
    const got = await organisations.get(user, row.id);
    expect(got).toMatchObject({
      id: row.id,
      description: 'text',
      website: 'https://example.org',
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
      typeKnown: true,
      memberCount: 0,
    });
    expect(got).toMatchObject({ contactEmail: 'info@example.org', contactType: 'support' });
    for (const hidden of ['createdBy', 'updatedBy', 'logoUrl']) {
      expect(got).not.toHaveProperty(hidden);
    }
  });

  it('shows an administrator the contact point and the audit columns', async () => {
    const { organisations, pool, admin } = await setup();
    const row = await makeOrganisation(pool, {
      contactEmail: 'info@example.org',
      contactType: 'support',
      createdBy: admin.userId,
    });
    expect(await organisations.get(admin, row.id)).toMatchObject({
      contactEmail: 'info@example.org',
      contactType: 'support',
      createdBy: admin.userId,
    });
  });

  it('answers 404 for an unknown id and 422 for an id that is no UUID; denies an anonymous caller', async () => {
    const { organisations, user, pool } = await setup();
    const row = await makeOrganisation(pool);
    await expect(
      organisations.get(user, '018f3b7e-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(organisations.get(user, 'not-a-uuid')).rejects.toBeInstanceOf(Invalid);
    await expect(organisations.get(anonymous, row.id)).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe('create', () => {
  it('stores a normalised organisation, sets who made it, and emits one event without text', async () => {
    const { organisations, admin, pool, events } = await setup();
    const created = await organisations.create(admin, {
      type: 'provider',
      abbreviation: ' IPK ',
      name: '  Leibniz   Institute  ',
      description: ' Plant research ',
      website: 'https://example.org/',
      rorId: 'https://ror.org/02skbsp27',
      sameAs: ['https://a.org/', 'https://a.org'],
      contactEmail: 'Info@Example.ORG',
      contactType: 'customer support',
    });
    expect(created).toMatchObject({
      type: 'provider',
      abbreviation: 'IPK',
      name: 'Leibniz Institute',
      description: 'Plant research',
      website: 'https://example.org',
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
      contactEmail: 'Info@example.org',
      contactType: 'customer support',
      createdBy: admin.userId,
      updatedBy: admin.userId,
    });
    const stored = await pool.query('select * from org_organisation where id = $1', [created.id]);
    expect(stored.rows).toHaveLength(1);
    expect(await events()).toEqual([
      {
        name: 'registry.organisation.created@1',
        payload: { organisationId: created.id, type: 'provider', actorId: admin.userId },
      },
    ]);
  });

  it('is denied to a plain user and to an anonymous caller, and stores nothing', async () => {
    const { organisations, user, pool, events } = await setup();
    const input = { type: 'provider', abbreviation: 'X', name: 'X' };
    await expect(organisations.create(user, input)).rejects.toBeInstanceOf(Forbidden);
    await expect(organisations.create(anonymous, input)).rejects.toBeInstanceOf(Unauthorized);
    expect(await count(pool)).toBe(0);
    expect(await events()).toEqual([]);
  });

  it('refuses a duplicate abbreviation, name or ROR id with a 409 that names the field', async () => {
    const { organisations, admin } = await setup();
    await organisations.create(admin, {
      type: 'provider',
      abbreviation: 'IPK',
      name: 'Leibniz',
      rorId: '02skbsp27',
    });
    const fieldOf = async (input: Record<string, unknown>) => {
      const error = await organisations
        .create(admin, { type: 'provider', abbreviation: 'Z', name: 'Z', ...input })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 409 });
      return (error as { errors: { path: string }[] }).errors[0]!.path;
    };
    expect(await fieldOf({ abbreviation: 'ipk' })).toBe('abbreviation');
    expect(await fieldOf({ name: 'LEIBNIZ' })).toBe('name');
    expect(await fieldOf({ rorId: '02skbsp27' })).toBe('rorId');
    // The same abbreviation under another type is a different organisation.
    await expect(
      organisations.create(admin, { type: 'consortium', abbreviation: 'IPK', name: 'Leibniz' }),
    ).resolves.toMatchObject({ type: 'consortium' });
  });

  it.each([
    ['an unknown type', { type: 'nope' }, 'type'],
    ['a javascript: website', { website: 'javascript:alert(1)' }, 'website'],
    [
      'a 21st link',
      { sameAs: Array.from({ length: 21 }, (_, i) => `https://e${i}.org`) },
      'sameAs',
    ],
    ['a ROR id with a forbidden letter', { rorId: '02skbsu27' }, 'rorId'],
    ['an address without a type', { contactEmail: 'info@example.org' }, 'contactEmail'],
    ['a name with a control character', { name: 'a\u0000b' }, 'name'],
  ])('answers 422 for %s, naming the field, and stores nothing', async (_label, patch, path) => {
    const { organisations, admin, pool } = await setup();
    const error = await organisations
      .create(admin, { type: 'provider', abbreviation: 'A', name: 'A', ...patch })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    expect((error as Invalid).errors?.map((e) => e.path)).toContain(path);
    expect(await count(pool)).toBe(0);
  });

  it('rolls back the row when the event cannot be stored', async () => {
    const { organisations, admin, pool } = await setup();
    const restore = await breakOutbox(pool);
    await expect(
      organisations.create(admin, { type: 'provider', abbreviation: 'A', name: 'A' }),
    ).rejects.toThrow();
    await restore();
    expect(await count(pool)).toBe(0);
  });
});

describe('update', () => {
  it('changes only what the body names, clears with null, and emits the names of the changed fields', async () => {
    const { organisations, admin, pool, events } = await setup();
    const row = await makeOrganisation(pool, {
      description: 'old',
      website: 'https://old.org',
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
      contactEmail: 'old@example.org',
      contactType: 'support',
    });
    const updated = await organisations.update(admin, row.id, {
      description: null,
      website: 'https://new.org/',
      rorId: null,
      sameAs: [],
      contactEmail: 'new@example.org',
      contactType: 'press',
      name: 'Renamed',
    });
    expect(updated).toMatchObject({
      abbreviation: row.abbreviation,
      name: 'Renamed',
      description: null,
      website: 'https://new.org',
      rorId: null,
      sameAs: [],
      contactEmail: 'new@example.org',
      contactType: 'press',
      updatedBy: admin.userId,
    });
    const [event] = await events();
    expect(event!.name).toBe('registry.organisation.updated@1');
    const payload = event!.payload as { fields: string[]; by: string };
    expect([...payload.fields].sort()).toEqual(
      ['contact', 'description', 'name', 'rorId', 'sameAs', 'website'].sort(),
    );
    expect(payload.by).toBe('admin');
    // Names and ids only: no text, address or URL.
    const text = JSON.stringify(event!.payload);
    for (const secret of ['new.org', 'new@example.org', 'Renamed', 'press']) {
      expect(text).not.toContain(secret);
    }
  });

  it('changes nothing, writes nothing and emits nothing when the values are the same', async () => {
    const { organisations, admin, pool, events } = await setup();
    const row = await makeOrganisation(pool, { description: 'same', website: 'https://same.org' });
    const before = await one<{ updated_at: Date }>(
      pool,
      'select updated_at from org_organisation where id=$1',
      row.id,
    );
    await organisations.update(admin, row.id, {
      description: 'same',
      website: 'https://same.org/',
    });
    const after = await one<{ updated_at: Date }>(
      pool,
      'select updated_at from org_organisation where id=$1',
      row.id,
    );
    expect(after.updated_at).toEqual(before.updated_at);
    expect(await events()).toEqual([]);
  });

  it('is denied to a plain user and to an anonymous caller, before the id is looked at', async () => {
    const { organisations, user, pool } = await setup();
    const row = await makeOrganisation(pool, { description: 'keep' });
    await expect(organisations.update(user, row.id, { description: 'x' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(organisations.update(user, row.id, { name: 'x' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(
      organisations.update(user, '018f3b7e-0000-7000-8000-000000000000', { name: 'x' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(organisations.update(anonymous, row.id, { name: 'x' })).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(
      (
        await one<{ description: string }>(
          pool,
          'select description from org_organisation where id=$1',
          row.id,
        )
      ).description,
    ).toBe('keep');
  });

  it('answers 404, 422 and 409 where they belong', async () => {
    const { organisations, admin, pool } = await setup();
    const a = await makeOrganisation(pool, {
      abbreviation: 'A',
      name: 'Name A',
      rorId: '02skbsp27',
    });
    const b = await makeOrganisation(pool, { abbreviation: 'B', name: 'Name B' });
    await expect(
      organisations.update(admin, '018f3b7e-0000-7000-8000-000000000000', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(organisations.update(admin, 'nope', { name: 'x' })).rejects.toBeInstanceOf(
      Invalid,
    );
    await expect(organisations.update(admin, a.id, {})).rejects.toBeInstanceOf(Invalid);
    await expect(
      organisations.update(admin, a.id, { colour: 'red' } as never),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(organisations.update(admin, a.id, { type: 'nope' })).rejects.toBeInstanceOf(
      Invalid,
    );
    await expect(organisations.update(admin, b.id, { abbreviation: 'a' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(organisations.update(admin, b.id, { name: 'name a' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(organisations.update(admin, b.id, { rorId: '02skbsp27' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      organisations.update(admin, a.id, { website: 'ftp://x.org' }),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('changes the type while nothing counts a reference', async () => {
    const { organisations, admin, pool } = await setup();
    const row = await makeOrganisation(pool, { type: 'provider' });
    await expect(
      organisations.update(admin, row.id, { type: 'consortium' }),
    ).resolves.toMatchObject({
      type: 'consortium',
    });
  });

  it('rolls back the change when the event cannot be stored', async () => {
    const { organisations, admin, pool } = await setup();
    const row = await makeOrganisation(pool, { description: 'before' });
    const restore = await breakOutbox(pool);
    await expect(organisations.update(admin, row.id, { description: 'after' })).rejects.toThrow();
    await restore();
    expect(
      (
        await one<{ description: string }>(
          pool,
          'select description from org_organisation where id=$1',
          row.id,
        )
      ).description,
    ).toBe('before');
  });

  it('serialises two changes of the same row: both apply, the last one wins, no lost row', async () => {
    const { organisations, admin, pool } = await setup();
    const row = await makeOrganisation(pool);
    await Promise.all([
      organisations.update(admin, row.id, { description: 'one' }),
      organisations.update(admin, row.id, { website: 'https://two.org' }),
    ]);
    expect(
      await one(pool, 'select description, website from org_organisation where id=$1', row.id),
    ).toEqual({ description: 'one', website: 'https://two.org' });
  });
});

describe('delete', () => {
  it('deletes by id only, leaves the others, and emits one event', async () => {
    const { organisations, admin, pool, events } = await setup();
    const doomed = await makeOrganisation(pool, {
      abbreviation: 'DEL',
      name: 'Same name',
      type: 'provider',
    });
    const sameName = await makeOrganisation(pool, {
      abbreviation: 'KEEP',
      name: 'Same name',
      type: 'consortium',
    });
    await organisations.delete(admin, doomed.id);
    const { rows } = await pool.query<{ id: string }>('select id from org_organisation');
    expect(rows.map((r) => r.id)).toEqual([sameName.id]);
    expect(await events()).toEqual([
      {
        name: 'registry.organisation.deleted@1',
        payload: { organisationId: doomed.id, type: 'provider', actorId: admin.userId },
      },
    ]);
  });

  it('is denied to a plain user and to an anonymous caller', async () => {
    const { organisations, user, pool } = await setup();
    const row = await makeOrganisation(pool);
    await expect(organisations.delete(user, row.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(organisations.delete(anonymous, row.id)).rejects.toBeInstanceOf(Unauthorized);
    expect(await count(pool)).toBe(1);
  });

  it('answers 404 for an unknown id (twice: the second delete finds nothing) and 422 for a bad id', async () => {
    const { organisations, admin, pool } = await setup();
    const row = await makeOrganisation(pool);
    await organisations.delete(admin, row.id);
    await expect(organisations.delete(admin, row.id)).rejects.toBeInstanceOf(NotFound);
    await expect(organisations.delete(admin, 'nope')).rejects.toBeInstanceOf(Invalid);
  });

  it('keeps the row when the event cannot be stored', async () => {
    const { organisations, admin, pool } = await setup();
    const row = await makeOrganisation(pool);
    const restore = await breakOutbox(pool);
    await expect(organisations.delete(admin, row.id)).rejects.toThrow();
    await restore();
    expect(await count(pool)).toBe(1);
  });
});

describe('listTypes', () => {
  it('lists the seeded types in order with the label of the locale, to every signed-in person', async () => {
    const { organisations, user } = await setup();
    const en = await organisations.listTypes(user);
    expect(en.map((t) => [t.id, t.label, t.membership, t.schemaType])).toEqual([
      ['provider', 'Provider', true, 'Organization'],
      ['consortium', 'Consortium', true, 'Organization'],
    ]);
    expect((await organisations.listTypes(user, 'de')).map((t) => t.label)).toEqual([
      'Anbieter',
      'Konsortium',
    ]);
    // A locale the entry has no label for falls back to English.
    expect((await organisations.listTypes(user, 'fr')).map((t) => t.label)).toEqual([
      'Provider',
      'Consortium',
    ]);
  });

  it('is denied to an anonymous caller', async () => {
    const { organisations } = await setup();
    await expect(organisations.listTypes(anonymous)).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe('the table', () => {
  it('refuses at the database what the service refuses, so a second entry point cannot bypass it', async () => {
    const { pool } = await setup();
    const bad = async (patch: Record<string, unknown>) =>
      makeOrganisation(pool, patch as never).then(
        () => 'accepted',
        (error: { constraint?: string }) => error.constraint ?? 'error',
      );
    expect(await bad({ abbreviation: 'a b' })).toBe('org_organisation_abbreviation_check');
    expect(await bad({ abbreviation: 'a/b' })).toBe('org_organisation_abbreviation_check');
    expect(await bad({ website: 'javascript:alert(1)' })).toBe('org_organisation_website_check');
    expect(await bad({ rorId: 'XXXXXXXXX' })).toBe('org_organisation_ror_id_check');
    expect(await bad({ contactEmail: 'a@b.org' })).toBe('org_organisation_contact_check');
    expect(await bad({ sameAs: Array.from({ length: 21 }, (_, i) => `https://e${i}.org`) })).toBe(
      'org_organisation_same_as_check',
    );
    expect(await bad({ logoHash: 'abc' })).toBe('org_organisation_logo_check');
    expect(await bad({})).toBe('accepted');
  });

  it('has no foreign key and no enum: user ids and the logo are plain columns', async () => {
    const { pool } = await setup();
    const fk = await pool.query(
      "select 1 from pg_constraint where conrelid = 'org_organisation'::regclass and contype = 'f'",
    );
    expect(fk.rowCount).toBe(0);
  });

  it('did not leave an event behind for a refusal', async () => {
    const { organisations, user, events } = await setup();
    await organisations
      .create(user, { type: 'provider', abbreviation: 'X', name: 'X' })
      .catch(() => undefined);
    expect(await events()).toEqual([]);
  });
});

describe('the contributed permissions', () => {
  it('gives the role user read and keeps manage with Admin; the role reviewer reads too but cannot manage', async () => {
    const { authz, user, admin, actor } = await setup();
    const reviewer = await actor('reviewer');
    expect(await authz.can(user, 'registry.organisations.organisation.read')).toBe(true);
    expect(await authz.can(reviewer, 'registry.organisations.organisation.read')).toBe(true);
    expect(await authz.can(user, 'registry.organisations.organisation.manage')).toBe(false);
    expect(await authz.can(reviewer, 'registry.organisations.organisation.manage')).toBe(false);
    expect(await authz.can(admin, 'registry.organisations.organisation.manage')).toBe(true);
  });
});
