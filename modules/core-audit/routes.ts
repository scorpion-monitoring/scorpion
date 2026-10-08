// The HTTP routes of core.audit (internal API): the viewer, the CSV export and the kernel's
// maintenance surface. Thin: Zod parses, one service call, the result is mapped. Every route needs one
// of the four permissions of this module and nothing else (defect 1's "log reads" case).
import {
  createRoute,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import {
  METHODS,
  PERMISSION_EXPORT,
  PERMISSION_READ,
  type AuditEventView,
} from './service/viewer.ts';
import { PERMISSION_SYSTEM_MANAGE, PERMISSION_SYSTEM_READ } from './service/system.ts';
import type { AuditInternals } from './service/audit.ts';

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});
const idParam = z.object({ id: z.uuid() });
const dateTime = z.iso.datetime({ offset: true });

const eventSchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  source: z.enum(['event', 'api']),
  action: z.string(),
  outcome: z.enum(['ok', 'denied', 'error']),
  actorKind: z.enum(['user', 'token', 'anonymous', 'system']),
  userId: z.string().nullable(),
  tokenId: z.string().nullable(),
  ip: z.string().nullable(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  status: z.number().int().nullable(),
  query: z.unknown().nullable(),
  body: z.unknown().nullable(),
  truncated: z.boolean(),
  requestId: z.string().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  payload: z.unknown().nullable(),
});

const filterShape = {
  method: z.enum(METHODS).optional(),
  user: z.string().min(1).max(200).optional().describe('The id of the user who acted.'),
  endpoint: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe('The route template starts with this, for example /api/internal/users.'),
  action: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('The exact action: an event name or api.POST.'),
  outcome: z.enum(['ok', 'denied', 'error']).optional(),
  source: z.enum(['event', 'api']).optional(),
  from: dateTime.optional().describe('At or after.'),
  to: dateTime.optional().describe('At or before.'),
};

export const listAuditRoute = createRoute({
  method: 'get',
  path: '/audit',
  permission: PERMISSION_READ,
  // Not audited (M5 sprint 4): the admin screen pages and refreshes this list, and an entry per page
  // would fill the table it reads. Opening one entry and the CSV export stay audited.
  request: { query: paginationQuery().extend(filterShape) },
  responses: {
    200: ok('Entries, newest first (`occurredAt`, then id).', listEnvelope(eventSchema)),
  },
});

export const exportAuditRoute = createRoute({
  method: 'get',
  path: '/audit/export.csv',
  permission: PERMISSION_EXPORT,
  // The filters are the query string, so they are stored with the entry of the export.
  audit: { body: true },
  request: { query: z.strictObject(filterShape) },
  responses: {
    200: {
      description:
        'The matching entries as CSV, newest first, at most the `csvMaxRows` setting. `X-Row-Count` is the number of rows, `X-Row-Cap` the cap, and `X-Truncated: true` says rows were left out.',
      content: { 'text/csv': { schema: z.string() } },
    },
  },
});

export const getAuditRoute = createRoute({
  method: 'get',
  path: '/audit/{id}',
  permission: PERMISSION_READ,
  audit: true,
  request: { params: idParam },
  responses: { 200: ok('One entry.', eventSchema), 404: { description: 'No such entry.' } },
});

const deadDeliverySchema = z.object({
  deliveryId: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  subscriber: z.string(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  occurredAt: z.iso.datetime(),
  failedAt: z.iso.datetime(),
});

export const outboxRoute = createRoute({
  method: 'get',
  path: '/system/outbox',
  permission: PERMISSION_SYSTEM_READ,
  responses: {
    200: ok(
      'The state of the event outbox: pending and dead deliveries, the lag, and the dead ones (newest first, at most 100).',
      z.object({
        stats: z.object({
          pending: z.number().int(),
          dead: z.number().int(),
          lagSeconds: z.number(),
        }),
        dead: z.array(deadDeliverySchema),
      }),
    ),
  },
});

export const requeueOutboxRoute = createRoute({
  method: 'post',
  path: '/system/outbox/deliveries/{id}/requeue',
  permission: PERMISSION_SYSTEM_MANAGE,
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok(
      'The delivery is queued again with its attempts reset.',
      z.object({ deliveryId: z.string(), eventName: z.string(), subscriber: z.string() }),
    ),
    404: { description: 'No such delivery.' },
    409: { description: 'The delivery is not dead.' },
  },
});

const jobRunSchema = z.object({
  id: z.string(),
  jobName: z.string(),
  module: z.string(),
  attempt: z.number().int(),
  status: z.enum(['running', 'succeeded', 'failed']),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable().describe('The failure, masked and cut short. Never a stack.'),
  result: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    .nullable()
    .describe('The counts and flags the handler returned, for example `{ removed: 12 }`.'),
});

export const jobRunsRoute = createRoute({
  method: 'get',
  path: '/system/job-runs',
  permission: PERMISSION_SYSTEM_READ,
  request: {
    query: paginationQuery().extend({
      jobName: z.string().min(1).max(200).optional().describe('The exact job name.'),
      status: z.enum(['running', 'succeeded', 'failed']).optional(),
    }),
  },
  responses: {
    200: ok('Job runs, newest first (`startedAt`, then id).', listEnvelope(jobRunSchema)),
  },
});

/** Field by field on purpose: a column added to the table later is not exposed by accident. */
const eventView = (e: AuditEventView) => ({
  id: e.id,
  occurredAt: e.occurredAt.toISOString(),
  source: e.source,
  action: e.action,
  outcome: e.outcome,
  actorKind: e.actorKind,
  userId: e.userId,
  tokenId: e.tokenId,
  ip: e.ip,
  method: e.method,
  path: e.path,
  status: e.status,
  query: e.query ?? null,
  body: e.body ?? null,
  truncated: e.truncated,
  requestId: e.requestId,
  subjectType: e.subjectType,
  subjectId: e.subjectId,
  payload: e.payload ?? null,
});

export function registerAuditRoutes(r: RouteRegistrar, service: AuditInternals) {
  const { viewer, system } = service;

  // `export.csv` before `{id}`: the static path wins.
  r.internal(exportAuditRoute, (async (c) => {
    const { from, to, ...rest } = c.req.valid('query');
    const result = await viewer.exportCsv(c.get('actor'), {
      ...rest,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return new Response(result.stream, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-row-count': String(result.rows),
        'x-row-cap': String(result.cap),
        'x-truncated': String(result.capped),
      },
    });
  }) satisfies RouteHandler<typeof exportAuditRoute, AppEnv>);

  r.internal(listAuditRoute, (async (c) => {
    const { page, pageSize, from, to, ...filter } = c.req.valid('query');
    const { events, total } = await viewer.list(
      c.get('actor'),
      { ...filter, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined },
      { page, pageSize },
    );
    return c.json(paginate({ page, pageSize }, total, events.map(eventView)), 200);
  }) satisfies RouteHandler<typeof listAuditRoute, AppEnv>);

  r.internal(getAuditRoute, (async (c) => {
    return c.json(eventView(await viewer.get(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof getAuditRoute, AppEnv>);

  r.internal(outboxRoute, (async (c) => {
    const { stats, dead } = await system.outbox(c.get('actor'));
    return c.json(
      {
        stats,
        dead: dead.map((d) => ({
          ...d,
          occurredAt: d.occurredAt.toISOString(),
          failedAt: d.failedAt.toISOString(),
        })),
      },
      200,
    );
  }) satisfies RouteHandler<typeof outboxRoute, AppEnv>);

  r.internal(jobRunsRoute, (async (c) => {
    const { page, pageSize, ...query } = c.req.valid('query');
    const { runs, total } = await system.jobRuns(c.get('actor'), query, { page, pageSize });
    return c.json(
      paginate(
        { page, pageSize },
        total,
        runs.map((run) => ({
          id: run.id,
          jobName: run.jobName,
          module: run.module,
          attempt: run.attempt,
          status: run.status,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          durationMs: run.durationMs,
          error: run.error,
          result: run.result,
        })),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof jobRunsRoute, AppEnv>);

  r.internal(requeueOutboxRoute, (async (c) => {
    return c.json(await system.requeue(c.get('actor'), c.req.valid('param').id), 200);
  }) satisfies RouteHandler<typeof requeueOutboxRoute, AppEnv>);
}
