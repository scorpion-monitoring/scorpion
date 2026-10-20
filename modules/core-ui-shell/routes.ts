// The HTTP route of core.ui-shell. One route: what the caller may see (ADR-0027).
import { createRoute, z, type AppEnv, type Context, type RouteHandler } from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import { INSTANCE_ID, MAX_ITEMS, MAX_PACKED_Y } from './grid.ts';
import { widgetGridSchema } from './registries.ts';
import type { DashboardItem } from './service/dashboard/document.ts';
import {
  PERMISSION_DASHBOARD_READ,
  PERMISSION_DASHBOARD_WRITE,
  type DashboardService,
  type DashboardView,
} from './service/dashboard/service.ts';
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
      grid: widgetGridSchema
        .optional()
        .describe('Where and how big the widget is on the dashboard grid (twelve columns).'),
      label: z.string().optional().describe('A key of the message catalogue.'),
      description: z.string().optional().describe('A key of the message catalogue.'),
      icon: z.string().optional().describe('A name of the icon table.'),
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

// ---- the dashboard of the signed-in caller (M11): own data only, neither route takes a user id ------

const tileSchema = z.object({
  id: z
    .string()
    .regex(INSTANCE_ID)
    .describe('The instance id: 4 to 12 lower-case letters and digits, unique on the dashboard.'),
  widget: z.string().describe('The id of a `ui.widget` entry the caller may see.'),
  x: z.number().int().min(0).max(MAX_PACKED_Y),
  y: z.number().int().min(0).max(MAX_PACKED_Y),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(50),
  config: z
    .record(z.string(), z.unknown())
    .describe('The tile’s own settings, shaped by the widget; at most 400 bytes as JSON.'),
});

const dashboardSchema = z.object({
  version: z.literal(1),
  items: z
    .array(tileSchema)
    .describe('What the page draws: repaired, only widgets the caller may see, by row and column.'),
  dropped: z
    .array(
      z.object({
        id: z.string().describe('The tile’s instance id, or `#<position>` when it had none.'),
        reason: z.enum([
          'invalid-item',
          'duplicate-id',
          'unknown-widget',
          'not-permitted',
          'singleton-repeated',
          'document-too-large',
        ]),
      }),
    )
    .describe(
      'What the repair left out of the stored document. A read changes nothing that is stored.',
    ),
  reset: z.boolean().describe('The stored document was replaced by the default dashboard.'),
  resetReason: z.enum(['invalid', 'too-many-items', 'newer-version']).optional(),
  isDefault: z.boolean().describe('Nothing is stored: `items` is the default dashboard.'),
});

// The structure is checked here; whether a widget exists, may be placed by the caller and accepts the
// configuration is the service's check, and names `items[i].widget` or `items[i].config`.
const saveInput = z.strictObject({
  items: z
    .array(
      z.object({
        id: z.string().max(64),
        widget: z.string().max(100),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        config: z.record(z.string().max(64), z.unknown()),
      }),
    )
    .max(MAX_ITEMS),
});

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

export const getDashboardRoute = createRoute({
  method: 'get',
  path: '/ui/dashboard',
  permission: PERMISSION_DASHBOARD_READ,
  responses: {
    200: ok(
      'The caller’s own dashboard, repaired; the default dashboard when none is stored.',
      dashboardSchema,
    ),
  },
});

export const saveDashboardRoute = createRoute({
  method: 'put',
  path: '/ui/dashboard',
  permission: PERMISSION_DASHBOARD_WRITE,
  audit: true,
  request: {
    body: { required: true as const, content: { 'application/json': { schema: saveInput } } },
  },
  responses: {
    200: ok(
      'The caller’s own dashboard is stored; this is what a read now gives.',
      dashboardSchema,
    ),
  },
});

const view = ({ version, items, dropped, reset, resetReason, isDefault }: DashboardView) => ({
  version,
  items,
  dropped,
  reset,
  ...(resetReason === undefined ? {} : { resetReason }),
  isDefault,
});

export function registerShellRoutes(
  r: RouteRegistrar,
  shell: NavigationService,
  dashboard: DashboardService,
) {
  r.internal(navigationRoute, (async (c: Context<AppEnv>) => {
    // The answer depends on who asks, so no shared cache may keep it.
    c.header('cache-control', 'no-store');
    return c.json(await shell.navigation(c.get('actor')), 200);
  }) as never);

  r.internal(getDashboardRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(view(await dashboard.get(c.get('actor'))), 200);
  }) satisfies RouteHandler<typeof getDashboardRoute, AppEnv>);

  r.internal(saveDashboardRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    const { items } = c.req.valid('json');
    return c.json(view(await dashboard.save(c.get('actor'), items as DashboardItem[])), 200);
  }) satisfies RouteHandler<typeof saveDashboardRoute, AppEnv>);
}
