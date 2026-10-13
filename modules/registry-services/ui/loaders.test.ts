// What the wizard's loader asks of the API, and of whom: the lists of organisations come from the API for this
// caller (the owning role: the caller's approved memberships, an administrator all organisations of the role's
// types; every other role: all of its types), never guessed from a role in the browser. The API is a stub that
// records its calls.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { loadNewService } from './loaders.ts';
import type { WizardSchema } from './wizard-types.ts';

const schema: WizardSchema = {
  steps: [
    {
      id: 'provision',
      order: 20,
      title: 't',
      intro: [],
      contributed: false,
      schema: {},
      fields: [
        {
          key: 'provider',
          path: '/provider',
          type: 'organisation',
          widget: 'organisation',
          label: 'l',
          required: true,
          config: {},
          role: 'provider',
          deferred: false,
        },
        {
          key: 'consortia',
          path: '/consortia',
          type: 'organisation',
          widget: 'organisation',
          label: 'l',
          required: false,
          config: { multiple: true },
          role: 'consortium',
          deferred: false,
        },
      ],
    },
  ],
  limits: {
    sameAs: 20,
    slug: 64,
    name: 200,
    description: 4000,
    url: 500,
    email: 254,
    contactKind: 64,
    bodyBytes: 65536,
  },
  fieldTypes: [],
  roles: [
    {
      id: 'provider',
      label: 'Provider',
      orgTypes: ['provider'],
      min: 1,
      max: 1,
      order: 10,
      memberOnly: true,
    },
    {
      id: 'consortium',
      label: 'Consortium',
      orgTypes: ['consortium'],
      min: 0,
      max: 20,
      order: 20,
      memberOnly: false,
    },
    {
      id: 'funder',
      label: 'Funder',
      orgTypes: ['funder'],
      min: 0,
      max: 1,
      order: 30,
      memberOnly: false,
    },
  ],
  defaults: {},
  devConsole: true,
};

const org = (id: string, type: string, name = id) => ({
  id,
  type,
  abbreviation: id.toUpperCase(),
  name,
});
const own = [
  { id: 'm1', state: 'approved', role: 'member', organisation: org('ipk', 'provider', 'IPK') },
  { id: 'm2', state: 'requested', role: 'member', organisation: org('wait', 'provider') },
  { id: 'm3', state: 'left', role: 'member', organisation: org('gone', 'provider') },
  { id: 'm4', state: 'approved', role: 'member', organisation: org('nfdi', 'consortium') },
];

function stub(options: {
  permissions: string[];
  denyPermissions?: boolean;
  denySchema?: boolean;
  total?: number;
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
      switch (path) {
        case '/services/schema':
          return options.denySchema ? json(403, undefined) : json(200, schema);
        case '/account/permissions':
          return options.denyPermissions
            ? json(403, undefined)
            : json(200, {
                result: options.permissions.map((id) => ({ id })),
                metadata: { totalCount: options.permissions.length },
              });
        case '/account/memberships':
          return json(200, { result: own, metadata: { totalCount: options.total ?? own.length } });
        case '/organisations': {
          const rows = [org('z-org', query.type!, 'Zeta'), org('a-org', query.type!, 'Alpha')];
          return json(200, {
            result: rows,
            metadata: { totalCount: options.total ?? rows.length },
          });
        }
        default:
          throw new Error(`unexpected call ${path}`);
      }
    },
  };
  return { api: api as unknown as UiLoadContext['api'], calls };
}

const load = (api: UiLoadContext['api']) =>
  loadNewService({
    api,
    locale: 'de',
    params: {},
    url: new URL('http://x/services/new'),
  } as UiLoadContext);

describe('the wizard’s loader', () => {
  it('lists, for a member, only the organisations they are an approved member of, of the role’s type', async () => {
    const { api, calls } = stub({ permissions: ['registry.services.service.create'] });
    const data = await load(api);
    expect(data.organisations.provider!.options).toEqual([
      { id: 'ipk', abbreviation: 'IPK', name: 'IPK' },
    ]);
    // The other roles list every organisation of their types: a member may put a service in any group.
    expect(data.organisations.consortium!.options.map((o) => o.name)).toEqual(['Alpha', 'Zeta']);
    expect(calls).toContain('/account/memberships');
    expect(calls).toContain('/organisations?type=consortium');
    expect(calls).not.toContain('/organisations?type=provider');
  });

  it('lists every organisation of the type for an administrator, by name, and does not ask for memberships', async () => {
    const { api, calls } = stub({
      permissions: ['registry.services.service.create', 'registry.services.service.manage'],
    });
    const data = await load(api);
    expect(data.organisations.provider!.options.map((o) => o.name)).toEqual(['Alpha', 'Zeta']);
    expect(calls).toContain('/organisations?type=provider');
    expect(calls).not.toContain('/account/memberships');
  });

  it('asks only for the roles a field uses', async () => {
    const { api, calls } = stub({ permissions: [] });
    const data = await load(api);
    expect(Object.keys(data.organisations).sort()).toEqual(['consortium', 'provider']);
    expect(calls).not.toContain('/organisations?type=funder');
  });

  it('says when the API holds more than it returned', async () => {
    const { api } = stub({ permissions: ['registry.services.service.manage'], total: 250 });
    const data = await load(api);
    expect(data.organisations.provider!.truncated).toBe(true);
    const small = await load(stub({ permissions: [] }).api);
    expect(small.organisations.provider!.truncated).toBe(false);
  });

  it('treats a caller whom the API will not tell their permissions as one with none, and asks the schema in the caller’s language', async () => {
    const { api, calls } = stub({ permissions: [], denyPermissions: true });
    const data = await load(api);
    expect(data.schema.steps).toHaveLength(1);
    expect(calls[0]).toBe('/services/schema');
    // With no permission to manage, the owning role is the caller's memberships.
    expect(calls).toContain('/account/memberships');
  });

  it('throws when the schema cannot be read: a page error, never a form that draws nothing', async () => {
    const { api } = stub({ permissions: [], denySchema: true });
    await expect(load(api)).rejects.toBeInstanceOf(ApiError);
  });
});
