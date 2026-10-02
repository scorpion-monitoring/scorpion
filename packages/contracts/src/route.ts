import type { Handler } from 'hono';
import {
  createRoute as createOpenApiRoute,
  z,
  type RouteConfig,
  type RouteHandler,
} from '@hono/zod-openapi';
import type { Actor } from './actor.ts';
import { PROBLEM_CONTENT_TYPE, problemSchema } from './problem.ts';

/** Who may call a route: a permission id, or everyone (with the reason written down). */
export type RouteAccess =
  | {
      /** A permission id declared by the module that owns the route. */
      permission: string;
      public?: never;
      publicReason?: never;
    }
  | {
      /** Open to anyone, including anonymous callers. */
      public: true;
      /** Why: the one-line justification a reviewer reads. */
      publicReason: string;
      permission?: never;
    };

/**
 * The rate-limit bucket a route draws from (pipeline step 2). `strict` is for routes an attacker
 * gains from by repeating them: login, register, token use and creation, onboarding submission.
 */
export type RateLimitGroup = 'default' | 'strict';

export type AppRouteConfig = RouteConfig &
  RouteAccess & {
    /** Default: `default`. */
    rateLimit?: RateLimitGroup;
    /**
     * The largest request body this route accepts, in bytes, where the server-wide limit (1 MiB) is
     * too small: an upload. A route can only raise the limit by naming the number; a request over
     * it is refused with 413 before the body is read.
     */
    maxBodyBytes?: number;
    /** Write an audit entry for every call (`core.audit`, M4). */
    audit?: boolean;
  };

export type AppRoute = RouteConfig & {
  permission?: string;
  public?: boolean;
  publicReason?: string;
  rateLimit?: RateLimitGroup;
  maxBodyBytes?: number;
  audit?: boolean;
};

export type { RouteHandler };
export type { Context } from 'hono';

/**
 * A route handler as the registry stores it. Handlers are typed precisely where they are written
 * (`RouteHandler<typeof route>`); the registry only needs to call them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHandler = Handler<any, any, any, any>;

const problemContent = { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } };

/**
 * Defines a route. Same as `createRoute()` of `@hono/zod-openapi`, except that it requires either
 * `permission` or `public: true` with a `publicReason`, and that it documents the problem
 * responses every route can produce (401, 403, 422, 500) unless the route declares them itself.
 *
 * The check that the permission belongs to the module runs when the module registers the route
 * (`assertRouteAccess`), where the module is known.
 */
export function createRoute<const R extends AppRouteConfig>(config: R): R {
  const hasInput = config.request !== undefined && Object.keys(config.request).length > 0;
  const standard: RouteConfig['responses'] = {
    ...(config.public
      ? {}
      : { 401: { description: 'Not authenticated.', content: problemContent } }),
    ...(config.public ? {} : { 403: { description: 'Not allowed.', content: problemContent } }),
    ...(hasInput
      ? { 422: { description: 'The input is not valid.', content: problemContent } }
      : {}),
    500: { description: 'Unexpected error.', content: problemContent },
  };
  return createOpenApiRoute({
    ...config,
    responses: { ...standard, ...config.responses },
  });
}

/** `GET /things/{id}`: how errors name a route. */
export function describeRoute(route: Pick<AppRoute, 'method' | 'path'>): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

/**
 * Checks the access declaration of a route and returns what is wrong with it, or `undefined`.
 * `declaredPermissions` are the permission ids of the owning module.
 */
export function checkRouteAccess(
  route: AppRoute,
  declaredPermissions: ReadonlySet<string>,
): string | undefined {
  const { permission } = route;
  if (route.public === true) {
    if (permission !== undefined) return 'is public but also names a permission';
    if (typeof route.publicReason !== 'string' || route.publicReason.trim() === '') {
      return 'is public: true without a publicReason';
    }
    return undefined;
  }
  if (route.public !== undefined && route.public !== false) return 'has an invalid public flag';
  if (typeof permission !== 'string' || permission === '') {
    return 'needs a permission (or public: true with a publicReason)';
  }
  if (!declaredPermissions.has(permission)) {
    return `names permission "${permission}", which its module does not declare`;
  }
  return undefined;
}

export { z };

/** What handlers see besides the request: set by the request pipeline. */
export interface AppEnv {
  Variables: {
    /** The id of this request (`X-Request-Id`), also in the logs and in every problem response. */
    requestId: string;
    /** Who is calling: set by the authentication step, `anonymous` without credentials. */
    actor: Actor;
  };
}
