import { sql } from 'drizzle-orm';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useKernels } from '../test/helpers.ts';
import { KernelStartupError } from './errors.ts';
import { JobError } from './jobs.ts';
import type { Kernel } from './kernel.ts';
import { defineModule, type JobDef } from './manifest.ts';
import { listJobRuns } from './queries.ts';

const kernels = useKernels();
const quick = { jobs: { pollingIntervalSeconds: 0.5, cronIntervalSeconds: 1 } };

interface A {
  notes(): Promise<{ id: string; thingId: string; body: string }[]>;
  ping(message: string): Promise<string>;
}
const a = (kernel: Kernel) => kernel.services.get('fixture.a') as A;

/** One inline module `worker` with the given jobs. */
function jobModule(jobs: Partial<JobDef>[], id = 'worker') {
  return defineModule<{ enqueue(name: string, data?: unknown): Promise<string> }>({
    id,
    version: '1.0.0',
    jobs: jobs.map((job) => ({
      retry: { limit: 0, delaySeconds: 0 },
      timeoutSeconds: 30,
      handler: () => Promise.resolve(),
      ...job,
      name: `${id}.${job.name}`,
    })),
    services: (ctx) => ({ enqueue: (name, data) => ctx.jobs.enqueue(`${id}.${name}`, data) }),
  });
}
const enqueue =
  (kernel: Kernel, id = 'worker') =>
  (name: string, data?: unknown): Promise<string> =>
    (kernel.services.get(id) as { enqueue(name: string, data?: unknown): Promise<string> }).enqueue(
      name,
      data,
    );

describe('scheduled jobs', () => {
  it('runs on its cron schedule and leaves a history entry', async () => {
    const kernel = await kernels.fixture('ab', quick);
    await kernel.start();
    await kernel.startWorkers();

    await vi.waitFor(
      async () => {
        const runs = await listJobRuns(kernel.db, { jobName: 'fixture.a.tick' });
        expect(runs.map((run) => `${run.status} ${run.error ?? ''}`)).toContain('succeeded ');
      },
      { timeout: 20_000, interval: 250 },
    );

    const [run] = await listJobRuns(kernel.db, { jobName: 'fixture.a.tick', status: 'succeeded' });
    expect(run).toMatchObject({
      module: 'fixture.a',
      attempt: 1,
      status: 'succeeded',
      error: null,
    });
    expect(run!.startedAt).toBeInstanceOf(Date);
    expect(run!.finishedAt!.getTime()).toBeGreaterThanOrEqual(run!.startedAt.getTime());
    expect(run!.durationMs).toBeGreaterThanOrEqual(0);
    expect((await a(kernel).notes()).some((note) => note.body === 'tick')).toBe(true);
  }, 30_000);

  it('rejects a schedule that is not a cron expression, naming the job', async () => {
    const kernel = await kernels.inline([
      jobModule([{ name: 'bad', schedule: 'every now and then' }]),
    ]);
    await kernel.start();
    const error = await kernel.startWorkers().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KernelStartupError);
    expect((error as Error).message).toContain('Cannot schedule job "worker.bad"');
  });

  it('drops the schedule of a job that no longer has one', async () => {
    const url = await kernels.newDatabase();
    const first = await kernels.inline(
      [jobModule([{ name: 'cron', schedule: '0 3 * * *' }])],
      {},
      { databaseUrl: url },
    );
    await first.start();
    await first.startWorkers();
    const before = await first.db.execute<{ name: string }>(sql`select name from pgboss.schedule`);
    expect(before.rows.map((row) => row.name)).toEqual(['worker.cron']);
    await first.stop();

    const second = await kernels.inline([jobModule([{ name: 'cron' }])], {}, { databaseUrl: url });
    await second.start();
    await second.startWorkers();
    const after = await second.db.execute<{ name: string }>(sql`select name from pgboss.schedule`);
    expect(after.rows).toEqual([]);
  });
});

describe('ctx.jobs.enqueue', () => {
  it('runs a job with validated data and records the run', async () => {
    const kernel = await kernels.fixture('ab', quick);
    await kernel.start();
    await kernel.startWorkers();

    const jobId = await a(kernel).ping('hello from a test');

    await vi.waitFor(
      async () =>
        expect((await a(kernel).notes()).map((n) => n.body)).toContain('hello from a test'),
      {
        timeout: 15_000,
        interval: 250,
      },
    );
    await vi.waitFor(async () => {
      const [run] = await listJobRuns(kernel.db, { jobName: 'fixture.a.ping' });
      expect(run).toMatchObject({ jobId, status: 'succeeded', attempt: 1 });
    });
  }, 30_000);

  const invalid: [string, string, unknown, RegExp][] = [
    [
      'data that does not match the schema',
      'ping',
      { message: '' },
      /data for job "worker\.ping" is invalid \(message: /,
    ],
    ['data with an unknown field', 'ping', { message: 'x', extra: 1 }, /is invalid/],
    ['no data where the schema needs some', 'ping', undefined, /is invalid/],
    ['data for a job that takes none', 'plain', { anything: 1 }, /takes no data/],
    ['an unknown job', 'nothing', undefined, /unknown job "worker\.nothing"/],
  ];

  it.each(invalid)('rejects %s', async (_name, job, data, expected) => {
    const kernel = await kernels.inline([
      jobModule([
        { name: 'ping', data: z.strictObject({ message: z.string().min(1) }) },
        { name: 'plain' },
      ]),
    ]);
    await kernel.start();
    const error = await enqueue(kernel)(job, data).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobError);
    expect((error as Error).message).toMatch(expected);
    // Nothing was queued.
    const queued = await kernel.db
      .execute<{ n: string }>(sql`select count(*) as n from pgboss.job`)
      .catch(() => ({ rows: [{ n: '0' }] }));
    expect(Number(queued.rows[0]!.n)).toBe(0);
  });

  it('only accepts jobs of the module itself and of its dependencies', async () => {
    let enqueueOther: (name: string) => Promise<string> = () => Promise.resolve('');
    const kernel = await kernels.inline([
      jobModule([{ name: 'secret' }], 'owner'),
      defineModule({
        id: 'nosy',
        version: '1.0.0',
        services: (ctx) => {
          enqueueOther = (name) => ctx.jobs.enqueue(name);
          return {};
        },
      }),
    ]);
    await kernel.start();
    await expect(enqueueOther('owner.secret')).rejects.toThrowError(
      /belongs to owner, which is not a dependency/,
    );
  });

  it('works from a web process that runs no workers; a separate worker process runs the job', async () => {
    const seen: string[] = [];
    const handler: JobDef['handler'] = (job) => {
      seen.push(job.name);
      return Promise.resolve();
    };
    const url = await kernels.newDatabase();
    const web = await kernels.inline(
      [jobModule([{ name: 'job', handler }])],
      {},
      { databaseUrl: url, ...quick },
    );
    await web.start(); // no startWorkers(): WORKER_MODE=separate
    await enqueue(web)('job');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(seen).toEqual([]);

    const worker = await kernels.inline(
      [jobModule([{ name: 'job', handler }])],
      {},
      { databaseUrl: url, ...quick },
    );
    await worker.start();
    await worker.startWorkers();

    await vi.waitFor(() => expect(seen).toEqual(['worker.job']), {
      timeout: 15_000,
      interval: 250,
    });
  }, 30_000);
});

describe('failures and retries', () => {
  it('retries a failing job and records every attempt', async () => {
    let calls = 0;
    const kernel = await kernels.inline(
      [
        jobModule([
          {
            name: 'flaky',
            retry: { limit: 2, delaySeconds: 0 },
            handler: () => {
              calls += 1;
              if (calls < 3) throw new Error(`attempt ${calls} failed`);
              return Promise.resolve();
            },
          },
        ]),
      ],
      {},
      quick,
    );
    await kernel.start();
    await kernel.startWorkers();
    await enqueue(kernel)('flaky');

    // The last attempt is inserted as `running`; wait until it has finished, not just appeared.
    await vi.waitFor(
      async () =>
        expect(
          (await listJobRuns(kernel.db, { jobName: 'worker.flaky', status: 'succeeded' })).length,
        ).toBe(1),
      {
        timeout: 20_000,
        interval: 250,
      },
    );

    const runs = (await listJobRuns(kernel.db, { jobName: 'worker.flaky' })).reverse();
    expect(runs.map((run) => [run.attempt, run.status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
      [3, 'succeeded'],
    ]);
    expect(runs[0]!.error).toBe('attempt 1 failed');
    expect(new Set(runs.map((run) => run.jobId)).size).toBe(1);
  }, 30_000);

  it('stops retrying after the limit, and the error is masked in the history', async () => {
    const kernel = await kernels.inline(
      [
        jobModule([
          {
            name: 'broken',
            retry: { limit: 1, delaySeconds: 0 },
            handler: () => {
              throw new Error('cannot connect to postgres://svc:pw-secret@db/x');
            },
          },
        ]),
      ],
      {},
      quick,
    );
    await kernel.start();
    await kernel.startWorkers();
    await enqueue(kernel)('broken');

    await vi.waitFor(
      async () => expect(await listJobRuns(kernel.db, { status: 'failed' })).toHaveLength(2),
      {
        timeout: 20_000,
        interval: 250,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const runs = await listJobRuns(kernel.db);
    expect(runs).toHaveLength(2);
    expect(
      runs.every(
        (run) => run.error?.includes('cannot connect') && !run.error.includes('pw-secret'),
      ),
    ).toBe(true);
  }, 30_000);

  it('fails a job that runs past its timeout and aborts its signal', async () => {
    let aborted = false;
    const kernel = await kernels.inline(
      [
        jobModule([
          {
            name: 'slow',
            timeoutSeconds: 1,
            handler: (job) =>
              new Promise(() => {
                job.signal.addEventListener('abort', () => {
                  aborted = true;
                });
              }),
          },
        ]),
      ],
      {},
      quick,
    );
    await kernel.start();
    await kernel.startWorkers();
    await enqueue(kernel)('slow');

    await vi.waitFor(
      async () => expect(await listJobRuns(kernel.db, { status: 'failed' })).toHaveLength(1),
      {
        timeout: 15_000,
        interval: 250,
      },
    );
    expect((await listJobRuns(kernel.db))[0]!.error).toMatch(/timed out after 1 s/);
    expect(aborted).toBe(true);
  }, 30_000);

  it('reports each attempt to the observer', async () => {
    const reports: unknown[] = [];
    const url = await kernels.newDatabase();
    const kernel = await kernels.inline(
      [jobModule([{ name: 'ok' }])],
      {},
      { databaseUrl: url, ...quick },
    );
    // The observer is an option of createKernel, which the helper does not expose: build one here.
    const { createKernel } = await import('./kernel.ts');
    const { loadConfig } = await import('./config.ts');
    const { createLogger } = await import('./logger.ts');
    const observed = createKernel({
      profile: { name: 'inline', modules: ['worker'] },
      sources: [
        {
          manifest: jobModule([{ name: 'ok' }]),
          packageJson: { name: '@scorpion/worker' },
        },
      ],
      modulePackages: { worker: '@scorpion/worker' },
      config: loadConfig({ DATABASE_URL: url }),
      log: createLogger({ level: 'silent' }),
      onJobRun: (report) => reports.push(report),
      ...quick,
    });
    await kernel.stop();
    try {
      await observed.start();
      await observed.startWorkers();
      await enqueue(observed)('ok');
      await vi.waitFor(() => expect(reports).toHaveLength(1), { timeout: 15_000, interval: 250 });
      expect(reports[0]).toMatchObject({ job: 'worker.ok', module: 'worker', status: 'succeeded' });
    } finally {
      await observed.stop();
    }
  }, 30_000);

  it('marks a run left `running` by a dead process as failed when workers start', async () => {
    const url = await kernels.newDatabase();
    const kernel = await kernels.inline(
      [jobModule([{ name: 'ok' }])],
      {},
      { databaseUrl: url, ...quick },
    );
    await kernel.start();
    await kernel.db.execute(sql`
      insert into kernel_job_run (id, job_name, module, job_id, attempt, timeout_seconds, started_at)
      values ('0190a000-0000-7000-8000-000000000001', 'worker.ok', 'worker', 'gone', 1, 10, now() - interval '1 hour'),
             ('0190a000-0000-7000-8000-000000000002', 'worker.ok', 'worker', 'live', 1, 3600, now())`);

    await kernel.startWorkers();

    const runs = await listJobRuns(kernel.db);
    expect(runs.find((run) => run.jobId === 'gone')).toMatchObject({ status: 'failed' });
    expect(runs.find((run) => run.jobId === 'gone')!.error).toMatch(/interrupted/);
    expect(runs.find((run) => run.jobId === 'live')).toMatchObject({ status: 'running' });
  });
});

describe('graceful shutdown', () => {
  it('lets a running job finish, then closes the pools', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const url = await kernels.newDatabase();
    const kernel = await kernels.inline(
      [
        jobModule([
          {
            name: 'long',
            handler: async () => {
              started();
              await new Promise((resolve) => setTimeout(resolve, 1500));
            },
          },
        ]),
      ],
      {},
      { databaseUrl: url, ...quick },
    );
    await kernel.start();
    await kernel.startWorkers();
    await enqueue(kernel)('long');
    await running;

    const begun = Date.now();
    await kernel.stop(10_000);
    expect(Date.now() - begun).toBeGreaterThanOrEqual(1000); // it waited for the handler

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const { rows } = await client.query<{ status: string }>(
      `select status from kernel_job_run where job_name = 'worker.long'`,
    );
    await client.end();
    expect(rows).toEqual([{ status: 'succeeded' }]);
  }, 30_000);

  it('tells a handler that outlasts the timeout to give up', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    let aborted = false;
    const kernel = await kernels.inline(
      [
        jobModule([
          {
            name: 'stuck',
            handler: (job) =>
              new Promise((_resolve, reject) => {
                started();
                job.signal.addEventListener('abort', () => {
                  aborted = true;
                  reject(new Error('gave up'));
                });
              }),
          },
        ]),
      ],
      {},
      quick,
    );
    await kernel.start();
    await kernel.startWorkers();
    await enqueue(kernel)('stuck');
    await running;

    await kernel.stop(1_000);

    expect(aborted).toBe(true);
  }, 30_000);

  it('is safe to call twice', async () => {
    const kernel = await kernels.inline([jobModule([{ name: 'ok' }])], {}, quick);
    await kernel.start();
    await kernel.startWorkers();
    await kernel.stop();
    await expect(kernel.stop()).resolves.toBeUndefined();
  });
});

describe('listJobRuns', () => {
  it('filters by job and status, newest first, with a limit', async () => {
    const kernel = await kernels.inline([jobModule([{ name: 'one' }, { name: 'two' }])]);
    await kernel.start();
    await kernel.db.execute(sql`
      insert into kernel_job_run (id, job_name, module, job_id, attempt, status, timeout_seconds, started_at)
      values ('0190a000-0000-7000-8000-000000000001', 'worker.one', 'worker', 'j1', 1, 'succeeded', 30, now() - interval '3 minutes'),
             ('0190a000-0000-7000-8000-000000000002', 'worker.one', 'worker', 'j2', 1, 'failed', 30, now() - interval '2 minutes'),
             ('0190a000-0000-7000-8000-000000000003', 'worker.two', 'worker', 'j3', 1, 'succeeded', 30, now() - interval '1 minute')`);

    expect((await listJobRuns(kernel.db)).map((r) => r.jobId)).toEqual(['j3', 'j2', 'j1']);
    expect((await listJobRuns(kernel.db, { jobName: 'worker.one' })).map((r) => r.jobId)).toEqual([
      'j2',
      'j1',
    ]);
    expect((await listJobRuns(kernel.db, { status: 'failed' })).map((r) => r.jobId)).toEqual([
      'j2',
    ]);
    expect((await listJobRuns(kernel.db, { limit: 1, offset: 1 })).map((r) => r.jobId)).toEqual([
      'j2',
    ]);
    expect(
      await listJobRuns(kernel.db, { jobName: 'worker.one', status: 'succeeded', limit: 5 }),
    ).toHaveLength(1);
  });
});
