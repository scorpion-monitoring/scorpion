// The two editor groups on one record (plan §8 sprint 4, Decision 14), over real Postgres and the real
// authoriser: an Admin writes every field, creates and deletes; the managers of that organisation write the
// descriptive fields and the logo and nothing else; nobody else writes anything. `update`, `setLogo` and
// `clearLogo` carry the plain `…organisation.read` at the route (ADR-0034), so these methods ARE the
// authorization: every case here calls the service, not the pipeline. The cases that go through the
// pipeline are in apps/server (organisation-editing-routes.test.ts, defect-01.organisation-editing.test.ts).
import {
  DomainError,
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type Actor,
  type UserActor,
} from '@scorpion/contracts';
import { makeMembership, makeOrganisation, makePng } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useOrganisations } from '../test/harness.ts';
import { startWorld } from '../test/world.ts';
import { ADMIN_FIELDS, EDITOR_FIELDS } from './field-rules.ts';
import { PERMISSION_EDIT, PERMISSION_MANAGE, PERMISSION_READ } from './permissions.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const IDENTITY_MESSAGE = (fields: string) =>
  `These fields can only be changed by an administrator: ${fields}.`;

async function world() {
  const w = await startWorld(h);
  const target = await makeOrganisation(w.pool, {
    abbreviation: 'TGT',
    name: 'Target Institute',
    description: 'old description',
    website: 'https://old.example.org',
    rorId: '02skbsp27',
    sameAs: ['https://old-link.example.org'],
    contactEmail: 'old@example.org',
    contactType: 'support',
  });
  const manager = await w.manager(target.id);
  const managerElsewhere = await w.manager(w.other.id);
  const member = await w.member(target.id);
  const { who: requested } = await w.requester(target.id);
  const rejected = await w.person();
  await w.join(rejected, { organisationId: target.id, state: 'rejected' });
  const left = await w.person();
  await w.join(left, { organisationId: target.id, state: 'left' });
  const user = await w.person();
  return { ...w, target, manager, managerElsewhere, member, requested, rejected, left, user };
}
type World = Awaited<ReturnType<typeof world>>;

const asToken = (actor: UserActor, scopes: string[]): UserActor => ({
  ...actor,
  via: 'token',
  scopes,
});

/** The whole row, so that "nothing was written" can be compared, `updated_at` included. */
const snapshot = async (w: World, id = w.target.id) =>
  (await w.pool.query('select * from org_organisation where id = $1', [id])).rows[0] as Record<
    string,
    unknown
  >;
const blobCount = async (w: World) =>
  (await w.pool.query<{ n: number }>('select count(*)::int as n from blob_blob')).rows[0]!.n;
const references = async (w: World) =>
  (await w.pool.query<{ ref: string }>('select ref from blob_reference')).rows.map((r) => r.ref);
const updates = async (w: World) =>
  (await w.eventsNamed('registry.organisation.updated@1')) as {
    organisationId: string;
    fields: string[];
    by: string;
    actorId: string | null;
  }[];

const PATCHES: Record<string, Record<string, unknown>> = {
  description: { description: 'new description' },
  website: { website: 'https://new.example.org' },
  sameAs: { sameAs: ['https://new-link.example.org'] },
  rorId: { rorId: '03yrm5c26' },
  contact: { contactEmail: 'new@example.org', contactType: 'press' },
};

describe('an Admin edits every field, creates and deletes', () => {
  it('changes the identity fields and the descriptive fields in one request, and the event says by: admin', async () => {
    const w = await world();
    const updated = await w.organisations.update(w.admin, w.target.id, {
      type: 'consortium',
      abbreviation: 'NEWABBR',
      name: 'New Name',
      description: 'd',
      website: 'https://w.example.org',
      sameAs: ['https://s.example.org'],
      rorId: '03yrm5c26',
      contactEmail: 'c@example.org',
      contactType: 'info',
    });
    expect(updated).toMatchObject({
      type: 'consortium',
      abbreviation: 'NEWABBR',
      name: 'New Name',
      updatedBy: w.admin.userId,
    });
    const [event] = await updates(w);
    expect(event).toMatchObject({ by: 'admin', actorId: w.admin.userId });
    expect([...event!.fields].sort()).toEqual(
      [
        'abbreviation',
        'contact',
        'description',
        'name',
        'rorId',
        'sameAs',
        'type',
        'website',
      ].sort(),
    );
  });

  it('sets and clears the logo, and creates and deletes an organisation', async () => {
    const w = await world();
    const withLogo = await w.organisations.setLogo(w.admin, w.target.id, makePng());
    expect(withLogo.logoUrl).toBeDefined();
    const cleared = await w.organisations.clearLogo(w.admin, w.target.id);
    expect(cleared.logoUrl).toBeUndefined();
    const created = await w.organisations.create(w.admin, {
      type: 'provider',
      abbreviation: 'NEW1',
      name: 'Newly created',
    });
    await w.organisations.delete(w.admin, created.id);
    expect(await w.organisations.get(w.admin, w.target.id)).toBeDefined();
    await expect(w.organisations.get(w.admin, created.id)).rejects.toBeInstanceOf(NotFound);
    expect((await updates(w)).map((e) => e.by)).toEqual(['admin', 'admin']);
  });

  it('is recorded as admin when the Admin is also a manager of the organisation', async () => {
    const w = await world();
    await w.join(w.admin, { organisationId: w.target.id, role: 'manager' });
    await w.organisations.update(w.admin, w.target.id, PATCHES.description!);
    await w.organisations.setLogo(w.admin, w.target.id, makePng());
    expect((await updates(w)).map((e) => e.by)).toEqual(['admin', 'admin']);
  });
});

describe('a manager of the organisation edits the descriptive fields and the logo', () => {
  it.each(Object.keys(PATCHES))(
    'may change %s, and the event says by: manager with the field name only',
    async (field) => {
      const w = await world();
      const updated = await w.organisations.update(w.manager, w.target.id, PATCHES[field]!);
      expect(updated.updatedBy).toBeUndefined(); // the audit columns are for administrators
      const row = await snapshot(w);
      expect(row.updated_by).toBe(w.manager.userId);
      const [event] = await updates(w);
      expect(event).toEqual({
        organisationId: w.target.id,
        fields: [field],
        by: 'manager',
        actorId: w.manager.userId,
      });
    },
  );

  it('may change all of them at once', async () => {
    const w = await world();
    const everything = Object.assign({}, ...Object.values(PATCHES)) as Record<string, unknown>;
    const updated = await w.organisations.update(w.manager, w.target.id, everything);
    expect(updated).toMatchObject({
      description: 'new description',
      website: 'https://new.example.org',
      rorId: '03yrm5c26',
      sameAs: ['https://new-link.example.org'],
      contactEmail: 'new@example.org',
      contactType: 'press',
    });
    const [event] = await updates(w);
    expect([...event!.fields].sort()).toEqual(
      ['contact', 'description', 'rorId', 'sameAs', 'website'].sort(),
    );
  });

  it('may clear the optional fields with null', async () => {
    const w = await world();
    const updated = await w.organisations.update(w.manager, w.target.id, {
      description: null,
      website: null,
      rorId: null,
      sameAs: [],
      contactEmail: null,
      contactType: null,
    });
    expect(updated).toMatchObject({ description: null, website: null, rorId: null, sameAs: [] });
  });

  it('may set, replace and clear the logo, and the file is held under the organisation', async () => {
    const w = await world();
    const first = await w.organisations.setLogo(w.manager, w.target.id, makePng(8, [1, 2, 3]));
    expect(first.logoUrl).toMatch(/\/api\/internal\/files\//);
    expect(await references(w)).toEqual([`registry.organisations:logo:${w.target.id}`]);
    await w.organisations.setLogo(w.manager, w.target.id, makePng(9, [4, 5, 6]));
    expect(await references(w)).toEqual([`registry.organisations:logo:${w.target.id}`]);
    const cleared = await w.organisations.clearLogo(w.manager, w.target.id);
    expect(cleared.logoUrl).toBeUndefined();
    expect(await references(w)).toEqual([]);
    expect((await updates(w)).map((e) => `${e.by}:${e.fields.join()}`)).toEqual([
      'manager:logo',
      'manager:logo',
      'manager:logo',
    ]);
  });

  it('validates exactly as for an Admin: the 20-link limit, the ROR pattern, the contact pair, a duplicate', async () => {
    const w = await world();
    const twentyOne = Array.from({ length: 21 }, (_, i) => `https://l${i}.example.org`);
    for (const [patch, path] of [
      [{ sameAs: twentyOne }, 'sameAs'],
      [{ rorId: 'not-a-ror-id' }, 'rorId'],
      [{ contactEmail: 'only@example.org' }, 'contactType'],
      [{ website: 'javascript:alert(1)' }, 'website'],
    ] as const) {
      const failure = await w.organisations.update(w.manager, w.target.id, patch).catch((e) => e);
      expect(failure, path).toBeInstanceOf(Invalid);
    }
    const forAdmin = await w.organisations
      .update(w.admin, w.target.id, { rorId: 'not-a-ror-id' })
      .catch((e) => e);
    expect(forAdmin).toBeInstanceOf(Invalid);
  });

  it('gets a 409 for a ROR id another organisation holds, naming the field and nothing about the other one, and changes nothing', async () => {
    const w = await world();
    await makeOrganisation(w.pool, {
      abbreviation: 'SECRETORG',
      name: 'Secret Other Organisation',
      rorId: '03yrm5c26',
    });
    const before = await snapshot(w);
    const failure = await w.organisations
      .update(w.manager, w.target.id, { rorId: '03yrm5c26', description: 'also changed' })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).status).toBe(409);
    expect(JSON.stringify(failure)).not.toMatch(/SECRETORG|Secret Other/);
    expect((failure as DomainError).message).toMatch(/rorId/);
    expect(await snapshot(w)).toEqual(before);
    expect(await updates(w)).toEqual([]);
  });

  it('writes nothing and emits nothing for a request that changes no value', async () => {
    const w = await world();
    const before = await snapshot(w);
    await w.organisations.update(w.manager, w.target.id, { description: 'old description' });
    expect(await snapshot(w)).toEqual(before);
    expect(await updates(w)).toEqual([]);
  });
});

describe('a manager never writes the identity fields', () => {
  it.each(ADMIN_FIELDS)(
    'refuses %s alone with the field name and no value, and writes nothing [ASVS-8.2.3]',
    async (field) => {
      const w = await world();
      const before = await snapshot(w);
      const failure = await w.organisations
        .update(w.manager, w.target.id, {
          [field]: field === 'type' ? 'consortium' : 'SECRETVALUE',
        })
        .catch((e) => e);
      expect(failure).toBeInstanceOf(Forbidden);
      expect((failure as Forbidden).message).toBe(IDENTITY_MESSAGE(field));
      expect(JSON.stringify(failure)).not.toMatch(/SECRETVALUE|consortium/);
      expect(await snapshot(w)).toEqual(before);
      expect(await updates(w)).toEqual([]);
    },
  );

  it.each(ADMIN_FIELDS)(
    'refuses %s mixed with allowed fields whole: not even the allowed ones are written [ASVS-8.2.3]',
    async (field) => {
      const w = await world();
      const before = await snapshot(w);
      const failure = await w.organisations
        .update(w.manager, w.target.id, {
          description: 'would have been fine',
          website: 'https://fine.example.org',
          [field]: field === 'type' ? 'consortium' : 'Other',
        })
        .catch((e) => e);
      expect(failure).toBeInstanceOf(Forbidden);
      expect((failure as Forbidden).message).toBe(IDENTITY_MESSAGE(field));
      expect(await snapshot(w)).toEqual(before);
      expect(await updates(w)).toEqual([]);
    },
  );

  it('names every identity field of the request, in the order of the table', async () => {
    const w = await world();
    const failure = await w.organisations
      .update(w.manager, w.target.id, { name: 'x', abbreviation: 'y', type: 'consortium' })
      .catch((e) => e);
    expect((failure as Forbidden).message).toBe(IDENTITY_MESSAGE('type, abbreviation, name'));
  });

  it('refuses the identity field even when it names the value it already has', async () => {
    const w = await world();
    const failure = await w.organisations
      .update(w.manager, w.target.id, { name: w.target.name })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(Forbidden);
  });

  it('can neither create nor delete, not even their own organisation, and nothing changes [ASVS-8.2.1]', async () => {
    const w = await world();
    const before = await snapshot(w);
    const organisations = (await w.pool.query('select count(*)::int as n from org_organisation'))
      .rows;
    await expect(
      w.organisations.create(w.manager, { type: 'provider', abbreviation: 'MINE', name: 'Mine' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(w.organisations.delete(w.manager, w.target.id)).rejects.toBeInstanceOf(Forbidden);
    expect(await snapshot(w)).toEqual(before);
    expect((await w.pool.query('select count(*)::int as n from org_organisation')).rows).toEqual(
      organisations,
    );
    expect(await w.eventsNamed('registry.organisation.deleted@1')).toEqual([]);
    expect(await w.eventsNamed('registry.organisation.created@1')).toEqual([]);
  });
});

describe('nobody else edits', () => {
  it('denies a manager of another organisation on the patch, the logo upload and the logo removal, and stores no file [ASVS-8.2.2]', async () => {
    const w = await world();
    const logoOwner = await w.organisations.setLogo(w.admin, w.target.id, makePng());
    const before = await snapshot(w);
    const blobs = await blobCount(w);
    await expect(
      w.organisations.update(w.managerElsewhere, w.target.id, PATCHES.description!),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.organisations.update(w.managerElsewhere, w.target.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.organisations.setLogo(w.managerElsewhere, w.target.id, makePng(5, [9, 9, 9])),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(w.organisations.clearLogo(w.managerElsewhere, w.target.id)).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(await blobCount(w)).toBe(blobs);
    expect(await snapshot(w)).toEqual(before);
    expect((await w.organisations.get(w.admin, w.target.id)).logoUrl).toBe(logoOwner.logoUrl);
    // The same person edits the organisation they do manage.
    await expect(
      w.organisations.update(w.managerElsewhere, w.other.id, PATCHES.description!),
    ).resolves.toBeDefined();
  });

  it.each(['member', 'requested', 'rejected', 'left', 'user'] as const)(
    'denies %s on the patch, the logo upload and the logo removal, and stores no file [ASVS-8.2.1]',
    async (who) => {
      const w = await world();
      const caller = w[who];
      const before = await snapshot(w);
      await expect(
        w.organisations.update(caller, w.target.id, PATCHES.description!),
      ).rejects.toBeInstanceOf(Forbidden);
      await expect(
        w.organisations.update(caller, w.target.id, { name: 'x' }),
      ).rejects.toBeInstanceOf(Forbidden);
      await expect(w.organisations.setLogo(caller, w.target.id, makePng())).rejects.toBeInstanceOf(
        Forbidden,
      );
      await expect(w.organisations.clearLogo(caller, w.target.id)).rejects.toBeInstanceOf(
        Forbidden,
      );
      await expect(
        w.organisations.create(caller, { type: 'provider', abbreviation: 'X', name: 'X' }),
      ).rejects.toBeInstanceOf(Forbidden);
      await expect(w.organisations.delete(caller, w.target.id)).rejects.toBeInstanceOf(Forbidden);
      expect(await blobCount(w)).toBe(0);
      expect(await snapshot(w)).toEqual(before);
      expect(await updates(w)).toEqual([]);
    },
  );

  it('does not tell a caller without the right which fields an administrator would be needed for', async () => {
    const w = await world();
    const failure = await w.organisations
      .update(w.user, w.target.id, { name: 'x' })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(Forbidden);
    expect((failure as Forbidden).message).not.toMatch(/administrator|name/);
  });

  it('answers 404 before 403 for an unknown organisation (it is readable by every signed-in person) and 422 for a bad id', async () => {
    const w = await world();
    for (const caller of [w.user, w.manager, w.admin]) {
      await expect(
        w.organisations.update(caller, ABSENT, PATCHES.description!),
      ).rejects.toBeInstanceOf(NotFound);
      await expect(w.organisations.setLogo(caller, ABSENT, makePng())).rejects.toBeInstanceOf(
        NotFound,
      );
      await expect(w.organisations.clearLogo(caller, ABSENT)).rejects.toBeInstanceOf(NotFound);
      await expect(
        w.organisations.update(caller, 'not-a-uuid', PATCHES.description!),
      ).rejects.toBeInstanceOf(Invalid);
    }
    expect(await blobCount(w)).toBe(0);
  });

  it('answers 401 to an anonymous caller on every write', async () => {
    const w = await world();
    await expect(
      w.organisations.update(anonymous, w.target.id, PATCHES.description!),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(w.organisations.setLogo(anonymous, w.target.id, makePng())).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(w.organisations.clearLogo(anonymous, w.target.id)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(await blobCount(w)).toBe(0);
  });

  it('denies a manager the next call after a demotion, a removal or a deleted membership, and an approved member never gains the right [ASVS-8.2.1]', async () => {
    const w = await world();
    await w.organisations.update(w.manager, w.target.id, PATCHES.description!);
    await w.pool.query(
      "update org_membership set role = 'member' where organisation_id = $1 and user_id = $2",
      [w.target.id, w.manager.userId],
    );
    await expect(
      w.organisations.update(w.manager, w.target.id, PATCHES.website!),
    ).rejects.toBeInstanceOf(Forbidden);
    await w.pool.query(
      "update org_membership set role = 'manager' where organisation_id = $1 and user_id = $2",
      [w.target.id, w.manager.userId],
    );
    await expect(
      w.organisations.update(w.manager, w.target.id, PATCHES.website!),
    ).resolves.toBeDefined();
    await w.pool.query(
      "update org_membership set state = 'left', role = 'member' where organisation_id = $1 and user_id = $2",
      [w.target.id, w.manager.userId],
    );
    await expect(w.organisations.setLogo(w.manager, w.target.id, makePng())).rejects.toBeInstanceOf(
      Forbidden,
    );
    await w.pool.query('delete from org_membership where organisation_id = $1 and user_id = $2', [
      w.target.id,
      w.manager.userId,
    ]);
    await expect(w.organisations.clearLogo(w.manager, w.target.id)).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(await blobCount(w)).toBe(0);
  });
});

describe('a token holds only the scopes it names', () => {
  it('cannot edit without the scope of the permission, whoever its owner is [ASVS-8.2.1]', async () => {
    const w = await world();
    const before = await snapshot(w);
    // `read` alone reaches the service; without `edit` or `manage` the service refuses.
    for (const owner of [w.manager, w.admin]) {
      const token = asToken(owner, [PERMISSION_READ]);
      await expect(
        w.organisations.update(token, w.target.id, PATCHES.description!),
      ).rejects.toBeInstanceOf(Forbidden);
      await expect(w.organisations.setLogo(token, w.target.id, makePng())).rejects.toBeInstanceOf(
        Forbidden,
      );
      await expect(w.organisations.clearLogo(token, w.target.id)).rejects.toBeInstanceOf(Forbidden);
    }
    // No `read` scope: it does not even reach the organisation.
    await expect(
      w.organisations.update(
        asToken(w.manager, [PERMISSION_EDIT]),
        w.target.id,
        PATCHES.description!,
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await blobCount(w)).toBe(0);
    expect(await snapshot(w)).toEqual(before);
  });

  it('lets a manager’s token with `read` and `edit` change the descriptive fields (by: manager) and not the identity fields', async () => {
    const w = await world();
    const token = asToken(w.manager, [PERMISSION_READ, PERMISSION_EDIT]);
    await w.organisations.update(token, w.target.id, PATCHES.description!);
    await expect(w.organisations.update(token, w.target.id, { name: 'x' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect((await updates(w)).map((e) => e.by)).toEqual(['manager']);
  });

  it('never gives a member the right by naming the scope, nor a manager of another organisation [ASVS-8.2.1]', async () => {
    const w = await world();
    for (const owner of [w.member, w.managerElsewhere, w.user]) {
      const token = asToken(owner, [PERMISSION_READ, PERMISSION_EDIT, PERMISSION_MANAGE]);
      await expect(
        w.organisations.update(token, w.target.id, PATCHES.description!),
      ).rejects.toBeInstanceOf(Forbidden);
      await expect(w.organisations.setLogo(token, w.target.id, makePng())).rejects.toBeInstanceOf(
        Forbidden,
      );
    }
    expect(await blobCount(w)).toBe(0);
  });

  it('limits an Admin’s token to its scopes too: `manage` lets it change every field, `edit` alone only the descriptive ones', async () => {
    const w = await world();
    await w.organisations.update(
      asToken(w.admin, [PERMISSION_READ, PERMISSION_MANAGE]),
      w.target.id,
      {
        name: 'Renamed by token',
      },
    );
    const editOnly = asToken(w.admin, [PERMISSION_READ, PERMISSION_EDIT]);
    await w.organisations.update(editOnly, w.target.id, PATCHES.description!);
    await expect(
      w.organisations.update(editOnly, w.target.id, { name: 'x' }),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('editableFields: what a screen draws its form from', () => {
  it('lists every field for an Admin, the descriptive ones for a manager of that organisation, none for anybody else [ASVS-8.2.3]', async () => {
    const w = await world();
    const fieldsFor = async (caller: Actor, id = w.target.id) =>
      (await w.organisations.get(caller, id)).editableFields;
    expect(await fieldsFor(w.admin)).toEqual([...ADMIN_FIELDS, ...EDITOR_FIELDS]);
    expect(await fieldsFor(w.manager)).toEqual([...EDITOR_FIELDS]);
    for (const caller of [w.member, w.requested, w.rejected, w.left, w.user, w.managerElsewhere]) {
      expect(await fieldsFor(caller)).toEqual([]);
    }
    // The manager of another organisation is an editor there and nowhere else.
    expect(await fieldsFor(w.managerElsewhere, w.other.id)).toEqual([...EDITOR_FIELDS]);
    expect(await fieldsFor(w.manager, w.other.id)).toEqual([]);
  });

  it('is part of every answer that shows the organisation, and agrees with what the server then accepts', async () => {
    const w = await world();
    const updated = await w.organisations.update(w.manager, w.target.id, PATCHES.website!);
    expect(updated.editableFields).toEqual([...EDITOR_FIELDS]);
    for (const field of updated.editableFields) {
      expect(EDITOR_FIELDS as readonly string[]).toContain(field);
    }
    const created = await w.organisations.create(w.admin, {
      type: 'provider',
      abbreviation: 'EDF',
      name: 'Editable fields',
    });
    expect(created.editableFields).toEqual([...ADMIN_FIELDS, ...EDITOR_FIELDS]);
  });

  it('is empty for the caller whose rights were taken away at the next read', async () => {
    const w = await world();
    expect((await w.organisations.get(w.manager, w.target.id)).editableFields).not.toEqual([]);
    await w.pool.query(
      "update org_membership set role = 'member' where organisation_id = $1 and user_id = $2",
      [w.target.id, w.manager.userId],
    );
    expect((await w.organisations.get(w.manager, w.target.id)).editableFields).toEqual([]);
  });
});

describe('events carry names and ids, never values', () => {
  it('holds no description, address, URL, ROR id, name or abbreviation in the payload of a manager’s or an Admin’s edit', async () => {
    const w = await world();
    await w.organisations.update(w.manager, w.target.id, {
      description: 'SECRET-DESCRIPTION',
      website: 'https://secret-website.example.org',
      sameAs: ['https://secret-link.example.org'],
      rorId: '03yrm5c26',
      contactEmail: 'secret-address@example.org',
      contactType: 'secret-type',
    });
    await w.organisations.update(w.admin, w.target.id, {
      name: 'SECRET-NAME',
      abbreviation: 'SECRETABBR',
    });
    await w.organisations.setLogo(w.manager, w.target.id, makePng());
    const text = JSON.stringify(await w.events());
    for (const secret of [
      'SECRET-DESCRIPTION',
      'secret-website',
      'secret-link',
      '03yrm5c26',
      'secret-address',
      'secret-type',
      'SECRET-NAME',
      'SECRETABBR',
      '@example.org',
      'https://',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    expect((await updates(w)).map((e) => `${e.by}`)).toEqual(['manager', 'admin', 'manager']);
  });
});

describe('a change is one transaction', () => {
  it('rolls the row back when the event of a manager’s edit cannot be stored', async () => {
    const w = await world();
    const before = await snapshot(w);
    const restore = await breakOutbox(w.pool);
    await expect(
      w.organisations.update(w.manager, w.target.id, PATCHES.description!),
    ).rejects.toThrow();
    await restore();
    expect(await snapshot(w)).toEqual(before);
    expect(await updates(w)).toEqual([]);
  });

  it('rolls the logo columns and the blob reference back together when the event cannot be stored', async () => {
    const w = await world();
    const before = await snapshot(w);
    const restore = await breakOutbox(w.pool);
    await expect(w.organisations.setLogo(w.manager, w.target.id, makePng())).rejects.toThrow();
    await restore();
    expect(await snapshot(w)).toEqual(before);
    expect(await references(w)).toEqual([]);
    expect(await updates(w)).toEqual([]);
    // The file itself was stored before the transaction; nothing holds it, so the hourly cleanup removes it.
    const unreferenced = await w.pool.query<{ n: number }>(
      'select count(*)::int as n from blob_blob where unreferenced_since is not null',
    );
    expect(unreferenced.rows[0]!.n).toBe(await blobCount(w));
  });

  it('keeps the logo, its columns and its reference when the removal’s event cannot be stored', async () => {
    const w = await world();
    await w.organisations.setLogo(w.manager, w.target.id, makePng());
    const before = await snapshot(w);
    const held = await references(w);
    const restore = await breakOutbox(w.pool);
    await expect(w.organisations.clearLogo(w.manager, w.target.id)).rejects.toThrow();
    await restore();
    expect(await snapshot(w)).toEqual(before);
    expect(await references(w)).toEqual(held);
  });

  it('creates no blob for a denied upload', async () => {
    const w = await world();
    await expect(w.organisations.setLogo(w.member, w.target.id, makePng())).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(
      w.organisations.setLogo(w.managerElsewhere, w.target.id, makePng()),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await blobCount(w)).toBe(0);
  });
});

describe('two editors at once', () => {
  it('keeps both changes when an Admin and a manager change different fields at the same moment', async () => {
    const w = await world();
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        w.organisations.update(w.admin, w.target.id, { name: `Admin name ${round}` }),
        w.organisations.update(w.manager, w.target.id, { description: `Manager text ${round}` }),
      ]);
      const row = await snapshot(w);
      expect(row.name).toBe(`Admin name ${round}`);
      expect(row.description).toBe(`Manager text ${round}`);
    }
  });

  it('lets the last write win on the same field, and the events show both', async () => {
    const w = await world();
    await Promise.all([
      w.organisations.update(w.admin, w.target.id, { description: 'from the admin' }),
      w.organisations.update(w.manager, w.target.id, { description: 'from the manager' }),
    ]);
    expect(['from the admin', 'from the manager']).toContain((await snapshot(w)).description);
    expect((await updates(w)).map((e) => e.by).sort()).toEqual(['admin', 'manager']);
  });

  it('keeps a manager’s logo and an Admin’s rename together', async () => {
    const w = await world();
    await Promise.all([
      w.organisations.setLogo(w.manager, w.target.id, makePng()),
      w.organisations.update(w.admin, w.target.id, { name: 'Renamed meanwhile' }),
    ]);
    const row = await snapshot(w);
    expect(row.name).toBe('Renamed meanwhile');
    expect(row.logo_hash).not.toBeNull();
  });
});

describe('the contact point is the organisation’s, edited by either group', () => {
  it('is never the recipient of a mail: editing it queues nothing', async () => {
    const w = await world();
    await w.organisations.update(w.manager, w.target.id, {
      contactEmail: 'redirect@example.org',
      contactType: 'support',
    });
    await w.dispatch();
    expect(await w.deliveries()).toEqual([]);
    expect(await w.inbox()).toEqual([]);
  });

  it('shows the new contact point to the manager and the Admin, and to others while the setting is on [ASVS-8.2.3]', async () => {
    const w = await world();
    await w.organisations.update(w.manager, w.target.id, {
      contactEmail: 'new@example.org',
      contactType: 'press',
    });
    for (const reader of [w.manager, w.admin, w.user]) {
      expect(await w.organisations.get(reader, w.target.id)).toMatchObject({
        contactEmail: 'new@example.org',
        contactType: 'press',
      });
    }
    await w.configure({ exposeContactPoint: false });
    expect((await w.organisations.get(w.user, w.target.id)).contactEmail).toBeUndefined();
    expect((await w.organisations.get(w.manager, w.target.id)).contactEmail).toBe(
      'new@example.org',
    );
  });
});

describe('a membership row of the same person in another state grants nothing', () => {
  it('does not let a manager of A whose membership in B is only requested edit B', async () => {
    const w = await world();
    await makeMembership(w.pool, {
      organisationId: w.other.id,
      userId: w.manager.userId,
      state: 'requested',
    });
    await expect(
      w.organisations.update(w.manager, w.other.id, PATCHES.description!),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});
