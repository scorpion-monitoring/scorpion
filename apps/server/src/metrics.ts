import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';
import { outboxStats, type Db, type JobRunReport, type Logger } from '@scorpion/kernel';
import type { RequestInfo } from './pipeline/logging.ts';

export interface Metrics {
  registry: Registry;
  /** Feed every finished request into the HTTP duration histogram. */
  onRequest: (info: RequestInfo) => void;
  /** Feed every finished job attempt into the job duration histogram. */
  onJobRun: (report: JobRunReport) => void;
  /** Start reading the outbox gauges from the database at scrape time. */
  watchOutbox: (db: Db, log: Logger) => void;
  render: () => Promise<string>;
  contentType: string;
}

/**
 * Prometheus metrics: the default process metrics, HTTP request duration by route and status,
 * outbox lag, and job durations by status. Each server gets its own registry, so tests do not
 * share counters.
 */
export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const http = new Histogram({
    name: 'scorpion_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route pattern and status code.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  const jobs = new Histogram({
    name: 'scorpion_job_duration_seconds',
    help: 'Job attempt duration in seconds, by job name and status (succeeded or failed).',
    labelNames: ['job', 'status'] as const,
    buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 300, 900, 3600],
    registers: [registry],
  });

  // The outbox gauges are read from the database when Prometheus scrapes. One query serves all
  // three, and a scrape that finds the database down keeps the last values instead of failing.
  let source: { db: Db; log: Logger } | undefined;
  let last = { pending: 0, dead: 0, lagSeconds: 0 };
  let cache: { at: number; value: Promise<void> } | undefined;
  const refresh = (): Promise<void> => {
    if (!source) return Promise.resolve();
    const now = Date.now();
    if (cache && now - cache.at < 1000) return cache.value;
    const { db, log } = source;
    const value = outboxStats(db).then(
      (stats) => {
        last = stats;
      },
      (error: unknown) => {
        log.warn({ err: error }, 'could not read the outbox statistics for /metrics');
      },
    );
    cache = { at: now, value };
    return value;
  };

  new Gauge({
    name: 'scorpion_outbox_lag_seconds',
    help: 'Age in seconds of the oldest event delivery still waiting; 0 when none waits.',
    registers: [registry],
    async collect() {
      await refresh();
      this.set(last.lagSeconds);
    },
  });
  new Gauge({
    name: 'scorpion_outbox_pending_deliveries',
    help: 'Event deliveries waiting to be delivered or retried.',
    registers: [registry],
    async collect() {
      await refresh();
      this.set(last.pending);
    },
  });
  new Gauge({
    name: 'scorpion_outbox_dead_deliveries',
    help: 'Event deliveries that ran out of attempts.',
    registers: [registry],
    async collect() {
      await refresh();
      this.set(last.dead);
    },
  });

  return {
    registry,
    contentType: registry.contentType,
    onRequest: ({ method, route, status, durationSeconds }) =>
      http.observe({ method, route, status: String(status) }, durationSeconds),
    onJobRun: ({ job, status, durationSeconds }) => jobs.observe({ job, status }, durationSeconds),
    watchOutbox(db, log) {
      source = { db, log };
    },
    render: () => registry.metrics(),
  };
}
