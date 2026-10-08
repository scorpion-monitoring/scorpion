// The HTTP routes of core.authz. Thin: Zod parses, one service call, the result is mapped. They are
// internal routes (`/api/internal/...`) for the administration screens. Listing roles and giving or
// taking a role stay with core.identity, which owns the users those routes name (ADR 0015).
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
import type { AuthzService } from './public.ts';

const roleSchema = z.object({
  key: z.string(),
  label: z.string(),
  system: z.boolean(),
  /** Admin lists every permission a loaded module declares. */
  permissions: z.array(z.string()),
});

/** The most permissions one request can name: far above what the loaded modules declare. */
export const PERMISSIONS_MAX = 1000;

export const setRolePermissionsInput = z.strictObject({
  permissions: z.array(z.string().min(1).max(200)).max(PERMISSIONS_MAX),
});

export const setRolePermissionsRoute = createRoute({
  method: 'put',
  path: '/roles/{key}/permissions',
  permission: 'core.authz.role.manage',
  audit: { body: true },
  request: {
    params: z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/) }),
    body: {
      required: true,
      content: { 'application/json': { schema: setRolePermissionsInput } },
    },
  },
  responses: {
    200: {
      description:
        'The role now holds exactly these permissions. Saving the set it already holds changes nothing and leaves no event.',
      content: { 'application/json': { schema: roleSchema } },
    },
    403: { description: 'Admin holds every permission and cannot be edited.' },
    404: { description: 'No such role.' },
    422: { description: 'A permission that no loaded module declares.' },
  },
});

const permissionSchema = z.object({
  id: z.string(),
  module: z.string().describe('The id of the module that declares the permission.'),
  description: z.string(),
});

export const listPermissionsRoute = createRoute({
  method: 'get',
  path: '/permissions',
  permission: 'core.authz.role.read',
  request: { query: paginationQuery({ defaultPageSize: 100, maxPageSize: 500 }) },
  responses: {
    200: {
      description:
        'Every permission a loaded module declares, by id, with the module and a description. What a role editor offers.',
      content: { 'application/json': { schema: listEnvelope(permissionSchema) } },
    },
  },
});

export const accountPermissionsRoute = createRoute({
  method: 'get',
  path: '/account/permissions',
  permission: 'core.authz.account.read',
  request: { query: paginationQuery({ defaultPageSize: 100, maxPageSize: 500 }) },
  responses: {
    200: {
      description:
        'The permissions the caller holds now, by id. For an access token only those its scopes name as well. What a token form offers as scopes.',
      content: { 'application/json': { schema: listEnvelope(permissionSchema) } },
    },
  },
});

export function registerAuthzRoutes(r: RouteRegistrar, authz: AuthzService) {
  r.internal(setRolePermissionsRoute, (async (c) => {
    const updated = await authz.setRolePermissions(
      c.get('actor'),
      c.req.valid('param').key,
      c.req.valid('json').permissions,
    );
    return c.json(updated, 200);
  }) satisfies RouteHandler<typeof setRolePermissionsRoute, AppEnv>);

  r.internal(listPermissionsRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await authz.listPermissions(c.get('actor'));
    const from = pageOffset(query);
    return c.json(paginate(query, all.length, all.slice(from, from + query.pageSize)), 200);
  }) satisfies RouteHandler<typeof listPermissionsRoute, AppEnv>);

  r.internal(accountPermissionsRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await authz.permissionsHeldBy(c.get('actor'));
    const from = pageOffset(query);
    return c.json(paginate(query, all.length, all.slice(from, from + query.pageSize)), 200);
  }) satisfies RouteHandler<typeof accountPermissionsRoute, AppEnv>);
}
