// The contract-test harness of the public API (v1), M8 sprint 1. A v1 route is tested against **its own
// schema**: the zod schema its `createRoute()` declares for the status that came back, which is the one
// the generated OpenAPI document describes. Every module that registers a v1 route (providers and
// services in M8, categories and indicators in M9, measurements in M10) calls `v1ContractTests()` in a
// file named `*.contract.test.ts`, and `v1RoutesWithoutContractTest()` fails a route that has none.
//
//     v1ContractTests(listProviders, {
//       call: (r) => app.v1(r.method, r.path, r.headers),   // path is relative to /api/v1
//       token, tokenWithoutScope,
//       list: { sortKey: (row) => row.abbreviation },
//     });
//
// What it checks for every route: it is never public (unless `publicReason` names the exception), 401
// without a token and for a made-up one, 403 for a valid token that lacks the scope, 200 for `Authorization:
// Bearer` and the same answer for `X-API-Key`, and the answer matches the declared schema and content
// type. For a list route (`list`): the legacy envelope with 0-based pages, `totalPages`, a stable order
// (key, then id) that holds across pages, the last page, a page past the end (empty, same metadata) and a
// `pageSize` larger than the total (defect 15).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describeRoute, type AppRoute } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';

export interface V1Reply {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface V1Request {
  method: string;
  /** Relative to `/api/v1`, with the query string: `/providers?is_member=true`. */
  path: string;
  headers: Record<string, string>;
}

export interface V1ContractContext {
  /** Sends the request to the application under test. */
  call: (request: V1Request) => Promise<V1Reply>;
  /** A token that holds the route's permission (and whose owner holds it too). */
  token: string;
  /** A valid token without the route's scope. */
  tokenWithoutScope: string;
  /** Values for the `{name}` parts of the path. */
  params?: Record<string, string>;
  /** The query of the successful call. */
  query?: Record<string, string>;
  /** Present for a list route. */
  list?: {
    /** The sort key of a row, which the order is checked on, then the `id` (or `idOf(row)`). Default: the row's `id`. */
    sortKey?: (row: Record<string, unknown>) => string;
    idOf?: (row: Record<string, unknown>) => string;
    /** Query parameter names; defaults `page` and `pageSize`. */
    pageParam?: string;
    pageSizeParam?: string;
  };
  /** The route is `public: true` on purpose (ADR-0037: only the spec). The auth cases are skipped. */
  publicReason?: string;
}

export function pathOf(route: Pick<AppRoute, 'path'>, ctx: V1ContractContext, query = ctx.query) {
  const path = route.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = ctx.params?.[name];
    if (value === undefined) throw new Error(`no value for {${name}} of ${route.path}`);
    return encodeURIComponent(value);
  });
  const qs = new URLSearchParams(query).toString();
  return qs ? `${path}?${qs}` : path;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const isZod = (
  value: unknown,
): value is { safeParse(v: unknown): { success: boolean; error?: unknown } } =>
  value !== null && typeof value === 'object' && 'safeParse' in value;

/**
 * Fails when the reply is not one the route declares: an undeclared status, a content type that is not
 * declared for it, or a body that its schema refuses. Returns the parsed body.
 */
export function expectReplyMatchesRoute(route: AppRoute, reply: V1Reply): unknown {
  const responses = (route.responses ?? {}) as Record<
    string,
    { content?: Record<string, { schema?: unknown }> } | undefined
  >;
  const declared = responses[String(reply.status)];
  expect(
    declared,
    `${describeRoute(route)} answered ${reply.status}, which it does not declare`,
  ).toBeDefined();
  const type = (reply.headers.get('content-type') ?? '').split(';')[0]!.trim();
  const content = declared?.content;
  if (content && Object.keys(content).length > 0) {
    expect(Object.keys(content), `content type ${type} of ${reply.status}`).toContain(type);
    const schema = content[type]?.schema;
    if (isZod(schema)) {
      const parsed = schema.safeParse(reply.body);
      expect(
        parsed.success,
        `${describeRoute(route)} ${reply.status} body: ${JSON.stringify(parsed.error)}`,
      ).toBe(true);
    }
  }
  expect(reply.headers.get('x-request-id'), 'every answer carries X-Request-Id').toBeTruthy();
  return reply.body;
}

export interface Envelope {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: Record<string, unknown>[];
}

/** The legacy list envelope: exactly `metadata` and `result`, integers, 0-based `currentPage`, consistent counts. */
export function expectEnvelope(body: unknown): Envelope {
  expect(body).toBeTypeOf('object');
  const envelope = body as Envelope;
  expect(Object.keys(envelope).sort()).toEqual(['metadata', 'result']);
  const { currentPage, pageSize, totalCount, totalPages } = envelope.metadata;
  expect(Object.keys(envelope.metadata).sort()).toEqual([
    'currentPage',
    'pageSize',
    'totalCount',
    'totalPages',
  ]);
  for (const n of [currentPage, pageSize, totalCount, totalPages])
    expect(Number.isInteger(n)).toBe(true);
  expect(currentPage).toBeGreaterThanOrEqual(0);
  expect(pageSize).toBeGreaterThanOrEqual(1);
  expect(totalPages).toBe(Math.ceil(totalCount / pageSize));
  expect(Array.isArray(envelope.result)).toBe(true);
  expect(envelope.result.length).toBeLessThanOrEqual(pageSize);
  if (currentPage < totalPages) {
    expect(envelope.result.length).toBe(Math.min(pageSize, totalCount - currentPage * pageSize));
  } else {
    expect(envelope.result).toEqual([]);
  }
  return envelope;
}

/** The rows are in ascending order of key, then id: the order of a stable sort. */
export function expectStableOrder(
  rows: readonly Record<string, unknown>[],
  sortKey: (row: Record<string, unknown>) => string,
  idOf: (row: Record<string, unknown>) => string = (row) => String(row.id),
): void {
  const keyed = rows.map((row) => [sortKey(row), idOf(row)] as const);
  const sorted = [...keyed].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  expect(keyed).toEqual(sorted);
}

/** Registers the standard contract cases of one v1 route (see the top of this file). */
export function v1ContractTests(route: AppRoute, ctx: V1ContractContext): void {
  const name = describeRoute(route);
  const method = route.method.toUpperCase();
  const send = (
    headers: Record<string, string>,
    query = ctx.query,
    path = pathOf(route, ctx, query),
  ) => ctx.call({ method, path, headers });

  describe(`v1 contract: ${name}`, () => {
    if (ctx.publicReason === undefined) {
      it('is never public: it names a permission', () => {
        expect(route.public).not.toBe(true);
        expect(route.permission).toBeTruthy();
        expect(route.audit, 'a v1 route is audited (audit: true)').toBeTruthy();
      });

      it('is 401 problem+json without a token and for a token that does not exist', async () => {
        const bad: Record<string, string>[] = [
          {},
          bearer(`scp_abcd1234_${'A'.repeat(43)}`),
          { 'x-api-key': 'nonsense' },
        ];
        for (const headers of bad) {
          const reply = await send(headers);
          expect(reply.status).toBe(401);
          expectReplyMatchesRoute(route, reply);
        }
      });

      it('is 403 for a valid token whose scopes lack the permission', async () => {
        const reply = await send(bearer(ctx.tokenWithoutScope));
        expect(reply.status).toBe(403);
        expectReplyMatchesRoute(route, reply);
      });
    } else {
      it('is public on purpose and answers without a token', async () => {
        expect(route.publicReason).toBeTruthy();
        const reply = await send({});
        expect(reply.status).toBe(200);
        expectReplyMatchesRoute(route, reply);
      });
    }

    it('answers 200 matching its schema for Authorization: Bearer, and the same for X-API-Key', async () => {
      const viaBearer = await send(ctx.publicReason === undefined ? bearer(ctx.token) : {});
      expect(viaBearer.status).toBe(200);
      expectReplyMatchesRoute(route, viaBearer);
      if (ctx.publicReason === undefined) {
        const viaKey = await send({ 'x-api-key': ctx.token });
        expect(viaKey.status).toBe(200);
        expect(viaKey.body).toEqual(viaBearer.body);
      }
    });

    const list = ctx.list;
    if (list) {
      const pageParam = list.pageParam ?? 'page';
      const sizeParam = list.pageSizeParam ?? 'pageSize';
      const page = async (query: Record<string, string>) => {
        const reply = await send(bearer(ctx.token), { ...ctx.query, ...query });
        expect(reply.status, JSON.stringify(reply.body)).toBe(200);
        expectReplyMatchesRoute(route, reply);
        return expectEnvelope(reply.body);
      };
      const sortKey = list.sortKey ?? ((row) => String(row.id));

      it('has the legacy envelope and is in a stable order (key, then id)', async () => {
        const all = await page({ [sizeParam]: '100' });
        expectStableOrder(all.result, sortKey, list.idOf);
      });

      it('keeps the order and the counts across pages, and the last page holds the rest', async () => {
        const first = await page({ [sizeParam]: '1', [pageParam]: '0' });
        const total = first.metadata.totalCount;
        const walked: Record<string, unknown>[] = [];
        for (let p = 0; p < Math.min(first.metadata.totalPages, 20); p++) {
          const next = await page({ [sizeParam]: '1', [pageParam]: String(p) });
          expect(next.metadata.totalCount).toBe(total);
          walked.push(...next.result);
        }
        if (first.metadata.totalPages <= 20) expect(walked).toHaveLength(total);
        expectStableOrder(walked, sortKey, list.idOf);
        const everything = await page({ [sizeParam]: '100' });
        if (total <= 100) expect(walked).toEqual(everything.result);
      });

      it('answers a page past the end with an empty result and the same totals, and a pageSize over the total with everything', async () => {
        const base = await page({ [sizeParam]: '1', [pageParam]: '0' });
        const beyond = await page({
          [sizeParam]: '1',
          [pageParam]: String(base.metadata.totalPages + 5),
        });
        expect(beyond.result).toEqual([]);
        expect(beyond.metadata.totalCount).toBe(base.metadata.totalCount);
        const large = await page({ [sizeParam]: '100', [pageParam]: '0' });
        expect(large.result).toHaveLength(Math.min(100, base.metadata.totalCount));
        expect(large.metadata.totalPages).toBe(Math.ceil(base.metadata.totalCount / 100));
      });

      it('is 422 problem+json for a page or pageSize that is not a number or is out of range, never 500', async () => {
        for (const query of [
          { [pageParam]: '-1' },
          { [pageParam]: 'x' },
          { [sizeParam]: '0' },
          { [sizeParam]: 'x' },
          { [sizeParam]: '100000' },
        ]) {
          const reply = await send(bearer(ctx.token), { ...ctx.query, ...query });
          expect(reply.status, JSON.stringify(query)).toBe(422);
          expectReplyMatchesRoute(route, reply);
        }
      });
    }
  });
}

/** Every `*.contract.test.ts` under `roots` (skipping `node_modules` and `dist`). */
export function findContractTestFiles(roots: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.contract.test.ts')) found.push(path);
    }
  };
  roots.forEach(walk);
  return found.sort();
}

/**
 * The v1 routes (`GET /providers`) that no contract-test file names: a file covers a route when it
 * calls `v1ContractTests()` and contains the route's `METHOD /path` as a string. The walker of M8 for
 * the routes of every module; a new v1 route without a contract test fails the build.
 */
export function v1RoutesWithoutContractTest(
  routes: readonly Pick<AppRoute, 'method' | 'path'>[],
  files: readonly string[],
): string[] {
  const covering = files
    .map((file) => readFileSync(file, 'utf8'))
    .filter((text) => text.includes('v1ContractTests('));
  return routes
    .map((route) => describeRoute(route))
    .filter(
      (name) => !covering.some((text) => text.includes(`'${name}'`) || text.includes(`"${name}"`)),
    )
    .sort();
}
