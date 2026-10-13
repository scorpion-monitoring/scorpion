import { createRoute, z, type RouteHandler } from '@scorpion/contracts';
import { mountPath, type ModuleContext, type RouteRegistrar } from '@scorpion/kernel';
import { buildSpec } from './service/spec.ts';
import type { PublicApiSettings } from './settings-schema.ts';

/**
 * `GET /api/v1/openapi.json`. The one v1 route that is `public: true` (ADR-0037): the document names the
 * routes, their schemas and the permission each needs, and nothing about any record; it is also committed
 * to the repository and drawn by the public page `/docs`. Every data route of v1 needs a token.
 * Not audited: an anonymous call that writes a row would let anyone fill the trail; the rate limit applies.
 */
export const specRoute = createRoute({
  method: 'get',
  path: '/openapi.json',
  public: true,
  publicReason:
    'The description of the public API (routes, schemas, permission names) is documentation: it is committed to the repository and shown on the public page /docs, and holds no record.',
  summary: 'The OpenAPI description of this API',
  description:
    'The OpenAPI 3.1 document of the public API (v1) of this instance, built from the routes that are loaded. The server URL is the address this request came to.',
  responses: {
    200: {
      description: 'The OpenAPI document.',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
  },
});

export function registerRoutes(
  r: RouteRegistrar,
  ctx: ModuleContext<never, never, PublicApiSettings>,
) {
  const handler: RouteHandler<typeof specRoute> = async (c) => {
    const settings = await ctx.settings.get();
    const serverUrl = `${new URL(c.req.url).origin}${mountPath(ctx.config)}/api/v1`;
    const document = buildSpec(ctx.routes(), settings, serverUrl);
    c.header('cache-control', 'no-store');
    return c.json(document as unknown as Record<string, unknown>, 200);
  };
  r.public('v1', specRoute, handler as never);
}
