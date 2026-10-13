// What the loaders of the service page and of the public pages ask of the API, and of whom: an id and an old slug
// are sent on with the shell's redirect (thrown, never returned: defect 12), a plain reader costs no call for
// organisations, a manager's list of owners holds only the organisations they manage (an administrator's all),
// and the public page asks only the public routes. The API is a stub that records its calls.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { loadPublicService, loadService } from './loaders.ts';

const ID = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1aff';

const record = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  slug: 'blast-tool',
  license: 'MIT',
  organisations: [],
  editableFields: [] as string[],
  allowedActions: [],
  ...extra,
});

const schema = {
  steps: [
    {
      id: 'basics',
      fields: [
        { key: 'name', path: '/name', role: undefined },
        { key: 'provider', path: '/provider', role: 'provider' },
        { key: 'consortia', path: '/consortia', role: 'consortium' },
      ],
    },
  ],
  roles: [
    { id: 'provider', label: 'Provider', orgTypes: ['provider'], order: 10, memberOnly: true },
    {
      id: 'consortium',
      label: 'Consortium',
      orgTypes: ['consortium'],
      order: 20,
      memberOnly: false,
    },
  ],
};

const org = (id: string, type: string, name = id) => ({ id, type, abbreviation: id, name });
const memberships = [
  { state: 'approved', role: 'manager', organisation: org('mine', 'provider', 'Mine') },
  { state: 'approved', role: 'member', organisation: org('only-member', 'provider') },
  { state: 'requested', role: 'manager', organisation: org('waiting', 'provider') },
  { state: 'approved', role: 'manager', organisation: org('group-i-run', 'consortium') },
];

class Redirected extends Error {
  path: string;
  constructor(path: string) {
    super(`redirect ${path}`);
    this.path = path;
  }
}

function stub(options: {
  record?: Record<string, unknown>;
  permissions?: string[];
  missing?: boolean;
}) {
  const calls: string[] = [];
  const json = (status: number, data: unknown) =>
    Promise.resolve({
      ...(status < 400 ? { data } : { error: { title: 'x', status } }),
      response: new Response(null, { status }),
    });
  const api = {
    GET: (path: string, init?: { params?: { query?: Record<string, string> } }) => {
      const query = init?.params?.query ?? {};
      calls.push(query.type ? `${path}?type=${query.type}` : path);
      if (options.missing) return json(404, undefined);
      switch (path) {
        case '/services/by-slug/{slug}':
        case '/services/{id}':
        case '/public/services/{ref}':
          return json(200, options.record ?? record());
        case '/services/{id}/schema-org':
        case '/public/services/{ref}/schema-org':
          return json(200, { '@type': 'Service' });
        case '/services/schema':
          return json(200, schema);
        case '/licenses':
          return json(200, {
            result: [
              { id: 'MIT-0', name: 'MIT No Attribution', deprecated: false },
              { id: 'MIT', name: 'MIT License', deprecated: false },
            ],
          });
        case '/account/permissions':
          return json(200, {
            result: (options.permissions ?? []).map((id) => ({ id })),
            metadata: { totalCount: (options.permissions ?? []).length },
          });
        case '/account/memberships':
          return json(200, { result: memberships, metadata: { totalCount: memberships.length } });
        case '/organisations':
          return json(200, {
            result: [org('b', query.type!, 'Beta'), org('a', query.type!, 'Alpha')],
            metadata: { totalCount: 2 },
          });
        default:
          throw new Error(`unexpected call ${path}`);
      }
    },
  };
  return { api: api as unknown as UiLoadContext['api'], calls };
}

const context = (api: UiLoadContext['api'], slug: string): UiLoadContext =>
  ({
    api,
    locale: 'en',
    params: { slug },
    url: new URL(`http://x/services/${slug}`),
    redirect: (path: string) => {
      throw new Redirected(path);
    },
  }) as unknown as UiLoadContext;

const MANAGE = 'registry.services.service.manage';
const whole = ['name', 'provider', 'consortia'];

describe('the loader of the service page', () => {
  it('reads a slug through the by-slug route and an id through the id route', async () => {
    const bySlug = stub({});
    await loadService(context(bySlug.api, 'blast-tool'));
    expect(bySlug.calls[0]).toBe('/services/by-slug/{slug}');
    const byId = stub({});
    await expect(loadService(context(byId.api, ID))).rejects.toMatchObject({
      path: '/services/blast-tool',
    });
    expect(byId.calls).toEqual(['/services/{id}']);
  });

  it('throws the redirect to the current address for an old slug, a case variant and an id; nothing else is asked first', async () => {
    for (const asked of ['old-name', 'Blast-Tool', ID]) {
      const { api, calls } = stub({ record: record({ redirectedFrom: 'old-name' }) });
      await expect(loadService(context(api, asked)), asked).rejects.toMatchObject({
        path: '/services/blast-tool',
      });
      expect(calls, asked).toHaveLength(1);
    }
  });

  it('encodes the slug it redirects to', async () => {
    const { api } = stub({ record: record({ slug: 'a.b_c-d' }) });
    await expect(loadService(context(api, 'old'))).rejects.toMatchObject({
      path: '/services/a.b_c-d',
    });
  });

  it('asks for a plain reader the record, the profile, the schema and the licence, and no organisation', async () => {
    const { api, calls } = stub({});
    const data = await loadService(context(api, 'blast-tool'));
    expect(calls.sort()).toEqual(
      [
        '/licenses',
        '/services/by-slug/{slug}',
        '/services/schema',
        '/services/{id}/schema-org',
      ].sort(),
    );
    expect(data.organisations).toEqual({});
    // The licence as words: the entry with this id, not the first match.
    expect(data.licence).toEqual({ id: 'MIT', name: 'MIT License', deprecated: false });
  });

  it('shows a licence the list no longer holds by its id, and none for a service without one', async () => {
    const unknown = await loadService(
      context(stub({ record: record({ license: 'Gone-1.0' }) }).api, 'blast-tool'),
    );
    expect(unknown.licence).toEqual({ id: 'Gone-1.0', name: 'Gone-1.0', deprecated: false });
    const none = stub({ record: record({ license: null }) });
    expect((await loadService(context(none.api, 'blast-tool'))).licence).toBeNull();
    expect(none.calls).not.toContain('/licenses');
  });

  it('lists for a member, who may change the groups only, all organisations of their types and asks no memberships', async () => {
    const { api, calls } = stub({ record: record({ editableFields: ['name', 'consortia'] }) });
    const data = await loadService(context(api, 'blast-tool'));
    expect(Object.keys(data.organisations)).toEqual(['consortium']);
    expect(data.organisations.consortium!.options.map((o) => o.name)).toEqual(['Alpha', 'Beta']);
    expect(calls).toContain('/organisations?type=consortium');
    expect(calls).not.toContain('/account/memberships');
    expect(calls).not.toContain('/account/permissions');
  });

  it('lists for a manager, as the owner to move to, only the organisations they manage, an approved row of the role', async () => {
    const { api, calls } = stub({ record: record({ editableFields: whole }) });
    const data = await loadService(context(api, 'blast-tool'));
    expect(data.organisations.provider!.options.map((o) => o.id)).toEqual(['mine']);
    expect(calls).toContain('/account/memberships');
    expect(calls).not.toContain('/organisations?type=provider');
    expect(data.organisations.consortium!.options.map((o) => o.name)).toEqual(['Alpha', 'Beta']);
  });

  it('lists for an administrator every organisation of the owner’s type, and asks no memberships', async () => {
    const { api, calls } = stub({
      record: record({ editableFields: whole }),
      permissions: [MANAGE],
    });
    const data = await loadService(context(api, 'blast-tool'));
    expect(data.organisations.provider!.options.map((o) => o.name)).toEqual(['Alpha', 'Beta']);
    expect(calls).not.toContain('/account/memberships');
  });

  it('throws the API’s 404 for an unknown service: a page error, never an empty page', async () => {
    await expect(loadService(context(stub({ missing: true }).api, 'nope'))).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe('the loader of the public service page', () => {
  it('asks only the two public routes, in parallel, and returns what they answered', async () => {
    const { api, calls } = stub({ record: record({ slug: 'blast-tool' }) });
    const data = await loadPublicService(context(api, 'blast-tool'));
    expect(calls.sort()).toEqual(['/public/services/{ref}', '/public/services/{ref}/schema-org']);
    expect(data.service.slug).toBe('blast-tool');
  });

  it('sends an id or an old slug on to the current public address', async () => {
    for (const asked of [ID, 'old-name']) {
      const { api } = stub({ record: record() });
      await expect(loadPublicService(context(api, asked)), asked).rejects.toMatchObject({
        path: '/public/services/blast-tool',
      });
    }
  });

  it('throws the API’s 404, the one every non-public record gets', async () => {
    await expect(
      loadPublicService(context(stub({ missing: true }).api, 'nope')),
    ).rejects.toMatchObject({ status: 404 });
  });
});
