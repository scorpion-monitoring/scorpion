// Every method of the service layer against real Postgres: the real authoriser decides, events travel
// through the real outbox. Each method has a denied case; the multi-row write has rollback cases.
import { Forbidden, Invalid, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useServices } from '../test/harness.ts';

const h = useServices();
const anonymous: Actor = { kind: 'anonymous' };
const PAGE = { page: 0, pageSize: 50 };

let sequence = 0;
/** A slug and a name that no other test of this file uses. */
const uniq = (prefix = 'svc') =>
  `${prefix}-${++sequence}-${Math.random().toString(36).slice(2, 7)}`;

async function setup(options?: Parameters<typeof h.start>[0]) {
  const s = await h.start(options);
  const admin = await s.actor('admin');
  const user = await s.actor('user');
  const reviewer = await s.actor('reviewer');
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const consortium = await makeOrganisation(s.pool, { type: 'consortium' });
  const body = (over: Record<string, unknown> = {}) => ({
    slug: uniq(),
    name: uniq('Name'),
    provider: provider.id,
    ...over,
  });
  return { ...s, admin, user, reviewer, provider, consortium, body };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const counts = async (pool: Setup['pool']) =>
  (
    await pool.query<Record<string, number>>(`select
      (select count(*)::int from svc_service) as service,
      (select count(*)::int from svc_service_organisation) as links,
      (select count(*)::int from svc_slug_history) as history,
      (select count(*)::int from svc_field_value) as fields`)
  ).rows[0]!;
const EMPTY = { service: 0, links: 0, history: 0, fields: 0 };

describe('create', () => {
  it('creates the service with its organisations, its slug history and its event in one go', async () => {
    const { services, admin, provider, consortium, pool, events, body } = await setup();
    const input = body({
      slug: 'Galaxy-EU',
      name: '  Galaxy   EU ',
      license: 'apache-2.0',
      stage: 'PROD',
      description: 'A workflow platform.',
      url: 'https://galaxy.example/',
      sameAs: ['https://doi.org/10.1/x'],
      consortia: [consortium.id],
      contact: { email: 'ops@galaxy.example', type: 'Support' },
    });
    const created = await services.create(admin, input);
    expect(created).toMatchObject({
      slug: 'Galaxy-EU',
      name: 'Galaxy EU',
      license: 'Apache-2.0',
      stage: 'PROD',
      description: 'A workflow platform.',
      url: 'https://galaxy.example',
      sameAs: ['https://doi.org/10.1/x'],
      public: false,
      contactEmail: 'ops@galaxy.example',
      contactType: 'Support',
      values: {},
      createdBy: admin.userId,
      updatedBy: admin.userId,
    });
    expect(created.organisations).toEqual([
      {
        role: 'provider',
        id: provider.id,
        abbreviation: provider.abbreviation,
        name: provider.name,
      },
      {
        role: 'consortium',
        id: consortium.id,
        abbreviation: consortium.abbreviation,
        name: consortium.name,
      },
    ]);
    expect(await counts(pool)).toEqual({ service: 1, links: 2, history: 1, fields: 0 });
    const history = (await pool.query('select slug, service_id from svc_slug_history')).rows;
    expect(history).toEqual([{ slug: 'Galaxy-EU', service_id: created.id }]);
    expect(await events()).toEqual([
      {
        name: 'registry.service.created@1',
        payload: { serviceId: created.id, by: 'admin', actorId: admin.userId },
      },
    ]);
    // The service answers by id and by slug.
    expect((await services.get(admin, created.id)).slug).toBe('Galaxy-EU');
    expect((await services.getBySlug(admin, 'galaxy-eu')).id).toBe(created.id);
  });

  it('defaults the stage to DEV and keeps a service without a licence, description or consortium', async () => {
    const { services, admin, body } = await setup();
    const created = await services.create(admin, body());
    expect(created).toMatchObject({
      stage: 'DEV',
      license: null,
      description: null,
      url: null,
      sameAs: [],
      contactEmail: null,
      contactType: null,
    });
    expect(created.organisations.map((o) => o.role)).toEqual(['provider']);
  });

  it('puts no value, address or URL in the event', async () => {
    const { services, admin, body, events } = await setup();
    await services.create(
      admin,
      body({
        description: 'secret description',
        url: 'https://secret.example',
        contact: { email: 'secret@example.org', type: 'Support' },
      }),
    );
    expect(JSON.stringify(await events())).not.toMatch(/secret/);
  });

  it('is denied to a plain user, a Reviewer, a person without roles and an anonymous caller, and writes nothing', async () => {
    const { services, user, reviewer, actor, pool, body } = await setup();
    await expect(services.create(user, body())).rejects.toBeInstanceOf(Forbidden);
    await expect(services.create(reviewer, body())).rejects.toBeInstanceOf(Forbidden);
    await expect(services.create(await actor(), body())).rejects.toBeInstanceOf(Forbidden);
    await expect(services.create(anonymous, body())).rejects.toBeInstanceOf(Unauthorized);
    expect(await counts(pool)).toEqual(EMPTY);
  });

  it.each([
    ['a duplicate slug', (slug: string) => slug],
    ['a duplicate slug that differs in case only', (slug: string) => slug.toUpperCase()],
  ])('answers 409 for %s and leaves the first service alone', async (_label, change) => {
    const { services, admin, body, pool } = await setup();
    const first = body({ slug: 'dup-slug' });
    await services.create(admin, first);
    const error = await services.create(admin, body({ slug: change('dup-slug') })).catch((e) => e);
    expect(error).toMatchObject({
      status: 409,
      type: 'slug-taken',
      errors: [{ in: 'body', path: 'slug' }],
    });
    expect(await counts(pool)).toEqual({ service: 1, links: 1, history: 1, fields: 0 });
  });

  it('answers 409 for a slug that an existing service once had, and the old holder keeps it', async () => {
    const { services, admin, body, pool, provider } = await setup();
    const old = await makeService(pool, {
      slug: 'new-name',
      oldSlugs: ['old-name'],
      provider: provider.id,
    });
    await expect(services.create(admin, body({ slug: 'Old-Name' }))).rejects.toMatchObject({
      status: 409,
      type: 'slug-taken',
    });
    expect((await services.getBySlug(admin, 'old-name')).id).toBe(old.id);
  });

  it('lets two creates for one slug race: one wins, the other gets 409, one service exists', async () => {
    const { services, admin, body, pool } = await setup();
    const results = await Promise.allSettled([
      services.create(admin, body({ slug: 'race-slug' })),
      services.create(admin, body({ slug: 'RACE-slug' })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, type: 'slug-taken' });
    expect(await counts(pool)).toEqual({ service: 1, links: 1, history: 1, fields: 0 });
  });

  describe('answers 422, never 500, for what refers to nothing', () => {
    it('an organisation that does not exist, at the field', async () => {
      const { services, admin, body, pool } = await setup();
      const ghost = '0198f9c0-1234-7abc-8def-0123456789ab';
      await expect(services.create(admin, body({ provider: ghost }))).rejects.toMatchObject({
        status: 422,
        errors: [{ in: 'body', path: 'provider', message: 'This is not a known organisation.' }],
      });
      expect(await counts(pool)).toEqual(EMPTY);
    });

    it('a consortium that does not exist, at its index in the list; nothing is left', async () => {
      const { services, admin, body, pool, consortium } = await setup();
      const ghost = '0198f9c0-1234-7abc-8def-0123456789ab';
      await expect(
        services.create(admin, body({ consortia: [consortium.id, ghost] })),
      ).rejects.toMatchObject({ status: 422, errors: [{ path: 'consortia.1' }] });
      expect(await counts(pool)).toEqual(EMPTY);
    });

    it('an organisation of a type the role does not accept, naming the role from the registry', async () => {
      const { services, admin, body, consortium } = await setup();
      const error = await services.create(admin, body({ provider: consortium.id })).catch((e) => e);
      expect(error).toMatchObject({ status: 422, errors: [{ path: 'provider' }] });
      expect(error.errors[0].message).toBe('This organisation cannot take the role "Provider".');
    });

    it('a missing provider, and a provider given twice is the same single value', async () => {
      const { services, admin, body } = await setup();
      const { provider: _omitted, ...without } = body();
      await expect(services.create(admin, without)).rejects.toMatchObject({
        status: 422,
        errors: [{ path: 'provider', message: 'This field is required.' }],
      });
      await expect(services.create(admin, body({ provider: null }))).rejects.toMatchObject({
        status: 422,
      });
      await expect(services.create(admin, body({ provider: ['x'] }))).rejects.toMatchObject({
        status: 422,
      });
    });

    it('a provider id that is no UUID', async () => {
      const { services, admin, body } = await setup();
      await expect(services.create(admin, body({ provider: 'IPK' }))).rejects.toMatchObject({
        status: 422,
        errors: [{ path: 'provider' }],
      });
    });

    it('a stage that is not a term of the vocabulary', async () => {
      const { services, admin, body, pool } = await setup();
      await expect(services.create(admin, body({ stage: 'BETA' }))).rejects.toMatchObject({
        status: 422,
        errors: [{ path: 'stage', message: '"BETA" is not an available term of "stage".' }],
      });
      expect(await counts(pool)).toEqual(EMPTY);
    });

    it('a licence that is not an SPDX id', async () => {
      const { services, admin, body } = await setup();
      await expect(
        services.create(admin, body({ license: 'Proprietary-X' })),
      ).rejects.toMatchObject({ status: 422, errors: [{ path: 'license' }] });
    });

    it('a bad slug, name, URL, link and contact point, all at once', async () => {
      const { services, admin, provider } = await setup();
      const error = await services
        .create(admin, {
          slug: '123e4567-e89b-42d3-a456-426614174000',
          name: '',
          provider: provider.id,
          url: 'javascript:alert(1)',
          sameAs: ['ftp://x'],
          contact: { email: 'a@b.example' },
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(Invalid);
      expect(error.errors.map((e: { path: string }) => e.path).sort()).toEqual([
        'contact.type',
        'name',
        'sameAs',
        'slug',
        'url',
      ]);
    });

    it('a key that no field owns', async () => {
      const { services, admin, body } = await setup();
      await expect(services.create(admin, body({ public: true }))).rejects.toMatchObject({
        status: 422,
        errors: [{ path: 'public' }],
      });
    });
  });

  it('accepts a deprecated licence id', async () => {
    const { services, admin, body } = await setup();
    const created = await services.create(admin, body({ license: 'GPL-2.0' }));
    expect(created.license).toBe('GPL-2.0');
  });

  it('rolls everything back when the event cannot be stored: no service, link, history or value is left', async () => {
    const { services, admin, body, pool, consortium } = await setup();
    const undo = await breakOutbox(pool);
    await expect(services.create(admin, body({ consortia: [consortium.id] }))).rejects.toThrow();
    await undo();
    expect(await counts(pool)).toEqual(EMPTY);
  });
});

describe('get and getBySlug', () => {
  it('lets a plain user and a Reviewer read; denies a person without roles and an anonymous caller', async () => {
    const { services, user, reviewer, actor, pool, provider } = await setup();
    const row = await makeService(pool, { provider: provider.id });
    expect((await services.get(user, row.id)).id).toBe(row.id);
    expect((await services.get(reviewer, row.id)).id).toBe(row.id);
    await expect(services.get(await actor(), row.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(services.get(anonymous, row.id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(services.getBySlug(await actor(), row.slug)).rejects.toBeInstanceOf(Forbidden);
    await expect(services.getBySlug(anonymous, row.slug)).rejects.toBeInstanceOf(Unauthorized);
  });

  it('answers 404 for an unknown id and slug, and 422 for an id that is no UUID', async () => {
    const { services, user } = await setup();
    await expect(services.get(user, '0198f9c0-1234-7abc-8def-0123456789ab')).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(services.get(user, 'galaxy')).rejects.toMatchObject({
      status: 422,
      errors: [{ in: 'path', path: 'id' }],
    });
    for (const slug of ['nobody', '', '   ', 'x'.repeat(500), "x'; drop table svc_service;--"]) {
      await expect(services.getBySlug(user, slug)).rejects.toBeInstanceOf(NotFound);
    }
  });

  it('answers an old slug with the current record and `redirectedFrom`, and ignores a change of case', async () => {
    const { services, user, pool, provider } = await setup();
    const row = await makeService(pool, {
      slug: 'galaxy-eu',
      oldSlugs: ['galaxy', 'usegalaxy'],
      provider: provider.id,
    });
    const viaOld = await services.getBySlug(user, 'UseGalaxy');
    expect(viaOld).toMatchObject({ id: row.id, slug: 'galaxy-eu', redirectedFrom: 'usegalaxy' });
    const current = await services.getBySlug(user, 'GALAXY-EU');
    expect(current.id).toBe(row.id);
    expect(current.redirectedFrom).toBeUndefined();
  });

  it('shows the contact point by the setting, always to an administrator, and the audit columns to an administrator only', async () => {
    const { services, admin, user, pool, provider, configure } = await setup();
    const row = await makeService(pool, {
      provider: provider.id,
      contactEmail: 'ops@galaxy.example',
      contactType: 'Support',
      createdBy: admin.userId,
    });
    expect(await services.get(user, row.id)).toMatchObject({
      contactEmail: 'ops@galaxy.example',
      contactType: 'Support',
    });
    expect(await services.get(user, row.id)).not.toHaveProperty('createdBy');
    expect(await services.get(admin, row.id)).toHaveProperty('createdBy', admin.userId);
    await configure({ exposeContactPoint: false, allowPublic: true });
    const hidden = await services.get(user, row.id);
    expect(hidden).not.toHaveProperty('contactEmail');
    expect(hidden).not.toHaveProperty('contactType');
    expect(await services.get(admin, row.id)).toMatchObject({ contactEmail: 'ops@galaxy.example' });
    expect(JSON.stringify(await services.getBySlug(user, row.slug))).not.toContain(
      'galaxy.example',
    );
  });

  it('answers the values of configured fields and the icon path below the base path', async () => {
    const { services, user, pool, provider } = await setup();
    const row = await makeService(pool, {
      provider: provider.id,
      values: { note: { a: 1 } },
      iconBlobId: '0198f9c0-1234-7abc-8def-0123456789ab',
      iconHash: 'abc123',
    });
    const view = await services.get(user, row.id);
    expect(view.values).toEqual({ note: { a: 1 } });
    expect(view.iconUrl).toBe('/api/internal/files/abc123');
  });
});

describe('list', () => {
  it('lets a plain user read, sorted by name then id, with the total', async () => {
    const { services, user, pool, provider } = await setup();
    await makeService(pool, { name: 'beta', provider: provider.id });
    await makeService(pool, { name: 'Alpha', provider: provider.id });
    await makeService(pool, { name: 'Gamma', provider: provider.id });
    const { services: list, total } = await services.list(user, {}, PAGE);
    expect(list.map((s) => s.name)).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(total).toBe(3);
    expect(list[0]!.organisations.map((o) => o.role)).toEqual(['provider']);
  });

  it('shows no description, link or contact point in a row', async () => {
    const { services, user, pool, provider } = await setup();
    await makeService(pool, {
      provider: provider.id,
      description: 'private words',
      sameAs: ['https://x.example'],
      contactEmail: 'a@b.example',
      contactType: 'Support',
    });
    const { services: list } = await services.list(user, {}, PAGE);
    expect(Object.keys(list[0]!).sort()).toEqual(
      ['id', 'license', 'name', 'organisations', 'public', 'slug', 'stage'].sort(),
    );
  });

  it('searches slug and name without case, and takes % _ and \\ as text', async () => {
    const { services, user, pool, provider } = await setup();
    await makeService(pool, { slug: 'galaxy', name: 'Galaxy', provider: provider.id });
    await makeService(pool, { slug: 'a_b', name: 'Underscore', provider: provider.id });
    await makeService(pool, { slug: 'axb', name: 'Other', provider: provider.id });
    await makeService(pool, { slug: 'pct', name: '100% sure', provider: provider.id });
    const names = async (q: string) =>
      (await services.list(user, { q }, PAGE)).services.map((s) => s.name);
    expect(await names('GALAX')).toEqual(['Galaxy']);
    expect(await names('a_b')).toEqual(['Underscore']);
    expect(await names('100%')).toEqual(['100% sure']);
    expect(await names('\\')).toEqual([]);
    expect(await names('  ')).toHaveLength(4);
  });

  it('sorts by slug and by stage in either direction with the id as the tie-break', async () => {
    const { services, user, pool, provider } = await setup();
    const a = await makeService(pool, {
      slug: 'a',
      name: 'X',
      stage: 'PROD',
      provider: provider.id,
    });
    const b = await makeService(pool, {
      slug: 'B',
      name: 'X',
      stage: 'DEV',
      provider: provider.id,
    });
    const c = await makeService(pool, {
      slug: 'c',
      name: 'X',
      stage: 'DEV',
      provider: provider.id,
    });
    const slugs = async (filter: Parameters<typeof services.list>[1]) =>
      (await services.list(user, filter, PAGE)).services.map((s) => s.slug);
    expect(await slugs({ sort: 'slug' })).toEqual(['a', 'B', 'c']);
    expect(await slugs({ sort: 'slug', dir: 'desc' })).toEqual(['c', 'B', 'a']);
    const byStage = await slugs({ sort: 'stage' });
    const devs = [b, c].sort((x, y) => x.id.localeCompare(y.id)).map((r) => r.slug);
    expect(byStage).toEqual([...devs, a.slug]);
    // All three share one name: the id decides, the same on every page.
    const ids = [a, b, c].map((r) => r.id).sort();
    expect((await services.list(user, { sort: 'name' }, PAGE)).services.map((s) => s.id)).toEqual(
      ids,
    );
  });

  it('pages without losing or repeating a row', async () => {
    const { services, user, pool, provider } = await setup();
    for (let i = 0; i < 7; i++) await makeService(pool, { name: `n${i}`, provider: provider.id });
    const seen: string[] = [];
    for (let page = 0; page < 3; page++) {
      const result = await services.list(user, {}, { page, pageSize: 3 });
      expect(result.total).toBe(7);
      seen.push(...result.services.map((s) => s.name));
    }
    expect(seen).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect((await services.list(user, {}, { page: 5, pageSize: 3 })).services).toEqual([]);
  });

  it('lists a service with no consortium, one, and several once each', async () => {
    const { services, user, pool, provider } = await setup();
    const c1 = await makeOrganisation(pool, { type: 'consortium' });
    const c2 = await makeOrganisation(pool, { type: 'consortium' });
    await makeService(pool, { name: 'none', provider: provider.id });
    await makeService(pool, { name: 'one', provider: provider.id, consortia: [c1.id] });
    await makeService(pool, { name: 'two', provider: provider.id, consortia: [c1.id, c2.id] });
    const { services: list, total } = await services.list(user, {}, PAGE);
    expect(total).toBe(3);
    expect(
      list.map((s) => [s.name, s.organisations.filter((o) => o.role === 'consortium').length]),
    ).toEqual([
      ['none', 0],
      ['one', 1],
      ['two', 2],
    ]);
  });

  it('is denied to a person without roles and an anonymous caller', async () => {
    const { services, actor } = await setup();
    await expect(services.list(await actor(), {}, PAGE)).rejects.toBeInstanceOf(Forbidden);
    await expect(services.list(anonymous, {}, PAGE)).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe('the licence search and the roles', () => {
  it('searches the SPDX list for a reader, deprecated ids marked', async () => {
    const { services, user, actor } = await setup();
    const found = await services.searchLicences(user, 'GPL-2.0');
    expect(found.find((l) => l.id === 'GPL-2.0')).toMatchObject({ deprecated: true });
    expect((await services.searchLicences(user, 'apache-2.0', 1))[0]!.id).toBe('Apache-2.0');
    await expect(services.searchLicences(await actor(), 'mit')).rejects.toBeInstanceOf(Forbidden);
    await expect(services.searchLicences(anonymous, 'mit')).rejects.toBeInstanceOf(Unauthorized);
  });

  it('lists the roles from the registry with localised labels', async () => {
    const { services, user, actor } = await setup();
    expect(await services.listRoles(user, 'de')).toEqual([
      expect.objectContaining({
        id: 'provider',
        label: 'Anbieter',
        min: 1,
        max: 1,
        orgTypes: ['provider'],
      }),
      expect.objectContaining({ id: 'consortium', label: 'Konsortium', min: 0, max: 20 }),
    ]);
    expect((await services.listRoles(user, 'fr'))[0]!.label).toBe('Provider');
    await expect(services.listRoles(await actor())).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('the trusted reads', () => {
  it('answer without a permission check, with the descriptive fields and the organisation ids only', async () => {
    const { services, pool, provider, consortium } = await setup();
    const row = await makeService(pool, {
      slug: 'galaxy-eu',
      oldSlugs: ['galaxy'],
      provider: provider.id,
      consortia: [consortium.id],
      contactEmail: 'ops@galaxy.example',
      contactType: 'Support',
      description: 'About',
      values: { x: 1 },
      createdBy: '0198f9c0-1234-7abc-8def-0123456789ab',
    });
    const [record] = await services.findByIdsAsSystem([row.id, row.id, 'not-a-uuid']);
    expect(record).toEqual({
      id: row.id,
      slug: 'galaxy-eu',
      name: row.name,
      stage: 'PROD',
      license: null,
      description: 'About',
      url: null,
      sameAs: [],
      public: false,
      organisations: [
        { role: 'provider', id: provider.id },
        { role: 'consortium', id: consortium.id },
      ],
      values: { x: 1 },
    });
    expect(JSON.stringify(record)).not.toMatch(/galaxy\.example|createdBy|0198f9c0/);
    expect(await services.findBySlugAsSystem('GALAXY-EU')).toMatchObject({ id: row.id });
    expect(await services.findBySlugAsSystem('galaxy')).toMatchObject({
      id: row.id,
      redirectedFrom: 'galaxy',
    });
    expect(await services.findBySlugAsSystem('nobody')).toBeUndefined();
    expect(await services.existsAsSystem(row.id)).toBe(true);
    expect(await services.existsAsSystem('0198f9c0-1234-7abc-8def-0123456789ab')).toBe(false);
    expect(await services.existsAsSystem('x')).toBe(false);
    expect(await services.findByIdsAsSystem([])).toEqual([]);
  });

  it('list the services of an organisation, once each, optionally by role', async () => {
    const { services, pool, provider, consortium } = await setup();
    const a = await makeService(pool, { provider: provider.id, consortia: [consortium.id] });
    const b = await makeService(pool, { provider: provider.id });
    const c = await makeService(pool, { consortia: [consortium.id] });
    const ids = (records: { id: string }[]) => records.map((r) => r.id).sort();
    expect(ids(await services.listByOrganisationAsSystem(provider.id))).toEqual(
      [a.id, b.id].sort(),
    );
    expect(ids(await services.listByOrganisationAsSystem(consortium.id))).toEqual(
      [a.id, c.id].sort(),
    );
    expect(ids(await services.listByOrganisationAsSystem(consortium.id, 'provider'))).toEqual([]);
    expect(await services.listByOrganisationAsSystem('x')).toEqual([]);
  });
});
