import { createRoute, z } from '@scorpion/contracts';
import type { Metrics } from './metrics.ts';

export interface ReadinessResult {
  ready: boolean;
  checks: {
    /** The database answers a query. */
    database: 'ok' | 'unavailable';
    /** Every module's migrations are applied. `unknown` when the database cannot be asked. */
    migrations: 'complete' | 'pending' | 'unknown';
    /** The kernel has finished starting and is not shutting down. */
    kernel: 'started' | 'starting' | 'stopping';
  };
}

export interface SystemProbes {
  readiness(): Promise<ReadinessResult>;
  metrics: Metrics;
}

const json = <S extends z.ZodType>(schema: S) => ({ 'application/json': { schema } });

export const healthz = createRoute({
  method: 'get',
  path: '/healthz',
  public: true,
  publicReason:
    'Liveness probe for the container runtime and load balancers; it reveals only that the process runs and never touches the database.',
  responses: {
    200: {
      description: 'The process is alive.',
      content: json(z.object({ status: z.literal('ok'), profile: z.string() })),
    },
  },
});

const readiness = z.object({
  status: z.enum(['ready', 'unavailable']),
  checks: z.object({
    database: z.enum(['ok', 'unavailable']),
    migrations: z.enum(['complete', 'pending', 'unknown']),
    kernel: z.enum(['started', 'starting', 'stopping']),
  }),
});

export const readyz = createRoute({
  method: 'get',
  path: '/readyz',
  public: true,
  publicReason:
    'Readiness probe for the orchestrator; it reports only coarse states (database reachable, migrations complete, started) and no module names or data.',
  responses: {
    200: {
      description: 'The database answers and all migrations are applied.',
      content: json(readiness),
    },
    503: { description: 'Not ready yet, or shutting down.', content: json(readiness) },
  },
});

export const metricsRoute = createRoute({
  method: 'get',
  path: '/metrics',
  public: true,
  publicReason:
    'Prometheus scrape endpoint. It carries operational numbers only (durations by route pattern, queue lag), no personal data; restrict it at the proxy if the network is not trusted.',
  responses: {
    200: {
      description: 'Prometheus text exposition format.',
      content: { 'text/plain': { schema: z.string() } },
    },
  },
});
