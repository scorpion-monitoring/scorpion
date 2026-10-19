// The RDF reads of kpi.framework (ADR-0040, M9 sprint 4): the indicators and KPI sets as RIMO-shaped Turtle and JSON-LD.
// Two pairs over one model:
//   - `GET /api/v1/kpi/rimo.ttl` and `.jsonld`: the public API, a token with `kpi.framework.v1.read`, `private, no-cache`;
//   - `GET /public/kpi/rimo.ttl` and `.jsonld` (the internal surface, like `/public/services/{ref}`): no token, definitions
//     only, a short `max-age` and an ETag (`If-None-Match` gets 304).
// Thin: one service call, the document is returned as it is. The IRIs in the answers identify; they do not dereference.
import { createRoute, z, type AppEnv, type Context, type RouteHandler } from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import { PERMISSION_V1_READ } from './service/permissions.ts';
import type { RdfDocument, RdfService } from './service/rdf-model.ts';

const TURTLE = 'text/turtle';
const JSON_LD = 'application/ld+json';

/** How long a shared cache may keep the public definitions, in seconds. A definition changes rarely; five minutes is the delay. */
export const PUBLIC_RDF_MAX_AGE_SECONDS = 300;
export const PUBLIC_RDF_CACHE_CONTROL = `public, max-age=${PUBLIC_RDF_MAX_AGE_SECONDS}`;

const PUBLIC_REASON =
  'The definitions of the indicators and KPI sets are the shared vocabulary of the instance (the same words as RIMO), meant to be read by other systems and by people who have no account. The answer has no value, no service, no person and no token: the model it is written from has no field for any of them.';

/** The reads take no parameter: a query string is 422, so a shared cache is not fragmented by junk parameters. */
const noQuery = z.strictObject({});

const turtleSchema = z.string().describe('Turtle (`text/turtle`), UTF-8.');
const jsonLdSchema = z
  .object({
    '@context': z.record(z.string(), z.string()).describe('The prefixes of the document.'),
    '@graph': z.array(z.record(z.string(), z.unknown())).describe('The nodes, in a fixed order.'),
  })
  .describe(
    'JSON-LD (`application/ld+json`), UTF-8: a flat `@graph` and the `@context` of its prefixes.',
  );

const V1_DESCRIPTION = (format: string) =>
  `The indicators and KPI sets as RDF (${format}) following RIMO 0.2.0: each indicator is a \`rimo:KPI\` with its name, description, example, \`rimo:isQualitativeIndicator\`, one \`rimo:KPIValue\` node that carries the unit, \`rimo:measuredBy\` and \`rimo:canBeAutomatedBy\`, and \`rimo:mandatoryFor\`, \`rimo:recommendedFor\` or \`rimo:appliedTo\` pointing to the KPI set (a RIMO service category when the set maps to one). Definitions only: no measurement and no service. The identifiers identify; they are not addresses of pages. \`Cache-Control: private, no-cache\`. The same document without a token is \`GET /public/kpi/rimo.ttl\` and \`/public/kpi/rimo.jsonld\` of the internal surface.`;

export const getRimoTurtleV1Route = createRoute({
  method: 'get',
  path: '/kpi/rimo.ttl',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'Read the indicators and KPI sets as RDF (Turtle)',
  description: V1_DESCRIPTION('Turtle'),
  request: { query: noQuery },
  responses: {
    200: {
      description: 'The model as Turtle.',
      content: { [TURTLE]: { schema: turtleSchema } },
    },
  },
});

export const getRimoJsonLdV1Route = createRoute({
  method: 'get',
  path: '/kpi/rimo.jsonld',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'Read the indicators and KPI sets as RDF (JSON-LD)',
  description: V1_DESCRIPTION('JSON-LD'),
  request: { query: noQuery },
  responses: {
    200: {
      description: 'The model as JSON-LD.',
      content: { [JSON_LD]: { schema: jsonLdSchema } },
    },
  },
});

const PUBLIC_DESCRIPTION = (format: string) =>
  `The definitions of the indicators and KPI sets as RDF (${format}), without a token. Definitions only: no value, no service, no person. \`Cache-Control: ${PUBLIC_RDF_CACHE_CONTROL}\` and an ETag: a client that sends \`If-None-Match\` with the tag gets 304. The identifiers in the answer identify; they do not dereference.`;

const notModified = {
  description: 'The caller has this document (`If-None-Match` matches the ETag).',
};

export const getPublicRimoTurtleRoute = createRoute({
  method: 'get',
  path: '/public/kpi/rimo.ttl',
  public: true,
  publicReason: PUBLIC_REASON,
  summary: 'Read the KPI definitions as RDF (Turtle), public',
  description: PUBLIC_DESCRIPTION('Turtle'),
  request: { query: noQuery },
  responses: {
    200: {
      description: 'The definitions as Turtle.',
      content: { [TURTLE]: { schema: turtleSchema } },
    },
    304: notModified,
  },
});

export const getPublicRimoJsonLdRoute = createRoute({
  method: 'get',
  path: '/public/kpi/rimo.jsonld',
  public: true,
  publicReason: PUBLIC_REASON,
  summary: 'Read the KPI definitions as RDF (JSON-LD), public',
  description: PUBLIC_DESCRIPTION('JSON-LD'),
  request: { query: noQuery },
  responses: {
    200: {
      description: 'The definitions as JSON-LD.',
      content: { [JSON_LD]: { schema: jsonLdSchema } },
    },
    304: notModified,
  },
});

/** `If-None-Match` as a client sends it: a list of (weak) entity tags, or `*`. */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((part) => part.trim())
    .map((part) => (part.startsWith('W/') ? part.slice(2) : part))
    .some((candidate) => candidate === '*' || candidate === etag);
}

const contentHeaders = (type: string, cacheControl: string) => ({
  'content-type': `${type}; charset=utf-8`,
  'cache-control': cacheControl,
  'x-content-type-options': 'nosniff',
});

export function registerRdfRoutes(r: RouteRegistrar, service: RdfService) {
  const privateAnswer = (type: string, document: RdfDocument) =>
    new Response(document.body, {
      status: 200,
      headers: contentHeaders(type, 'private, no-cache'),
    });
  const publicAnswer = (type: string, document: RdfDocument, ifNoneMatch: string | undefined) => {
    const headers = { ...contentHeaders(type, PUBLIC_RDF_CACHE_CONTROL), etag: document.etag };
    if (matchesEtag(ifNoneMatch, document.etag)) {
      // A 304 carries no content type or length: the tag and the cache headers are what the client needs.
      return new Response(null, {
        status: 304,
        headers: { etag: headers.etag, 'cache-control': headers['cache-control'] },
      });
    }
    return new Response(document.body, { status: 200, headers });
  };

  r.public('v1', getRimoTurtleV1Route, (async (c) =>
    privateAnswer(TURTLE, await service.turtle(c.get('actor')))) satisfies RouteHandler<
    typeof getRimoTurtleV1Route,
    AppEnv
  >);
  // The JSON-LD routes declare an object schema, for which Hono types a `c.json()` answer; the handler returns the
  // bytes of the document as they are (the same way registry.services answers its Schema.org profile).
  r.public('v1', getRimoJsonLdV1Route, async (c: Context<AppEnv>) =>
    privateAnswer(JSON_LD, await service.jsonLd(c.get('actor'))),
  );
  r.internal(getPublicRimoTurtleRoute, (async (c) =>
    publicAnswer(
      TURTLE,
      await service.publicTurtleAsSystem(),
      c.req.header('if-none-match'),
    )) satisfies RouteHandler<typeof getPublicRimoTurtleRoute, AppEnv>);
  r.internal(getPublicRimoJsonLdRoute, async (c: Context<AppEnv>) =>
    publicAnswer(JSON_LD, await service.publicJsonLdAsSystem(), c.req.header('if-none-match')),
  );
}
