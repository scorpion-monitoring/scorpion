// The HTTP route of core.ui-shell. One route: what the caller may see (ADR-0027).
import { createRoute, z, type AppEnv, type Context } from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import type { NavigationService } from './service/navigation.ts';

const navigationSchema = z.object({
  nav: z.array(
    z.object({
      id: z.string(),
      label: z.string().describe('A key of the message catalogue.'),
      path: z.string(),
      icon: z.string().optional(),
      section: z.string(),
      order: z.number().int(),
    }),
  ),
  routes: z
    .array(z.string())
    .describe('The page paths the caller may open, with `:param` segments.'),
  widgets: z.array(
    z.object({
      id: z.string(),
      slot: z.string(),
      component: z.string(),
      order: z.number().int(),
    }),
  ),
  themes: z.array(
    z.object({ id: z.string(), label: z.string(), colorScheme: z.enum(['light', 'dark']) }),
  ),
});

export const navigationRoute = createRoute({
  method: 'get',
  path: '/ui/navigation',
  public: true,
  publicReason:
    'The pages a signed-out visitor may open (start page, legal texts, API documentation) and their links must be known before sign-in. The handler reads the caller from the session and lists only what that caller may open; it names no page the caller cannot use, and no data.',
  responses: {
    200: {
      description: 'The links, pages, dashboard cards and themes the caller may use.',
      content: { 'application/json': { schema: navigationSchema } },
    },
  },
});

export function registerShellRoutes(r: RouteRegistrar, shell: NavigationService) {
  r.internal(navigationRoute, (async (c: Context<AppEnv>) => {
    // The answer depends on who asks, so no shared cache may keep it.
    c.header('cache-control', 'no-store');
    return c.json(await shell.navigation(c.get('actor')), 200);
  }) as never);
}
