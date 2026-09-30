import { OpenAPIHono } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { Invalid, problemResponse, type AppEnv, type AppRoute } from '@scorpion/contracts';
import {
  mountPath,
  type Authorizer,
  type Config,
  type Logger,
  type RegisteredRoute,
} from '@scorpion/kernel';
import { withAuthorization } from './pipeline/authorize.ts';
import { DEFAULT_MAX_BODY_BYTES, limitBody } from './pipeline/body-limit.ts';
import { errorMapper, fieldProblems, notFoundHandler } from './pipeline/errors.ts';
import { requestLogging, type RequestInfo } from './pipeline/logging.ts';
import { requestId } from './pipeline/request-id.ts';
import { securityHeaders } from './pipeline/security-headers.ts';
import { healthz, metricsRoute, readyz, type SystemProbes } from './system-routes.ts';

export const SURFACE_PREFIX = { internal: '/api/internal', v1: '/api/v1' } as const;

export interface AppOptions {
  config: Pick<Config, 'BASE_PATH' | 'PROFILE'>;
  log: Logger;
  /** The routes the modules registered (`kernel.routes`). */
  routes: readonly RegisteredRoute[];
  /** Decides non-public routes (`kernel.authorizer`). */
  authorizer: Authorizer;
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
 *  1. request id           4. body size limit      7. handler
 *  2. security headers     5. input validation     8. error mapper
 *  3. request logging      6. authorisation hook
 *
 * Steps 1 to 4 are middleware; 5 to 7 run per route (Zod validation, then the hook, then the
 * handler); 8 catches whatever any step throws. Routes are mounted under `BASE_PATH`, which may
 * have any number of segments.
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

  const mount = (
    route: AppRoute,
    path: string,
    handler: RegisteredRoute['handler'],
    module: string,
  ) => {
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
    mount(route, `${SURFACE_PREFIX[surface]}${route.path}`, handler, module);
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
