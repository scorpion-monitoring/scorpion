// The contract-test harness itself (packages/testing/src/v1-contract.ts), proved on a fixture list route
// through the whole pipeline: it passes a route that keeps the contract and fails ones that break it.
// This file is not a `*.contract.test.ts`: `GET /things` is no route of any profile.
import { createRoute, z, type AppRoute } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import {
  expectEnvelope,
  expectReplyMatchesRoute,
  expectStableOrder,
  v1ContractTests,
  type V1ContractContext,
  type V1Reply,
} from '@scorpion/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_USER_SCOPES, useIdentityApp } from './testing/identity-app.ts';

const READ = 'fix.things.v1.read';
const OTHER = 'fix.things.v1.other';
const ROWS = ['delta', 'alpha', 'charlie', 'bravo', 'echo'].map((slug, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  slug,
}));
// Two rows share a slug, to prove that the id breaks the tie.
ROWS.push({ id: '00000000-0000-4000-8000-0000000000ff', slug: 'alpha' });
const sorted = [...ROWS].sort((a, b) => a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id));

const row = z.object({ id: z.string(), slug: z.string() });
const things = createRoute({
  method: 'get',
  path: '/things',
  permission: READ,
  audit: true,
  request: {
    query: z.object({
      page: z.coerce.number().int().min(0).default(0),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: {
      description: 'The things',
      content: {
        'application/json': {
          schema: z.object({
            metadata: z.object({
              currentPage: z.number(),
              pageSize: z.number(),
              totalCount: z.number(),
              totalPages: z.number(),
            }),
            result: z.array(row),
          }),
        },
      },
    },
  },
});
const fixture = {
  id: 'fix.things',
  manifest: defineModule({
    id: 'fix.things',
    version: '1.0.0',
    permissions: {
      [READ]: { description: 'read the fixture things' },
      [OTHER]: { description: 'another permission' },
    },
    routes: (r) => {
      r.public('v1', things, ((c: {
        req: { valid: (t: 'query') => { page: number; pageSize: number } };
        json: (b: unknown) => Response;
      }) => {
        const { page, pageSize } = c.req.valid('query');
        return c.json({
          metadata: {
            currentPage: page,
            pageSize,
            totalCount: sorted.length,
            totalPages: Math.ceil(sorted.length / pageSize),
          },
          result: sorted.slice(page * pageSize, (page + 1) * pageSize),
        });
      }) as never);
    },
  }),
};

const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
let token = '';
let tokenWithoutScope = '';
beforeAll(async () => {
  started = await app.start({
    extraModules: [fixture],
    permissions: [...ALL_USER_SCOPES, READ, OTHER],
    tokenCacheTtlMs: 0,
  });
  const who = await started.signedIn('contract-user');
  const make = async (scopes: string[]) =>
    (
      (await started.post('/tokens', { ...who, body: { name: `c-${scopes[0]}`, scopes } }))
        .body as { token: string }
    ).token;
  token = await make([READ]);
  tokenWithoutScope = await make([OTHER]);
});

const context = (): V1ContractContext => ({
  call: async ({ method, path, headers }) => {
    const reply = await started.call(method, path, { v1: true, headers, peer: '198.51.100.77' });
    return { status: reply.status, headers: reply.res.headers, body: reply.body };
  },
  get token() {
    return token;
  },
  get tokenWithoutScope() {
    return tokenWithoutScope;
  },
  list: { sortKey: (r) => String(r.slug) },
});

// The route passes the standard cases, the list ones included.
v1ContractTests(things, context());

describe('the harness fails a route that breaks the contract', () => {
  const reply = (body: unknown, status = 200, type = 'application/json'): V1Reply => ({
    status,
    headers: new Headers({ 'content-type': type, 'x-request-id': 'abc12345' }),
    body,
  });
  const metadata = { currentPage: 0, pageSize: 2, totalCount: 3, totalPages: 2 };

  it('refuses a body its schema does not describe, an undeclared status and a wrong content type', () => {
    const route = things as unknown as AppRoute;
    expect(() =>
      expectReplyMatchesRoute(route, reply({ metadata, result: [{ id: 1 }] })),
    ).toThrow();
    expect(() => expectReplyMatchesRoute(route, reply({}, 418))).toThrow();
    expect(() =>
      expectReplyMatchesRoute(route, reply({ metadata, result: [] }, 200, 'text/html')),
    ).toThrow();
    expect(() =>
      expectReplyMatchesRoute(route, reply({ metadata, result: [{ id: 'a', slug: 'b' }] })),
    ).not.toThrow();
  });

  it('refuses an envelope with a missing key, a 1-based page, a wrong totalPages or too many rows', () => {
    const ok = { metadata, result: [{ id: 'a' }, { id: 'b' }] };
    expect(() => expectEnvelope(ok)).not.toThrow();
    expect(() => expectEnvelope({ ...ok, extra: 1 })).toThrow();
    expect(() =>
      expectEnvelope({ metadata: { ...metadata, totalPages: 3 }, result: ok.result }),
    ).toThrow();
    expect(() =>
      expectEnvelope({ metadata: { ...metadata, pageSize: 1 }, result: ok.result }),
    ).toThrow();
    expect(() =>
      expectEnvelope({ metadata: { ...metadata, currentPage: 2 }, result: ok.result }),
    ).toThrow();
    expect(() =>
      expectEnvelope({
        metadata: { ...metadata, currentPage: 1 },
        result: [{ id: 'a' }, { id: 'b' }],
      }),
    ).toThrow();
  });

  it('refuses an order that is not key-then-id', () => {
    const rows = [
      { id: '2', slug: 'a' },
      { id: '1', slug: 'a' },
    ];
    expect(() => expectStableOrder(rows, (r) => String(r.slug))).toThrow();
    expect(() => expectStableOrder([...rows].reverse(), (r) => String(r.slug))).not.toThrow();
  });
});
