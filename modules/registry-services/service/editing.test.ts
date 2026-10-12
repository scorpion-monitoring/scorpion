// `update` against real Postgres with the real authoriser: the three groups on one record (plan §6, ADR-0036),
// the request refused whole, the order 404 - 403 - 422, what is written and what is not, the events without
// values, the rollback and the two editors that meet.
import { Forbidden, Invalid, NotFound, Unauthorized } from '@scorpion/contracts';
import { makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { breakOutbox, useServices } from '../test/harness.ts';
import { anonymous, rejection, world, type World } from '../test/world.ts';

const h = useServices();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

const EDIT_FIELDS: [
  string,
  Record<string, unknown>,
  (row: Awaited<ReturnType<World['row']>>) => unknown,
  unknown,
][] = [
  ['name', { name: 'A new name' }, (r) => r.name, 'A new name'],
  ['stage', { stage: 'DEMO' }, (r) => r.stage, 'DEMO'],
  ['license', { license: 'MIT' }, (r) => r.license, 'MIT'],
  ['description', { description: 'Plain text.' }, (r) => r.description, 'Plain text.'],
  ['url', { url: 'https://example.org/tool' }, (r) => r.url, 'https://example.org/tool'],
  [
    'sameAs',
    { sameAs: ['https://example.org/a', 'https://example.org/b'] },
    (r) => r.same_as,
    ['https://example.org/a', 'https://example.org/b'],
  ],
  [
    'contact',
    { contact: { email: 'help@example.org', type: 'support' } },
    (r) => [r.contact_email, r.contact_type],
    ['help@example.org', 'support'],
  ],
];

describe('update: a member of the provider (the edit group)', () => {
  it.each(EDIT_FIELDS)(
    'changes %s, writes nothing else, and says by: member [ASVS-8.2.1]',
    async (key, patch, read, expected) => {
      const w = await world(h);
      const before = await w.row();
      const view = await w.services.update(w.people.member, w.svc.id, patch);
      const after = await w.row();
      expect(read(after)).toEqual(expected);
      expect(after.updated_by).toBe(w.people.member.userId);
      expect(after.slug).toBe(before.slug); // the identity is untouched
      expect(view.editableFields).not.toContain('slug');
      const emitted = (await w.events()).filter((e) => e.name === 'registry.service.updated@1');
      expect(emitted).toHaveLength(1);
      expect(emitted[0]!.payload).toMatchObject({
        serviceId: w.svc.id,
        by: 'member',
        actorId: w.people.member.userId,
      });
      expect((emitted[0]!.payload.fields as string[]).length).toBeGreaterThan(0);
      expect(key).toBeTruthy();
    },
  );

  it('changes the consortia: replaces the links of that role and leaves the provider alone', async () => {
    const w = await world(h);
    await w.services.update(w.people.member, w.svc.id, { consortia: [w.consortium2.id] });
    expect(await w.links()).toEqual(
      [
        { role: 'consortium', organisation_id: w.consortium2.id },
        { role: 'provider', organisation_id: w.provider.id },
      ].sort((a, b) => a.role.localeCompare(b.role)),
    );
    await w.services.update(w.people.member, w.svc.id, { consortia: null });
    expect(await w.links()).toEqual([{ role: 'provider', organisation_id: w.provider.id }]);
    await w.services.update(w.people.member, w.svc.id, {
      consortia: [w.consortium.id, w.consortium2.id],
    });
    expect((await w.links()).filter((l) => l.role === 'consortium')).toHaveLength(2);
    const fields = (await w.events())
      .filter((e) => e.name === 'registry.service.updated@1')
      .map((e) => e.payload.fields);
    expect(fields).toEqual([['consortia'], ['consortia'], ['consortia']]);
  });

  it('changes many fields at once and sets only the ones the patch names', async () => {
    const w = await world(h);
    const before = await w.row();
    await w.services.update(w.people.member, w.svc.id, {
      name: 'Renamed',
      description: 'New text',
      url: 'https://example.org/x',
    });
    const after = await w.row();
    expect(after).toMatchObject({
      name: 'Renamed',
      description: 'New text',
      url: 'https://example.org/x',
    });
    expect(after.stage).toBe(before.stage);
    expect(after.license).toBe(before.license);
    const [event] = (await w.events()).filter((e) => e.name === 'registry.service.updated@1');
    expect(event!.payload.fields).toEqual(['name', 'description', 'url']);
  });

  it('clears an optional field with null, and the contact point as a pair', async () => {
    const w = await world(h);
    await w.services.update(w.people.member, w.svc.id, {
      description: 'text',
      url: 'https://example.org/x',
      sameAs: ['https://example.org/a'],
      license: 'MIT',
      contact: { email: 'a@example.org', type: 'support' },
    });
    await w.services.update(w.people.member, w.svc.id, {
      description: null,
      url: null,
      sameAs: null,
      license: null,
      contact: { email: null, type: null },
    });
    expect(await w.row()).toMatchObject({
      description: null,
      url: null,
      same_as: [],
      license: null,
      contact_email: null,
      contact_type: null,
    });
  });

  it('changes nothing, and emits nothing, when the values are the ones it has', async () => {
    const w = await world(h);
    await w.services.update(w.people.member, w.svc.id, { description: 'same' });
    const before = await w.row();
    const events = (await w.events()).length;
    await w.services.update(w.people.member, w.svc.id, {
      description: 'same',
      stage: before.stage,
    });
    expect(await w.row()).toEqual(before);
    expect(await w.events()).toHaveLength(events);
  });

  it('lets two editors change two fields: both stick', async () => {
    const w = await world(h);
    await Promise.all([
      w.services.update(w.people.member, w.svc.id, { description: 'from the member' }),
      w.services.update(w.people.manager, w.svc.id, { url: 'https://example.org/manager' }),
    ]);
    expect(await w.row()).toMatchObject({
      description: 'from the member',
      url: 'https://example.org/manager',
    });
  });

  it('returns the view for the caller, with editableFields and allowedActions from the same table', async () => {
    const w = await world(h);
    const view = await w.services.update(w.people.member, w.svc.id, { name: 'Viewed' });
    expect(view).toMatchObject({ name: 'Viewed', allowedActions: ['edit'] });
    expect(view.editableFields).toEqual(
      FIELDS.map((f) => f.key).filter((k) => k !== 'slug' && k !== 'provider'),
    );
  });
});

describe('update: the identity (slug and provider) is the managers’ and Admin’s', () => {
  it.each([
    ['the slug alone', { slug: 'taken-by-a-member' }, 'slug'],
    ['the provider alone', { provider: 'OTHER' }, 'provider'],
    ['both', { slug: 'taken-by-a-member', provider: 'OTHER' }, 'slug, provider'],
    ['a mixed request', { description: 'ok', slug: 'taken-by-a-member' }, 'slug'],
    ['a mixed request with a null', { name: 'ok', provider: 'OTHER', consortia: null }, 'provider'],
  ])(
    'refuses a member %s whole: 403 naming the fields, never a value, nothing written [ASVS-8.2.3]',
    async (_name, raw, named) => {
      const w = await world(h);
      const patch = JSON.parse(JSON.stringify(raw).replace('OTHER', w.other.id)) as Record<
        string,
        unknown
      >;
      const before = await w.row();
      const links = await w.links();
      const events = (await w.events()).length;
      const error = await rejection(w.services.update(w.people.member, w.svc.id, patch));
      expect(error).toBeInstanceOf(Forbidden);
      expect(error.message).toContain(named);
      expect(JSON.stringify(error)).not.toContain('taken-by-a-member');
      expect(JSON.stringify(error)).not.toContain(w.other.id);
      expect(await w.row()).toEqual(before);
      expect(await w.links()).toEqual(links);
      expect(await w.history()).toEqual([w.svc.slug]);
      expect(await w.events()).toHaveLength(events);
    },
  );

  it('lets a manager of the provider change the slug and the provider, with by: manager', async () => {
    const w = await world(h);
    await w.join(w.people.manager, w.other.id, 'approved', 'manager'); // they manage both
    await w.services.update(w.people.manager, w.svc.id, {
      slug: 'renamed-by-manager',
      provider: w.other.id,
      name: 'Moved',
    });
    expect(await w.row()).toMatchObject({ slug: 'renamed-by-manager', name: 'Moved' });
    expect((await w.links()).find((l) => l.role === 'provider')).toMatchObject({
      organisation_id: w.other.id,
    });
    const [event] = (await w.events()).filter((e) => e.name === 'registry.service.updated@1');
    expect(event!.payload).toMatchObject({ by: 'manager', actorId: w.people.manager.userId });
    expect(event!.payload.fields).toEqual(expect.arrayContaining(['slug', 'provider', 'name']));
  });

  it('refuses a manager a move to an organisation they do not manage (403), and changes nothing', async () => {
    const w = await world(h);
    const before = await w.row();
    const error = await rejection(
      w.services.update(w.people.manager, w.svc.id, { provider: w.other.id, description: 'x' }),
    );
    expect(error).toBeInstanceOf(Forbidden);
    expect(JSON.stringify(error)).not.toContain(w.other.id);
    expect(await w.row()).toEqual(before);
    expect((await w.links()).find((l) => l.role === 'provider')!.organisation_id).toBe(
      w.provider.id,
    );
    // A member of the target (not a manager) is not enough either.
    await w.join(w.people.manager, w.other.id, 'approved', 'member');
    await expect(
      w.services.update(w.people.manager, w.svc.id, { provider: w.other.id }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('lets the manager of the new provider take the service over only after Admin moved it, and not before', async () => {
    const w = await world(h);
    // managerElsewhere manages `other`, not the provider of the service: nothing on this service.
    await expect(
      w.services.update(w.people.managerElsewhere, w.svc.id, { slug: 'grab' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await w.services.update(w.people.admin, w.svc.id, { provider: w.other.id });
    await expect(
      w.services.update(w.people.managerElsewhere, w.svc.id, { slug: 'now-mine' }),
    ).resolves.toMatchObject({
      slug: 'now-mine',
    });
    await expect(
      w.services.update(w.people.manager, w.svc.id, { slug: 'not-mine-anymore' }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('refuses a manager who left the provider at the next call, and a demoted manager the identity but not the description [ASVS-8.2.1]', async () => {
    const w = await world(h);
    await w.services.update(w.people.manager, w.svc.id, { slug: 'first-rename' });
    await w.pool.query("update org_membership set role = 'member' where user_id = $1", [
      w.people.manager.userId,
    ]);
    await expect(
      w.services.update(w.people.manager, w.svc.id, { slug: 'second-rename' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.update(w.people.manager, w.svc.id, { description: 'still a member' }),
    ).resolves.toBeDefined();
    await w.pool.query("update org_membership set state = 'left' where user_id = $1", [
      w.people.manager.userId,
    ]);
    await expect(
      w.services.update(w.people.manager, w.svc.id, { description: 'gone' }),
    ).rejects.toBeInstanceOf(Forbidden);
    expect((await w.row()).slug).toBe('first-rename');
    expect((await w.row()).description).toBe('still a member');
  });

  it('lets Admin change everything and says by: admin', async () => {
    const w = await world(h);
    await w.services.update(w.people.admin, w.svc.id, {
      slug: 'admin-rename',
      provider: w.other.id,
      stage: 'TERM',
    });
    expect(await w.row()).toMatchObject({ slug: 'admin-rename', stage: 'TERM' });
    const [event] = (await w.events()).filter((e) => e.name === 'registry.service.updated@1');
    expect(event!.payload).toMatchObject({ by: 'admin', actorId: w.people.admin.userId });
  });

  it('refuses the provider that is no organisation (422), of a wrong type (422), or empty (422)', async () => {
    const w = await world(h);
    const admin = w.people.admin;
    await expect(w.services.update(admin, w.svc.id, { provider: ABSENT })).rejects.toBeInstanceOf(
      Invalid,
    );
    await expect(
      w.services.update(admin, w.svc.id, { provider: w.consortium.id }),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(w.services.update(admin, w.svc.id, { provider: null })).rejects.toBeInstanceOf(
      Invalid,
    );
    await expect(
      w.services.update(admin, w.svc.id, { consortia: [w.provider.id] }),
    ).rejects.toBeInstanceOf(Invalid);
    expect((await w.links()).find((l) => l.role === 'provider')!.organisation_id).toBe(
      w.provider.id,
    );
  });
});

describe('update: everybody else', () => {
  it.each(['plain', 'reviewer', 'requested', 'rejected', 'left', 'managerElsewhere'] as const)(
    'refuses %s with 403 and writes nothing [ASVS-8.2.1]',
    async (who) => {
      const w = await world(h);
      const before = await w.row();
      await expect(
        w.services.update(w.people[who], w.svc.id, { description: 'defaced' }),
      ).rejects.toBeInstanceOf(Forbidden);
      await expect(
        w.services.update(w.people[who], w.svc.id, { slug: 'defaced' }),
      ).rejects.toBeInstanceOf(Forbidden);
      expect(await w.row()).toEqual(before);
      expect((await w.events()).filter((e) => e.name.startsWith('registry.service.u'))).toEqual([]);
    },
  );

  it('answers 401 to an anonymous caller', async () => {
    const w = await world(h);
    await expect(
      w.services.update(anonymous, w.svc.id, { description: 'x' }),
    ).rejects.toBeInstanceOf(Unauthorized);
  });

  it('answers 404 for an unknown service before 403, and 422 for a bad id [ASVS-8.2.2]', async () => {
    const w = await world(h);
    // A service is readable by every signed-in person, so telling "unknown" from "not yours" reveals nothing.
    await expect(
      w.services.update(w.people.plain, ABSENT, { description: 'x' }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      w.services.update(w.people.member, ABSENT, { description: 'x' }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      w.services.update(w.people.admin, 'nope', { description: 'x' }),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('answers 403 before 422: a caller who may not edit learns nothing from the validation', async () => {
    const w = await world(h);
    await expect(
      w.services.update(w.people.plain, w.svc.id, { url: 'javascript:alert(1)' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(w.services.update(w.people.plain, w.svc.id, {})).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.update(w.people.plain, w.svc.id, { nonsense: 1 }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("does not let a member of another service's provider edit by id [ASVS-8.2.2]", async () => {
    const w = await world(h);
    const theirs = await makeService(w.pool, { provider: w.other.id });
    await expect(
      w.services.update(w.people.managerElsewhere, w.svc.id, { description: 'x' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.update(w.people.managerElsewhere, theirs.id, { description: 'mine' }),
    ).resolves.toBeDefined();
    expect((await w.row(theirs.id)).description).toBe('mine');
    expect((await w.row()).description).toBeNull();
  });
});

describe('update: input', () => {
  it.each([
    ['an empty patch', {}],
    ['an unknown field', { nonsense: 'x' }],
    ['an unknown nested field', { contact: { phone: '1' } }],
    ['a field the configuration does not name', { public: true }],
    ['the icon', { icon: 'data:image/png;base64,AAAA' }],
    ['a bad url', { url: 'ftp://example.org' }],
    ['a script url', { url: 'javascript:alert(1)' }],
    ['a bad sameAs entry', { sameAs: ['not a url'] }],
    [
      'too many sameAs entries',
      { sameAs: Array.from({ length: 21 }, (_, i) => `https://example.org/${i}`) },
    ],
    ['an unknown stage', { stage: 'NOPE' }],
    ['an unknown licence', { license: 'Not-A-Licence' }],
    ['an empty name', { name: '' }],
    ['a null name', { name: null }],
    ['a long description', { description: 'x'.repeat(4001) }],
    ['half a contact point', { contact: { email: 'a@example.org' } }],
    [
      'a contact point with a bad address',
      { contact: { email: 'not-an-address', type: 'support' } },
    ],
    ['a body that is not an object', 'text'],
  ])('refuses %s with 422 and changes nothing', async (_name, patch) => {
    const w = await world(h);
    const before = await w.row();
    await expect(w.services.update(w.people.member, w.svc.id, patch)).rejects.toBeInstanceOf(
      Invalid,
    );
    expect(await w.row()).toEqual(before);
  });

  it('refuses half a contact point against the stored one: clearing only the type is 422, and nothing changes', async () => {
    const w = await world(h);
    await w.services.update(w.people.member, w.svc.id, {
      contact: { email: 'a@example.org', type: 'support' },
    });
    const before = await w.row();
    await expect(
      w.services.update(w.people.member, w.svc.id, { contact: { type: null } }),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(
      w.services.update(w.people.member, w.svc.id, { contact: { email: 'b@example.org' } }),
    ).resolves.toBeDefined();
    expect(await w.row()).toMatchObject({
      contact_email: 'b@example.org',
      contact_type: before.contact_type,
    });
  });

  it('lists the problems by field, with the path of the field', async () => {
    const w = await world(h);
    const error = await rejection(
      w.services.update(w.people.member, w.svc.id, { url: 'ftp://x', stage: 'NOPE' }),
    );
    const paths = (error.errors ?? []).map((e) => e.path).sort();
    expect(paths).toEqual(['stage', 'url']);
  });
});

describe('update: a configured field that is not a column', () => {
  const extra = {
    key: 'termsUrl',
    path: '/extra/termsUrl',
    type: 'text',
    label: 'services.field.termsUrl.label',
    config: { format: 'url' },
    storage: { kind: 'value' },
  } as const;
  const config = {
    fields: [...FIELDS, extra],
    steps: STEPS.map((step) =>
      step.id === 'basics' ? { ...step, fields: [...step.fields!, 'termsUrl'] } : step,
    ),
  };

  it('stores, changes and removes the value in svc_field_value for a member, as an edit field', async () => {
    const w = await world(h, { config });
    await w.services.update(w.people.member, w.svc.id, {
      extra: { termsUrl: 'https://example.org/terms' },
    });
    const read = async () =>
      (
        await w.pool.query<{ value: unknown }>(
          'select value from svc_field_value where service_id = $1',
          [w.svc.id],
        )
      ).rows;
    expect(await read()).toEqual([{ value: 'https://example.org/terms' }]);
    await w.services.update(w.people.member, w.svc.id, {
      extra: { termsUrl: 'https://example.org/v2' },
    });
    expect(await read()).toEqual([{ value: 'https://example.org/v2' }]);
    await w.services.update(w.people.member, w.svc.id, { extra: { termsUrl: null } });
    expect(await read()).toEqual([]);
    const fields = (await w.events())
      .filter((e) => e.name === 'registry.service.updated@1')
      .map((e) => e.payload.fields);
    expect(fields).toEqual([['termsUrl'], ['termsUrl'], ['termsUrl']]);
  });

  it('is an edit field: editable for a member, in editableFields', async () => {
    const w = await world(h, { config });
    expect((await w.services.get(w.people.member, w.svc.id)).editableFields).toContain('termsUrl');
    expect((await w.services.get(w.people.plain, w.svc.id)).editableFields).toEqual([]);
  });
});

describe('update: all or nothing', () => {
  it('rolls the row, the links, the slug history and the values back together when the event cannot be stored', async () => {
    const w = await world(h);
    const before = await w.row();
    const links = await w.links();
    const restore = await breakOutbox(w.pool);
    await expect(
      w.services.update(w.people.admin, w.svc.id, {
        slug: 'would-be-new',
        description: 'would be new',
        consortia: [w.consortium2.id],
        provider: w.other.id,
      }),
    ).rejects.toThrow();
    await restore();
    expect(await w.row()).toEqual(before);
    expect(await w.links()).toEqual(links);
    expect(await w.history()).toEqual([w.svc.slug]);
    expect(await w.events()).toEqual([]);
  });

  it('leaves the row alone when a later part of the patch fails inside the transaction (a taken slug)', async () => {
    const w = await world(h);
    const rival = await makeService(w.pool, { provider: w.other.id });
    const before = await w.row();
    const links = await w.links();
    const error = await rejection(
      w.services.update(w.people.admin, w.svc.id, {
        description: 'half done',
        consortia: [w.consortium2.id],
        slug: rival.slug,
      }),
    );
    expect(error).toMatchObject({ status: 409 });
    expect(await w.row()).toEqual(before);
    expect(await w.links()).toEqual(links);
    expect(await w.history()).toEqual([w.svc.slug]);
  });
});

describe('the events of an update carry field names and ids, never a value', () => {
  it('holds no text, address or URL in any payload', async () => {
    const w = await world(h);
    const secrets = [
      'Secret description text',
      'https://example.org/private-link',
      'who@example.org',
      'secret-slug-1',
    ];
    await w.services.update(w.people.admin, w.svc.id, {
      description: secrets[0],
      url: secrets[1],
      contact: { email: secrets[2], type: 'support' },
      slug: secrets[3],
      name: 'Secret name',
    });
    const names = (await w.events()).filter((e) => e.name.startsWith('registry.service.'));
    expect(names.map((e) => e.name).sort()).toEqual([
      'registry.service.slugChanged@1',
      'registry.service.updated@1',
    ]);
    const text = JSON.stringify(names.map((e) => e.payload));
    for (const secret of [...secrets, 'Secret name']) expect(text).not.toContain(secret);
    const updated = names.find((e) => e.name === 'registry.service.updated@1')!;
    expect(Object.keys(updated.payload).sort()).toEqual(['actorId', 'by', 'fields', 'serviceId']);
    expect(
      Object.keys(names.find((e) => e.name === 'registry.service.slugChanged@1')!.payload).sort(),
    ).toEqual(['actorId', 'serviceId']);
  });
});

describe('get: editableFields and allowedActions per caller', () => {
  it('computes them from the same table for each kind of reader [ASVS-8.2.3]', async () => {
    const w = await world(h);
    const all = FIELDS.map((f) => f.key);
    const descriptive = all.filter((k) => k !== 'slug' && k !== 'provider');
    const of = async (who: keyof World['people']) => {
      const view = await w.services.get(w.people[who], w.svc.id);
      return { editable: view.editableFields, actions: view.allowedActions };
    };
    expect(await of('admin')).toEqual({ editable: all, actions: ['edit', 'publish'] });
    expect(await of('manager')).toEqual({ editable: all, actions: ['edit'] });
    expect(await of('member')).toEqual({ editable: descriptive, actions: ['edit'] });
    expect(await of('reviewer')).toEqual({ editable: [], actions: ['publish'] });
    for (const who of ['plain', 'requested', 'rejected', 'left', 'managerElsewhere'] as const) {
      expect(await of(who), who).toEqual({ editable: [], actions: [] });
    }
  });

  it('offers unpublish, not publish, for a public service, and no publish while allowPublic is off', async () => {
    const w = await world(h);
    const pub = await makeService(w.pool, { provider: w.provider.id, public: true });
    expect((await w.services.get(w.people.reviewer, pub.id)).allowedActions).toEqual(['unpublish']);
    expect((await w.services.get(w.people.member, pub.id)).allowedActions).toEqual(['edit']);
    await w.configure({ exposeContactPoint: true, allowPublic: false });
    expect((await w.services.get(w.people.reviewer, w.svc.id)).allowedActions).toEqual([]);
    expect((await w.services.get(w.people.reviewer, pub.id)).allowedActions).toEqual(['unpublish']);
  });

  it('is the same list getBySlug returns, and shrinks the moment a manager is demoted', async () => {
    const w = await world(h);
    expect((await w.services.getBySlug(w.people.manager, w.svc.slug)).editableFields).toContain(
      'slug',
    );
    await w.pool.query("update org_membership set role = 'member' where user_id = $1", [
      w.people.manager.userId,
    ]);
    expect((await w.services.getBySlug(w.people.manager, w.svc.slug)).editableFields).not.toContain(
      'slug',
    );
  });
});

describe('the contact point: who sees it', () => {
  async function withContact() {
    const w = await world(h);
    const svc = await makeService(w.pool, {
      provider: w.provider.id,
      contactEmail: 'team@example.org',
      contactType: 'support',
    });
    return { ...w, svc };
  }

  it('shows it to Admin and the provider’s members and managers always, others while the setting is on', async () => {
    const w = await withContact();
    const email = async (who: keyof World['people']) =>
      (await w.services.get(w.people[who], w.svc.id)).contactEmail;
    for (const who of [
      'admin',
      'manager',
      'member',
      'plain',
      'reviewer',
      'requested',
      'managerElsewhere',
    ] as const) {
      expect(await email(who), who).toBe('team@example.org');
    }
  });

  it('shows it only to Admin and the members once the setting is off [ASVS-8.2.3]', async () => {
    const w = await withContact();
    await w.configure({ exposeContactPoint: false, allowPublic: true });
    const view = (who: keyof World['people']) => w.services.get(w.people[who], w.svc.id);
    for (const who of ['admin', 'manager', 'member'] as const) {
      expect(await view(who), who).toMatchObject({
        contactEmail: 'team@example.org',
        contactType: 'support',
      });
    }
    for (const who of [
      'plain',
      'reviewer',
      'requested',
      'rejected',
      'left',
      'managerElsewhere',
    ] as const) {
      const seen = await view(who);
      expect(seen, who).not.toHaveProperty('contactEmail');
      expect(seen, who).not.toHaveProperty('contactType');
    }
    // A member of another service's provider does not see this one's contact point by their membership.
    expect(await w.services.getBySlug(w.people.plain, w.svc.slug)).not.toHaveProperty(
      'contactEmail',
    );
  });

  it('never puts it in a list row, an event or a trusted read', async () => {
    const w = await withContact();
    const { services } = await w.services.list(w.people.admin, {}, { page: 0, pageSize: 50 });
    for (const row of services) expect(JSON.stringify(row)).not.toContain('team@example.org');
    await w.services.update(w.people.member, w.svc.id, {
      contact: { email: 'new@example.org', type: 'support' },
    });
    expect(JSON.stringify(await w.events())).not.toContain('example.org');
    expect(JSON.stringify(await w.services.findByIdsAsSystem([w.svc.id]))).not.toContain(
      'example.org',
    );
  });
});
