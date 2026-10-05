// The jobs facade over pg-boss (ADR 0003 covers events; jobs are the other half of "background
// work"). Modules declare jobs in their manifest; the facade creates the queues, schedules the
// cron jobs, runs the handlers and writes one `kernel_job_run` row per attempt.
import { sql } from 'drizzle-orm';
import { PgBoss, type Job } from 'pg-boss';
import type { z } from 'zod';
import type { Db } from './db.ts';
import { KernelStartupError } from './errors.ts';
import { ids } from './ids.ts';
import { childLogger, type Logger } from './logger.ts';
import type { JobDef, JobResult, ModuleManifest } from './manifest.ts';
import type { ModuleContext } from './context.ts';
import { maskString } from './redact.ts';

/** A returned summary is kept only when it is a flat object of counts, flags and short strings. */
function summarise(value: unknown): JobResult | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const kept: JobResult = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' || typeof item === 'boolean') kept[key] = item;
    else if (typeof item === 'string') kept[key] = maskString(item).slice(0, 200);
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

export class JobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobError';
  }
}

/** What a module sees as `ctx.jobs`. */
export interface JobsApi {
  /**
   * Queues a run of a job declared by this module or one of its dependencies. `data` is
   * validated against the job's `data` schema (jobs without one take no data). Returns the job id.
   */
  enqueue(name: string, data?: unknown): Promise<string>;
}

export interface JobRunReport {
  job: string;
  module: string;
  status: 'succeeded' | 'failed';
  durationSeconds: number;
}

export interface JobsOptions {
  db: Db;
  connectionString: string;
  log: Logger;
  /** The modules with their declared jobs, and the modules each may enqueue jobs of. */
  modules: readonly { id: string; manifest: ModuleManifest; reachable: ReadonlySet<string> }[];
  contextFor: (moduleId: string) => ModuleContext;
  /** Called after every attempt; the server uses it for metrics. */
  onRun?: (report: JobRunReport) => void;
  /** Seconds between polls for new jobs. Default 2. */
  pollingIntervalSeconds?: number;
  /** Seconds between cron passes (1 to 45). Default: pg-boss's own, which is up to 30. */
  cronIntervalSeconds?: number;
}

export interface Jobs {
  /** The `ctx.jobs` of one module. */
  apiFor(moduleId: string): JobsApi;
  /** Starts pg-boss with maintenance and scheduling, creates queues and schedules, starts the handlers. */
  startWorking(): Promise<void>;
  /** Stops accepting jobs, lets running handlers finish (up to `timeoutMs`), closes pg-boss. */
  stop(timeoutMs?: number): Promise<void>;
  /** Names of the declared jobs. */
  readonly names: readonly string[];
}

interface Declared {
  module: string;
  def: JobDef;
  dataSchema?: z.ZodType;
}

export function createJobs(options: JobsOptions): Jobs {
  const { db, log, contextFor } = options;
  const declared = new Map<string, Declared>();
  for (const module of options.modules) {
    for (const def of module.manifest.jobs ?? []) {
      declared.set(def.name, { module: module.id, def, dataSchema: def.data });
    }
  }
  const reachable = new Map(options.modules.map((module) => [module.id, module.reachable]));

  let boss: PgBoss | undefined;
  let starting: Promise<PgBoss> | undefined;
  let working = false;
  const active = new Set<AbortController>();

  function newBoss(mode: 'sender' | 'worker'): PgBoss {
    const instance = new PgBoss({
      connectionString: options.connectionString,
      application_name: `scorpion-jobs-${mode}`,
      max: mode === 'worker' ? 5 : 2,
      supervise: mode === 'worker',
      schedule: mode === 'worker',
      ...(options.cronIntervalSeconds === undefined
        ? {}
        : {
            cronWorkerIntervalSeconds: options.cronIntervalSeconds,
            cronMonitorIntervalSeconds: options.cronIntervalSeconds,
          }),
    });
    instance.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
    return instance;
  }

  async function ensureQueues(instance: PgBoss): Promise<void> {
    for (const [name, { def }] of declared) {
      const queue = {
        retryLimit: def.retry.limit,
        retryDelay: def.retry.delaySeconds,
        retryBackoff: def.retry.backoff ?? false,
        expireInSeconds: def.timeoutSeconds,
      };
      if (await instance.getQueue(name)) await instance.updateQueue(name, queue);
      else await instance.createQueue(name, queue);
    }
  }

  /** A pg-boss instance to send from: the worker's, or a send-only one in a web process. */
  function sender(): Promise<PgBoss> {
    if (boss) return Promise.resolve(boss);
    starting ??= (async () => {
      const instance = newBoss('sender');
      await instance.start();
      await ensureQueues(instance);
      boss = instance;
      return instance;
    })();
    return starting;
  }

  async function record(
    run: { id: string; def: JobDef; module: string; jobId: string; attempt: number },
    phase: 'start' | 'end',
    result?: {
      status: 'succeeded' | 'failed';
      durationMs: number;
      error?: string;
      summary?: JobResult;
    },
  ): Promise<void> {
    try {
      if (phase === 'start') {
        await db.execute(sql`
          insert into kernel_job_run (id, job_name, module, job_id, attempt, timeout_seconds)
          values (${run.id}, ${run.def.name}, ${run.module}, ${run.jobId}, ${run.attempt}, ${run.def.timeoutSeconds})`);
      } else {
        await db.execute(sql`
          update kernel_job_run
             set status = ${result!.status}, finished_at = now(), duration_ms = ${result!.durationMs}, error = ${result!.error ?? null},
                 result = ${result!.summary === undefined ? null : JSON.stringify(result!.summary)}::jsonb
           where id = ${run.id}`);
      }
    } catch (error) {
      // History must never fail the job itself.
      log.error({ err: error, job: run.def.name }, 'could not write the job run history');
    }
  }

  async function runJob(entry: Declared, job: Job<object | null>): Promise<void> {
    const { def, module } = entry;
    const attempt = job.retryCount + 1;
    const run = { id: ids.uuidv7(), def, module, jobId: job.id, attempt };
    const started = Date.now();
    const controller = new AbortController();
    active.add(controller);
    const onAbort = () => controller.abort(job.signal.reason);
    job.signal.addEventListener('abort', onAbort);
    await record(run, 'start');

    const ctx: ModuleContext = {
      ...contextFor(module),
      log: childLogger(log, { module, jobId: job.id }),
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`job ${def.name} timed out after ${def.timeoutSeconds} s`);
          controller.abort(error);
          reject(error);
        }, def.timeoutSeconds * 1000);
      });
      const summary = await Promise.race([
        Promise.resolve().then(() =>
          def.handler(
            {
              id: job.id,
              name: def.name,
              data: job.data ?? undefined,
              attempt,
              signal: controller.signal,
            },
            ctx,
          ),
        ),
        timeout,
      ]);
      const durationMs = Date.now() - started;
      await record(run, 'end', {
        status: 'succeeded',
        durationMs,
        summary: summarise(summary),
      });
      options.onRun?.({
        job: def.name,
        module,
        status: 'succeeded',
        durationSeconds: durationMs / 1000,
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = maskString(error instanceof Error ? error.message : String(error));
      log.warn({ job: def.name, jobId: job.id, attempt, err: error }, 'job attempt failed');
      await record(run, 'end', { status: 'failed', durationMs, error: message });
      options.onRun?.({
        job: def.name,
        module,
        status: 'failed',
        durationSeconds: durationMs / 1000,
      });
      throw error; // pg-boss retries according to the queue's retry settings
    } finally {
      clearTimeout(timer);
      job.signal.removeEventListener('abort', onAbort);
      active.delete(controller);
    }
  }

  async function startWorking(): Promise<void> {
    if (working) return;
    working = true;
    if (boss) {
      // A send-only instance was started before; replace it with the full one.
      await boss.stop({ graceful: true, timeout: 5_000 });
      boss = undefined;
      starting = undefined;
    }
    const instance = newBoss('worker');
    await instance.start();
    boss = instance;
    await ensureQueues(instance);

    // Rows left `running` by a process that died mid-handler.
    await db.execute(sql`
      update kernel_job_run set status = 'failed', finished_at = now(), error = 'interrupted: the process ended before the job finished'
       where status = 'running' and started_at + timeout_seconds * interval '1 second' < now()`);

    const scheduled = new Set<string>();
    for (const [name, { def }] of declared) {
      if (!def.schedule) continue;
      try {
        await instance.schedule(name, def.schedule, null, { tz: 'UTC' });
      } catch (error) {
        throw new KernelStartupError(`Cannot schedule job "${name}":`, [
          `${error instanceof Error ? error.message : String(error)} (schedule "${def.schedule}")`,
        ]);
      }
      scheduled.add(name);
    }
    for (const schedule of await instance.getSchedules()) {
      if (!scheduled.has(schedule.name)) await instance.unschedule(schedule.name, schedule.key);
    }

    for (const [name, entry] of declared) {
      await instance.work<object | null>(
        name,
        { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
        async (jobs) => {
          for (const job of jobs) await runJob(entry, job);
        },
      );
    }
  }

  return {
    names: [...declared.keys()],
    apiFor(moduleId) {
      return {
        async enqueue(name, data) {
          const entry = declared.get(name);
          if (!entry) throw new JobError(`${moduleId}: unknown job "${name}"`);
          if (!reachable.get(moduleId)?.has(entry.module)) {
            throw new JobError(
              `${moduleId}: job "${name}" belongs to ${entry.module}, which is not a dependency`,
            );
          }
          let payload: object | null = null;
          if (entry.dataSchema) {
            const parsed = entry.dataSchema.safeParse(data);
            if (!parsed.success) {
              const problems = parsed.error.issues.map(
                (issue) => `${issue.path.join('.') || 'data'}: ${issue.message}`,
              );
              throw new JobError(
                `${moduleId}: data for job "${name}" is invalid (${problems.join('; ')})`,
              );
            }
            if (parsed.data === null || typeof parsed.data !== 'object') {
              throw new JobError(
                `${moduleId}: the data schema of job "${name}" must produce an object`,
              );
            }
            payload = parsed.data;
          } else if (data !== undefined && data !== null) {
            throw new JobError(
              `${moduleId}: job "${name}" takes no data (it declares no data schema)`,
            );
          }
          const id = await (await sender()).send(name, payload);
          if (!id) throw new JobError(`${moduleId}: job "${name}" was not queued`);
          return id;
        },
      };
    },
    startWorking,
    async stop(timeoutMs = 30_000) {
      working = false;
      // A send-only instance that is still starting becomes `boss` when it is up. Let it finish, so it
      // is stopped below and not left with open connections that die with the database (57P01).
      const pending = starting;
      starting = undefined;
      if (pending) await pending.catch(() => undefined);
      const instance = boss;
      boss = undefined;
      if (instance) {
        // Running handlers get the whole timeout to finish; only then are they told to give up.
        const giveUp = setTimeout(() => {
          for (const controller of active)
            controller.abort(new Error('the process is shutting down'));
        }, timeoutMs);
        try {
          await instance.stop({ graceful: true, timeout: timeoutMs });
        } finally {
          clearTimeout(giveUp);
        }
      }
    },
  };
}
