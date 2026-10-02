import { OpenAPIHono } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import {
  Invalid,
  problemResponse,
  type AppEnv,
  type AppRoute,
  type RateLimitGroup,
} from '@scorpion/contracts';
import {
  anonymousOnly,
  mountPath,
  type Authenticator,
  type Authorizer,
  type Config,
  type Logger,
  type RateLimit,
  type RateLimiter,
  type RegisteredRoute,
} from '@scorpion/kernel';
import { authenticate } from './pipeline/authenticate.ts';
import { withAuthorization } from './pipeline/authorize.ts';
import { DEFAULT_MAX_BODY_BYTES, limitBody } from './pipeline/body-limit.ts';
import { createClientIpResolver } from './pipeline/client-ip.ts';
import { errorMapper, fieldProblems, notFoundHandler } from './pipeline/errors.ts';
import { requestLogging, type RequestInfo } from './pipeline/logging.ts';
import { RATE_LIMITS, rateLimit } from './pipeline/rate-limit.ts';
import { requestId } from './pipeline/request-id.ts';
import { securityHeaders } from './pipeline/security-headers.ts';
import { healthz, metricsRoute, readyz, type SystemProbes } from './system-routes.ts';

export const SURFACE_PREFIX = { internal: '/api/internal', v1: '/api/v1' } as const;

export interface AppOptions {
  config: Pick<Config, 'BASE_PATH' | 'PROFILE'> & Partial<Pick<Config, 'TRUSTED_PROXIES'>>;
  log: Logger;
  /** The routes the modules registered (`kernel.routes`). */
  routes: readonly RegisteredRoute[];
  /** Resolves credentials to an actor (`kernel.authenticator`). Default: everyone is anonymous. */
  authenticator?: Authenticator;
  /** Decides non-public routes (`kernel.authorizer`). */
  authorizer: Authorizer;
  /**
   * Charges the rate-limit buckets of every module route (`kernel.rateLimiter`). Without it nothing
   * is limited, which only tests want.
   */
  rateLimiter?: RateLimiter;
  /** Limits per route group, for tests. Default: `RATE_LIMITS`. */
  rateLimits?: Partial<Record<RateLimitGroup, RateLimit>>;
  /** Largest accepted request body. Default 1 MiB. */
  maxBodyBytes?: number;
  /** Called after every request; the metrics use it. */
  onRequest?: (info: RequestInfo) => void;
  /** What `/readyz` and `/metrics` report. */
  probes: SystemProbes;
  /**
   * The kernel is still starting: serve the probes and answer everything else with 503. The server
   * listens from the first moment, so `/readyz` can say "not yet" while migrations run.
   */
  booting?: boolean;
}

/**
 * The HTTP application. Every request passes the same steps, in this order:
 *
 *  1. request id           5. body size limit      8. handler
 *  2. security headers     6. input validation     9. error mapper
 *  3. request logging      7. authorisation hook
 *  4. rate limit and authentication
 *
 * Steps 1 to 3 and 5 are middleware for every request; step 4 is added per route, because its
 * bucket is the route's group, and runs before the body is read; 6 to 8 run per route (Zod
 * validation, then the hook, then the handler); 9 catches whatever any step throws. Routes are
 * mounted under `BASE_PATH`, which may have any number of segments.
 */
export function createApp(options: AppOptions): Hono<AppEnv> {
  const { config, log } = options;
  const base = mountPath(config);

  const app = new OpenAPIHono<AppEnv>({
    // Step 5: a request that fails validation is a 422 problem listing every bad field.
    defaultHook: (result) => {
      if (!result.success) {
        throw new Invalid(
          'The request is not valid.',
          fieldProblems(result.error.issues, result.target),
        );
      }
    },
  });

  app.use('*', requestId());
  app.use('*', securityHeaders());
  app.use('*', requestLogging(log, options.onRequest));
  app.use('*', limitBody(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES));

  const clientIp = createClientIpResolver(config.TRUSTED_PROXIES ?? []);
  const limits = { ...RATE_LIMITS, ...options.rateLimits };

  const mount = (
    route: AppRoute,
    path: string,
    handler: RegisteredRoute['handler'],
    module: string,
    moduleRoute = false,
  ) => {
    if (moduleRoute) {
      // Step 2 (rate limit), then step 3 (authentication), before validation and the handler.
      const group = route.rateLimit ?? 'default';
      const honoPath = `${base}${path}`.replace(/\{(\w+)\}/g, ':$1');
      const method = route.method.toUpperCase();
      if (options.rateLimiter) {
        const limit = limits[group];
        app.on(
          method,
          honoPath,
          rateLimit({ limiter: options.rateLimiter, group, limit, clientIp, log }),
        );
      }
      app.on(method, honoPath, authenticate(options.authenticator ?? anonymousOnly, route));
    }
    app.openapi(
      { ...route, path: `${base}${path}` } as never,
      withAuthorization({ module, route, path }, handler, options.authorizer) as never,
    );
  };

  mount(healthz, '/healthz', (c) => c.json({ status: 'ok', profile: config.PROFILE }), 'server');
  mount(
    readyz,
    '/readyz',
    async (c) => {
      const result = await options.probes.readiness();
      c.header('cache-control', 'no-store');
      return c.json(
        {
          status: result.ready ? ('ready' as const) : ('unavailable' as const),
          checks: result.checks,
        },
        result.ready ? 200 : 503,
      );
    },
    'server',
  );
  mount(
    metricsRoute,
    '/metrics',
    async (c) => {
      c.header('cache-control', 'no-store');
      return c.text(await options.probes.metrics.render(), 200, {
        'content-type': options.probes.metrics.contentType,
      });
    },
    'server',
  );
  for (const { module, surface, route, handler } of options.routes) {
    mount(route, `${SURFACE_PREFIX[surface]}${route.path}`, handler, module, true);
  }
  if (options.booting) {
    app.all('*', (c) =>
      problemResponse(
        {
          type: 'about:blank',
          title: 'Service Unavailable',
          status: 503,
          detail: 'The server is starting. Try again in a moment.',
          requestId: c.get('requestId'),
        },
        { 'retry-after': '5' },
      ),
    );
  }

  app.onError(errorMapper(log));
  app.notFound(notFoundHandler());
  return app;
}
