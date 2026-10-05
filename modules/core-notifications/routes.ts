// The HTTP routes of core.notifications (internal API, sprint 3). Thin: Zod parses, one service call,
// the result is mapped. Three groups: the caller's own inbox, the category list for the preferences,
// and the administrator's view of delivery. No response carries the body, address, subject or URL of a
// delivery; the views below have no field for them.
import {
  createRoute,
  listEnvelope,
  pageOffset,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import type { DeliveryView } from './service/admin.ts';
import type { InboxItemView } from './service/inbox.ts';
import type { NotificationsInternals } from './service/notifications.ts';
import { categoriesOf, type CategoryInfo } from './service/preferences.ts';

export const PERMISSION_PREFERENCE_READ = 'core.notifications.preference.read';

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});
const forbidden = { description: 'The caller lacks the permission, or the item is not theirs.' };

const idParam = z.object({ id: z.uuid() });

// ---- the caller's inbox ---------------------------------------------------------------------------

const inboxItemSchema = z.object({
  id: z.string(),
  template: z.string(),
  title: z.string(),
  text: z.string(),
  link: z.string().nullable(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});

export const listInboxRoute = createRoute({
  method: 'get',
  path: '/notifications/inbox',
  permission: 'core.notifications.inbox.read',
  request: { query: paginationQuery() },
  responses: {
    200: ok('The caller’s own items, newest first.', listEnvelope(inboxItemSchema)),
  },
});

export const unreadCountRoute = createRoute({
  method: 'get',
  path: '/notifications/inbox/unread-count',
  permission: 'core.notifications.inbox.read',
  responses: {
    200: ok('How many of the caller’s items are unread.', z.object({ count: z.number().int() })),
  },
});

export const markAllReadRoute = createRoute({
  method: 'post',
  path: '/notifications/inbox/read-all',
  permission: 'core.notifications.inbox.write',
  responses: {
    200: ok('Every unread item of the caller is read.', z.object({ updated: z.number().int() })),
  },
});

export const markReadRoute = createRoute({
  method: 'post',
  path: '/notifications/inbox/{id}/read',
  permission: 'core.notifications.inbox.write',
  request: { params: idParam },
  responses: {
    200: ok('The item is read (also when it was).', inboxItemSchema),
    403: forbidden,
  },
});

export const deleteInboxItemRoute = createRoute({
  method: 'delete',
  path: '/notifications/inbox/{id}',
  permission: 'core.notifications.inbox.write',
  request: { params: idParam },
  responses: { 204: { description: 'The item is deleted.' }, 403: forbidden },
});

// ---- the preferences' category list ---------------------------------------------------------------

const categorySchema = z.object({
  category: z.string(),
  description: z.object({ en: z.string(), de: z.string() }).nullable(),
  mandatory: z.boolean(),
  templates: z.array(z.string()),
});

export const listCategoriesRoute = createRoute({
  method: 'get',
  path: '/notifications/preferences/categories',
  permission: PERMISSION_PREFERENCE_READ,
  request: { query: paginationQuery() },
  responses: {
    200: ok(
      'The categories of notification the profile sends. Set the switches with PUT /preferences/notifications.preferences.',
      listEnvelope(categorySchema),
    ),
  },
});

// ---- the administrator's view of delivery --------------------------------------------------------

const statusSchema = z.object({
  emailTransport: z.enum(['smtp', 'none']),
  transportIsNone: z.boolean(),
  webhookEnabled: z.boolean(),
  counts: z.object({
    queued: z.number().int(),
    sending: z.number().int(),
    sent: z.number().int(),
    dead: z.number().int(),
  }),
  sentWithoutTransport: z.number().int(),
  lastErrors: z.array(
    z.object({ code: z.string(), count: z.number().int(), lastAt: z.iso.datetime() }),
  ),
});

export const statusRoute = createRoute({
  method: 'get',
  path: '/notifications/status',
  permission: 'core.notifications.status.read',
  responses: { 200: ok('Counts, the transport and the latest error codes.', statusSchema) },
});

const deliverySchema = z.object({
  id: z.string(),
  template: z.string(),
  channel: z.enum(['email', 'webhook']),
  status: z.enum(['queued', 'sending', 'sent', 'dead']),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  transport: z.string().nullable(),
  sensitive: z.boolean(),
  recipientUserId: z.string().nullable(),
  bodyAvailable: z.boolean(),
  createdAt: z.iso.datetime(),
  statusChangedAt: z.iso.datetime(),
  nextAttemptAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
});

const dateTime = z.iso.datetime({ offset: true });

export const listDeliveriesRoute = createRoute({
  method: 'get',
  path: '/notifications/deliveries',
  permission: 'core.notifications.deliveries.read',
  request: {
    query: paginationQuery().extend({
      status: z.enum(['queued', 'sending', 'sent', 'dead']).optional(),
      template: z.string().min(1).max(100).optional(),
      channel: z.enum(['email', 'webhook']).optional(),
      from: dateTime.optional().describe('Created at or after.'),
      to: dateTime.optional().describe('Created at or before.'),
    }),
  },
  responses: {
    200: ok(
      'Deliveries, newest first. Metadata only: never a body, address, subject or URL.',
      listEnvelope(deliverySchema),
    ),
  },
});

export const requeueRoute = createRoute({
  method: 'post',
  path: '/notifications/deliveries/{id}/requeue',
  permission: 'core.notifications.deliveries.manage',
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok('The delivery is queued again with its attempts reset.', deliverySchema),
    404: { description: 'No such delivery.' },
    409: { description: 'Not dead, or its content was removed when it ended.' },
  },
});

export const testRoute = createRoute({
  method: 'post',
  path: '/notifications/test',
  permission: 'core.notifications.test',
  audit: true,
  rateLimit: 'strict', // each call sends a mail; the service adds a per-administrator budget
  responses: {
    202: ok(
      'The test mail is queued for the caller’s own address.',
      z.object({ deliveryId: z.string(), transportIsNone: z.boolean() }),
    ),
    409: { description: 'The caller’s account has no email address.' },
    429: { description: 'Too many test mails.' },
  },
});

// ---- mapping -------------------------------------------------------------------------------------

const inboxView = (item: InboxItemView) => ({
  id: item.id,
  template: item.template,
  title: item.title,
  text: item.text,
  link: item.link,
  createdAt: item.createdAt.toISOString(),
  readAt: item.readAt?.toISOString() ?? null,
});

const categoryView = (info: CategoryInfo) => ({ ...info });

/** Field by field on purpose: a column added to the table later is not exposed by accident. */
const deliveryView = (d: DeliveryView) => ({
  id: d.id,
  template: d.template,
  channel: d.channel,
  status: d.status,
  attempts: d.attempts,
  lastError: d.lastError,
  transport: d.transport,
  sensitive: d.sensitive,
  recipientUserId: d.recipientUserId,
  bodyAvailable: d.bodyAvailable,
  createdAt: d.createdAt.toISOString(),
  statusChangedAt: d.statusChangedAt.toISOString(),
  nextAttemptAt: d.nextAttemptAt.toISOString(),
  sentAt: d.sentAt?.toISOString() ?? null,
});

export function registerNotificationRoutes(r: RouteRegistrar, service: NotificationsInternals) {
  const { inbox, admin } = service;

  r.internal(listInboxRoute, (async (c) => {
    const query = c.req.valid('query');
    const { items, total } = await inbox.list(c.get('actor'), query);
    return c.json(paginate(query, total, items.map(inboxView)), 200);
  }) satisfies RouteHandler<typeof listInboxRoute, AppEnv>);

  r.internal(unreadCountRoute, (async (c) => {
    return c.json({ count: await inbox.unreadCount(c.get('actor')) }, 200);
  }) satisfies RouteHandler<typeof unreadCountRoute, AppEnv>);

  r.internal(markAllReadRoute, (async (c) => {
    return c.json({ updated: await inbox.markAllRead(c.get('actor')) }, 200);
  }) satisfies RouteHandler<typeof markAllReadRoute, AppEnv>);

  r.internal(markReadRoute, (async (c) => {
    const item = await inbox.markRead(c.get('actor'), c.req.valid('param').id);
    return c.json(inboxView(item), 200);
  }) satisfies RouteHandler<typeof markReadRoute, AppEnv>);

  r.internal(deleteInboxItemRoute, (async (c) => {
    await inbox.remove(c.get('actor'), c.req.valid('param').id);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof deleteInboxItemRoute, AppEnv>);

  r.internal(listCategoriesRoute, ((c) => {
    const query = c.req.valid('query');
    const all = categoriesOf(service.templates.values());
    const page = all.slice(pageOffset(query), pageOffset(query) + query.pageSize);
    return c.json(paginate(query, all.length, page.map(categoryView)), 200);
  }) satisfies RouteHandler<typeof listCategoriesRoute, AppEnv>);

  r.internal(statusRoute, (async (c) => {
    const status = await service.status(c.get('actor'));
    return c.json(
      {
        ...status,
        lastErrors: status.lastErrors.map((e) => ({
          code: e.code,
          count: e.count,
          lastAt: e.lastAt.toISOString(),
        })),
      },
      200,
    );
  }) satisfies RouteHandler<typeof statusRoute, AppEnv>);

  r.internal(listDeliveriesRoute, (async (c) => {
    const { page, pageSize, from, to, ...filter } = c.req.valid('query');
    const { deliveries, total } = await admin.list(
      c.get('actor'),
      {
        ...filter,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      },
      { page, pageSize },
    );
    return c.json(paginate({ page, pageSize }, total, deliveries.map(deliveryView)), 200);
  }) satisfies RouteHandler<typeof listDeliveriesRoute, AppEnv>);

  r.internal(requeueRoute, (async (c) => {
    const requeued = await admin.requeue(c.get('actor'), c.req.valid('param').id);
    return c.json(deliveryView(requeued), 200);
  }) satisfies RouteHandler<typeof requeueRoute, AppEnv>);

  r.internal(testRoute, (async (c) => {
    return c.json(await admin.sendTest(c.get('actor')), 202);
  }) satisfies RouteHandler<typeof testRoute, AppEnv>);
}
