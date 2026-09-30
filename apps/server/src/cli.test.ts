import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// These run the real command line, as an operator does: `node apps/server/src/cli.ts <command>`.
// The committed generated profile is `full`, which has no modules yet, so what is under test is the
// kernel's own start-up, migrations, probes and shutdown.
const root = join(import.meta.dirname, '../../..');
const cli = join(root, 'apps/server/src/cli.ts');

let server: StartedPostgres;
beforeAll(async () => {
  server = await startPostgres();
}, 120_000);
afterAll(async () => {
  await server?.stop();
});

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Starts a long-running command and collects its output. */
function launch(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, output: () => output, exited };
}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const freePort = () => 20_000 + Math.floor(Math.random() * 20_000);

describe('scorpion migrate', () => {
  it('applies the migrations, says so, and does nothing the second time', async () => {
    const url = await server.createDatabase();
    const first = run(['migrate'], { DATABASE_URL: url });
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(/kernel: \d+ migration\(s\) applied/);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    await client.end();
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'kernel_outbox',
        'kernel_outbox_delivery',
        'kernel_job_run',
        'kernel_migrations_kernel',
      ]),
    );

    const second = run(['migrate'], { DATABASE_URL: url });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('Nothing to migrate');
  }, 90_000);

  it('two migrate commands at once both succeed', async () => {
    const url = await server.createDatabase();
    const results = await Promise.all(
      [1, 2].map(
        () =>
          new Promise<number | null>((resolve) => {
            const child = spawn(process.execPath, [cli, 'migrate'], {
              cwd: root,
              env: { PATH: process.env.PATH ?? '', DATABASE_URL: url },
            });
            child.on('exit', resolve);
          }),
      ),
    );
    expect(results).toEqual([0, 0]);
  }, 90_000);
});

describe('scorpion start', () => {
  it('migrates, becomes ready, serves the probes, and shuts down on SIGTERM with exit code 0', async () => {
    const url = await server.createDatabase();
    const port = freePort();
    const proc = launch(['start'], { DATABASE_URL: url, PORT: String(port), LOG_LEVEL: 'info' });
    const base = `http://127.0.0.1:${port}`;

    await waitFor(async () => (await fetch(`${base}/healthz`)).status === 200, '/healthz');
    await waitFor(async () => (await fetch(`${base}/readyz`)).status === 200, '/readyz');
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({
      status: 'ok',
      profile: 'full',
    });
    expect((await fetch(`${base}/metrics`)).status).toBe(200);
    expect((await fetch(`${base}/api/internal/anything`)).status).toBe(404);

    proc.child.kill('SIGTERM');
    expect(await proc.exited).toBe(0);
    expect(proc.output()).toContain('signal received');
    expect(proc.output()).toContain('shutdown complete');
    expect(proc.output()).not.toContain('scorpion:'); // no password from the URL
    await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  }, 90_000);

  it('logs in JSON, one line per request, with the request id', async () => {
    const url = await server.createDatabase();
    const port = freePort();
    const proc = launch(['start'], { DATABASE_URL: url, PORT: String(port) });
    const base = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(`${base}/readyz`)).status === 200, '/readyz');
    await fetch(`${base}/healthz`, { headers: { 'x-request-id': 'cli-test-request-1' } });
    proc.child.kill('SIGTERM');
    await proc.exited;
    const lines = proc
      .output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((l) => l.requestId === 'cli-test-request-1')).toMatchObject({
      method: 'GET',
      path: '/healthz',
      status: 200,
    });
  }, 90_000);

  it('serves under a multi-segment BASE_PATH', async () => {
    const url = await server.createDatabase();
    const port = freePort();
    const proc = launch(['start'], {
      DATABASE_URL: url,
      PORT: String(port),
      BASE_PATH: '/a/b',
      LOG_LEVEL: 'silent',
    });
    const base = `http://127.0.0.1:${port}/a/b`;
    await waitFor(async () => (await fetch(`${base}/readyz`)).status === 200, '/readyz under /a/b');
    expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(404);
    proc.child.kill('SIGTERM');
    expect(await proc.exited).toBe(0);
  }, 90_000);

  it('exits 1 and says why when the database cannot be reached, without printing the password', async () => {
    const port = freePort();
    const proc = launch(['start'], {
      DATABASE_URL: 'postgres://scorpion:pw-secret-123@127.0.0.1:1/none',
      PORT: String(port),
    });
    expect(await proc.exited).toBe(1);
    expect(proc.output()).toContain('start-up failed');
    expect(proc.output()).not.toContain('pw-secret-123');
  }, 60_000);

  it('exits 1 with the complete list of configuration problems and no values', () => {
    const result = run(['start'], {
      DATABASE_URL: 'mysql://scorpion:pw-secret-123@db/x',
      WORKER_MODE: 'both',
      PORT: 'http',
      BASE_PATH: 'no-slash',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid configuration:');
    for (const variable of ['DATABASE_URL', 'WORKER_MODE', 'PORT', 'BASE_PATH']) {
      expect(result.stderr).toContain(`- ${variable}:`);
    }
    expect(result.stderr).not.toContain('pw-secret-123');
  });

  it('refuses a PROFILE that this build does not contain, and says how to fix it', () => {
    const result = run(['start'], {
      DATABASE_URL: 'postgres://x:y@127.0.0.1:1/z',
      PROFILE: 'kpi-tracker',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/built for profile "full" but PROFILE is "kpi-tracker"/);
  });

  it('needs DATABASE_URL', () => {
    const result = run(['start'], {});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
  });
});

describe('scorpion worker', () => {
  it('runs migrations, starts the workers without listening, and stops on SIGTERM', async () => {
    const url = await server.createDatabase();
    const proc = launch(['worker'], {
      DATABASE_URL: url,
      LOG_LEVEL: 'info',
      PORT: String(freePort()),
    });
    await waitFor(
      () => Promise.resolve(proc.output().includes('worker ready')),
      'the worker to be ready',
    );
    proc.child.kill('SIGTERM');
    expect(await proc.exited).toBe(0);
    expect(proc.output()).toContain('worker shutdown complete');
  }, 90_000);
});

describe('the command line itself', () => {
  it('prints the usage and exits 2 for an unknown command or none', () => {
    const unknown = run(['frobnicate'], {});
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown command "frobnicate"');
    expect(unknown.stderr).toContain('Usage: scorpion <command>');
    const none = run([], {});
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('Usage: scorpion <command>');
  });

  it('profile:generate --check passes on the committed profile', () => {
    const result = run(['profile:generate', 'full', '--check'], {});
    expect(result.code).toBe(0);
  });
});
