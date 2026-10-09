// The membership routes of registry.organisations (internal API). Thin: Zod parses, one service call,
// the result is mapped. A delegated route carries the plain `…organisation.read` and the SERVICE is the
// authorization (ADR-0034): it calls `ctx.authz.require` with the scoped permission and the
// organisation. A route without that service check would be an open endpoint, which is why the
// defect-1 matrix has a row for every one of them that expects 403 for a plain User.
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
import type {
  ManagedMembership,
  Member,
  MembershipsService,
  OwnMembership,
} from './service/memberships.ts';
import { DECIDER_ACTIONS, ROLES, STATES } from './service/membership-state.ts';
import { PERMISSION_READ, PERMISSION_REQUEST } from './service/permissions.ts';

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});
const idParam = z.object({ id: z.uuid() });

const organisationRef = z.object({
  id: z.string(),
  type: z.string(),
  abbreviation: z.string(),
  name: z.string(),
});
const stateSchema = z.enum(STATES);
const roleSchema = z.enum(ROLES);

const ownSchema = z.object({
  id: z.string(),
  organisation: organisationRef,
  state: stateSchema,
  role: roleSchema,
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
});

const managedSchema = z.object({
  id: z.string(),
  organisation: organisationRef,
  userId: z.string(),
  username: z
    .string()
    .nullable()
    .describe('`null` for an account that is gone; its rows are removed by the purge.'),
  state: stateSchema,
  role: roleSchema,
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  roleChangedAt: z.iso.datetime().nullable(),
  allowedActions: z
    .array(z.enum(DECIDER_ACTIONS))
    .describe(
      'What the caller may do to this row now. Draw buttons from it; every action is checked again when it is taken.',
    ),
});

const memberSchema = z.object({
  username: z.string(),
  since: z.iso.datetime(),
});

const requestRoute = createRoute({
  method: 'post',
  path: '/organisations/{id}/membership',
  permission: PERMISSION_REQUEST,
  request: { params: idParam },
  responses: {
    200: ok('The person had already asked or is a member: the current row.', ownSchema),
    201: ok('A new request, or a reopened one.', ownSchema),
    404: { description: 'No such organisation.' },
    409: { description: '`too-many-pending`: the person has the most open requests allowed.' },
    422: {
      description: '`membership-not-supported`: the type of this organisation has no members.',
    },
  },
});

const leaveRoute = createRoute({
  method: 'delete',
  path: '/organisations/{id}/membership',
  permission: PERMISSION_REQUEST,
  request: { params: idParam },
  responses: {
    200: ok('The row after the request was withdrawn or the membership ended.', ownSchema),
    404: { description: 'The caller has no membership or request to end here.' },
  },
});

const ownRoute = createRoute({
  method: 'get',
  path: '/account/memberships',
  permission: PERMISSION_REQUEST,
  request: { query: paginationQuery() },
  responses: {
    200: ok(
      'The caller’s own rows in every state, by abbreviation then id.',
      listEnvelope(ownSchema),
    ),
  },
});

const membersRoute = createRoute({
  method: 'get',
  path: '/organisations/{id}/members',
  permission: PERMISSION_READ, // the service requires `…membership.view-members` on the organisation
  request: { params: idParam, query: paginationQuery() },
  responses: {
    200: ok(
      'The approved members: usernames and join dates, never an address or a state.',
      listEnvelope(memberSchema),
    ),
    403: { description: 'Not an administrator, a manager or (while the setting is on) a member.' },
    404: { description: 'No such organisation.' },
  },
});

const listRoute = createRoute({
  method: 'get',
  path: '/memberships',
  permission: PERMISSION_READ, // the service decides who may see which organisation
  request: {
    query: paginationQuery().extend({
      state: stateSchema.optional(),
      organisationId: z.uuid().optional(),
      type: z.string().max(64).optional(),
    }),
  },
  responses: {
    200: ok(
      'Requests and members the caller may decide on, oldest request first. An Admin sees every organisation, a manager the ones they manage.',
      listEnvelope(managedSchema),
    ),
    403: {
      description:
        'The caller is neither an administrator nor a manager (or filters on an organisation they do not manage).',
    },
  },
});

const summaryRoute = createRoute({
  method: 'get',
  path: '/memberships/summary',
  permission: PERMISSION_READ,
  responses: {
    200: ok(
      '`pending`: the requests the caller may decide; `manages`: whether they manage an organisation. Zeros for a plain user.',
      z.object({ pending: z.number().int(), manages: z.boolean() }),
    ),
  },
});

const decisionRoute = createRoute({
  method: 'post',
  path: '/memberships/{id}/decision',
  permission: PERMISSION_READ, // the service requires `…membership.decide` on the organisation
  audit: true,
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.strictObject({ decision: z.enum(['approved', 'rejected']) }),
        },
      },
    },
  },
  responses: {
    200: ok('The row after the decision.', managedSchema),
    403: { description: 'No right on this organisation, or the caller’s own request.' },
    404: { description: 'No such membership.' },
    409: { description: '`membership-state`: it is no longer a request.' },
  },
});

const roleRoute = createRoute({
  method: 'post',
  path: '/memberships/{id}/role',
  permission: PERMISSION_READ, // the service requires `…membership.manage-roles` on the organisation
  audit: true,
  request: {
    params: idParam,
    body: {
      required: true,
      content: {
        'application/json': { schema: z.strictObject({ role: roleSchema }) },
      },
    },
  },
  responses: {
    200: ok('The row with the role (also when it already had it).', managedSchema),
    403: { description: 'No right on this organisation, or the caller’s own role.' },
    404: { description: 'No such membership.' },
    409: {
      description:
        '`membership-state` (not an approved member) or `too-many-managers` (the limit of the setting).',
    },
  },
});

const removeRoute = createRoute({
  method: 'post',
  path: '/memberships/{id}/remove',
  permission: PERMISSION_READ, // the service requires `…membership.remove` on the organisation
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok('The row after the membership ended.', managedSchema),
    403: {
      description:
        'No right on this organisation, the caller’s own row (use leave), or a manager as the target of a manager.',
    },
    404: { description: 'No such membership.' },
    409: { description: '`membership-state`: it is not an approved membership.' },
  },
});

const date = (value: Date | null) => (value === null ? null : value.toISOString());

const ownOut = (m: OwnMembership) => ({
  id: m.id,
  organisation: m.organisation,
  state: m.state,
  role: m.role,
  requestedAt: m.requestedAt.toISOString(),
  decidedAt: date(m.decidedAt),
  endedAt: date(m.endedAt),
});

/** Field by field on purpose: nothing that is added to a row later is exposed by accident. Never an address. */
const managedOut = (m: ManagedMembership) => ({
  id: m.id,
  organisation: m.organisation,
  userId: m.userId,
  username: m.username,
  state: m.state,
  role: m.role,
  requestedAt: m.requestedAt.toISOString(),
  decidedAt: date(m.decidedAt),
  roleChangedAt: date(m.roleChangedAt),
  allowedActions: m.allowedActions,
});

const memberOut = (m: Member) => ({ username: m.username, since: m.since.toISOString() });

export function registerMembershipRoutes(r: RouteRegistrar, service: MembershipsService) {
  r.internal(requestRoute, (async (c) => {
    const { membership, created } = await service.request(c.get('actor'), c.req.valid('param').id);
    return c.json(ownOut(membership), created ? 201 : 200);
  }) satisfies RouteHandler<typeof requestRoute, AppEnv>);

  r.internal(leaveRoute, (async (c) => {
    return c.json(ownOut(await service.leave(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof leaveRoute, AppEnv>);

  r.internal(ownRoute, (async (c) => {
    const page = c.req.valid('query');
    const { items, total } = await service.listOwn(c.get('actor'), page);
    return c.json(paginate(page, total, items.map(ownOut)), 200);
  }) satisfies RouteHandler<typeof ownRoute, AppEnv>);

  r.internal(membersRoute, (async (c) => {
    const page = c.req.valid('query');
    const { items, total } = await service.listMembers(
      c.get('actor'),
      c.req.valid('param').id,
      page,
    );
    return c.json(paginate(page, total, items.map(memberOut)), 200);
  }) satisfies RouteHandler<typeof membersRoute, AppEnv>);

  r.internal(listRoute, (async (c) => {
    const { page, pageSize, ...filter } = c.req.valid('query');
    const { items, total } = await service.listPending(c.get('actor'), filter, { page, pageSize });
    return c.json(paginate({ page, pageSize }, total, items.map(managedOut)), 200);
  }) satisfies RouteHandler<typeof listRoute, AppEnv>);

  r.internal(summaryRoute, (async (c) => {
    return c.json(await service.summary(c.get('actor')), 200);
  }) satisfies RouteHandler<typeof summaryRoute, AppEnv>);

  r.internal(decisionRoute, (async (c) => {
    const row = await service.decide(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json').decision,
    );
    return c.json(managedOut(row), 200);
  }) satisfies RouteHandler<typeof decisionRoute, AppEnv>);

  r.internal(roleRoute, (async (c) => {
    const row = await service.setRole(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json').role,
    );
    return c.json(managedOut(row), 200);
  }) satisfies RouteHandler<typeof roleRoute, AppEnv>);

  r.internal(removeRoute, (async (c) => {
    return c.json(managedOut(await service.remove(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof removeRoute, AppEnv>);
}
