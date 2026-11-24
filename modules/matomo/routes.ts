// The one route of matomo. Thin: one service call, the result as it is.
import { createRoute, z, type AppEnv, type RouteHandler } from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import type { TrackerService } from './service/tracker.ts';

export const trackerConfigSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    url: z.string().describe('The Matomo base address, ending in `/`.'),
    siteId: z.number().int(),
    cookieless: z.boolean(),
    respectDoNotTrack: z.boolean(),
    userId: z
      .string()
      .optional()
      .describe(
        "The caller's pseudonymous id (a keyed hash), only for a signed-in person with the option on.",
      ),
  }),
]);

export const trackerRoute = createRoute({
  method: 'get',
  path: '/matomo/tracker',
  public: true,
  publicReason:
    'Anonymous visitors are counted too, so the browser needs the tracker configuration before anyone signs in. It holds only what the tracker script shows anyway (the Matomo address, site id and flags); the pseudonymous id is only the signed-in caller’s own.',
  summary: 'The configuration of the usage tracker',
  responses: {
    200: {
      description: 'Whether tracking is on and, if it is, where the hits go.',
      content: { 'application/json': { schema: trackerConfigSchema } },
    },
  },
});

export function registerRoutes(r: RouteRegistrar): void {
  const tracker = r.service<TrackerService>();
  r.internal(trackerRoute, (async (c) => {
    // The answer can hold the caller's own id, so no shared cache may keep it.
    c.header('cache-control', 'no-store');
    return c.json(await tracker.tracker(c.get('actor')), 200);
  }) satisfies RouteHandler<typeof trackerRoute, AppEnv>);
}
