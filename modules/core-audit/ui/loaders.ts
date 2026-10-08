// What the pages of core.audit need before they render. They run on the server, after the permission
// check, and **throw** when they cannot get their data (defect 12). A part of a page that the caller's role
// does not allow (the retention settings on the system page) is left out; any other failure fails the page.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import { logsApiQuery, LOG_PAGE_SIZE, parseLogsQuery, type LogsQuery } from './query.ts';

export interface LogEntry {
  id: string;
  occurredAt: string;
  source: 'event' | 'api';
  action: string;
  outcome: 'ok' | 'denied' | 'error';
  actorKind: 'user' | 'token' | 'anonymous' | 'system';
  userId: string | null;
  userName: string | null;
  tokenId: string | null;
  ip: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  query?: unknown;
  body?: unknown;
  truncated: boolean;
  requestId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  payload?: unknown;
}

export interface LogsData {
  query: LogsQuery;
  /** The first page; the page asks for the next ones itself ("load more"). */
  entries: LogEntry[];
  total: number;
}

export async function loadLogs({ api, url }: UiLoadContext): Promise<LogsData> {
  const query = parseLogsQuery(url.searchParams);
  const answer = await unwrap(
    api.GET('/audit', {
      params: { query: { ...logsApiQuery(query), page: '0', pageSize: String(LOG_PAGE_SIZE) } },
    }),
  );
  return { query, entries: answer.result, total: answer.metadata.totalCount };
}

export async function loadLogEntry({ api, params }: UiLoadContext): Promise<{ entry: LogEntry }> {
  return { entry: await unwrap(api.GET('/audit/{id}', { params: { path: { id: params.id! } } })) };
}

export interface DeadDelivery {
  deliveryId: string;
  eventName: string;
  subscriber: string;
  attempts: number;
  lastError: string | null;
  occurredAt: string;
  failedAt: string;
}

export interface JobRun {
  id: string;
  jobName: string;
  module: string;
  attempt: number;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  result: Record<string, number | boolean | string> | null;
}

export const RETENTION_KEYS = [
  'retentionDays',
  'apiRetentionDays',
  'ipTruncateAfterDays',
  'outboxRetentionDays',
  'jobRunRetentionDays',
] as const;

export interface SystemData {
  outbox: { pending: number; dead: number; lagSeconds: number };
  dead: DeadDelivery[];
  jobRuns: { runs: JobRun[]; total: number; page: number; pageSize: number };
  /** The retention numbers of core.audit, or `null` when the caller may not read settings. */
  retention: Partial<Record<(typeof RETENTION_KEYS)[number], number>> | null;
}

export const JOB_RUNS_PAGE_SIZE = 20;

async function allowed<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null;
    throw error;
  }
}

export async function loadSystem({ api, url }: UiLoadContext): Promise<SystemData> {
  const page = /^\d{1,6}$/.test(url.searchParams.get('page') ?? '')
    ? Number(url.searchParams.get('page'))
    : 0;
  const [outbox, runs, settings] = await Promise.all([
    unwrap(api.GET('/system/outbox')),
    unwrap(
      api.GET('/system/job-runs', {
        params: { query: { page: String(page), pageSize: String(JOB_RUNS_PAGE_SIZE) } },
      }),
    ),
    allowed(unwrap(api.GET('/settings/{module}', { params: { path: { module: 'core.audit' } } }))),
  ]);
  const retention = settings
    ? Object.fromEntries(
        RETENTION_KEYS.flatMap((key) => {
          const value = settings.values[key];
          return typeof value === 'number' ? [[key, value]] : [];
        }),
      )
    : null;
  return {
    outbox: outbox.stats,
    dead: outbox.dead,
    jobRuns: {
      runs: runs.result,
      total: runs.metadata.totalCount,
      page,
      pageSize: JOB_RUNS_PAGE_SIZE,
    },
    retention,
  };
}
