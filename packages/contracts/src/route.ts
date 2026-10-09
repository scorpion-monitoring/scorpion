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

/**
 * What a route asks of the audit trail (`core.audit`, ADR 0021). `true` records who called, what,
 * and the outcome, including denied (401, 403) and invalid (422) calls. The body and the query
 * string are stored only with `body: true`, redacted and capped; `redact` adds key names to the
 * sink's own list. A route under `/auth/` can never store a body.
 */
export type RouteAuditOption = boolean | { body?: boolean; redact?: string[] };

/** Routes under `/auth/` carry credentials: the audit trail never stores their body or query. */
export const NEVER_AUDIT_BODY = /^\/auth\//;

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
    /** Write an audit entry for every call (`core.audit`, ADR 0021). */
    audit?: RouteAuditOption;
  };

export type AppRoute = RouteConfig & {
  permission?: string;
  public?: boolean;
  publicReason?: string;
  rateLimit?: RateLimitGroup;
  maxBodyBytes?: number;
  audit?: RouteAuditOption;
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
  const audit = checkRouteAudit(route);
  if (audit) return audit;
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

/** What is wrong with the `audit` option of a route, or `undefined`. */
export function checkRouteAudit(route: AppRoute): string | undefined {
  const { audit } = route;
  if (audit === undefined || typeof audit === 'boolean') return undefined;
  if (audit === null || typeof audit !== 'object' || Array.isArray(audit)) {
    return 'has an invalid audit option';
  }
  if (Object.keys(audit).some((key) => key !== 'body' && key !== 'redact')) {
    return 'has an audit option with unknown keys (use body and redact)';
  }
  if (audit.body !== undefined && typeof audit.body !== 'boolean') {
    return 'has an audit option whose body is not a boolean';
  }
  if (
    audit.redact !== undefined &&
    (!Array.isArray(audit.redact) ||
      audit.redact.some((key) => typeof key !== 'string' || key === ''))
  ) {
    return 'has an audit option whose redact is not a list of key names';
  }
  if (audit.body === true && NEVER_AUDIT_BODY.test(route.path)) {
    return 'stores a body in the audit trail, which a route under /auth/ must never do';
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
    /** The client's address as the pipeline resolves it (trusted proxies); `undefined` without a socket. */
    clientIp: string | undefined;
    /**
     * Asks the authentication step again, with the credentials this request carried, whether the same
     * caller is still good: `false` once the session ended or expired, or the token was revoked or ran
     * out, or the account may not sign in any more. It is **passive**: it does not count as activity, so
     * it never slides the inactivity end of a session. For a response that outlives the check made at the
     * start (an event stream, ADR-0028); an anonymous caller gets `false`.
     */
    recheckActor: () => Promise<boolean>;
  };
}
