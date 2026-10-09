import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeSecretsKey, startPostgres, type StartedPostgres } from '@scorpion/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// These run the real command line, as an operator does: `node apps/server/src/cli.ts <command>`.
// The committed generated profile is `full`: the kernel's own start-up, migrations, probes and
// shutdown, and the commands of its modules.
const root = join(import.meta.dirname, '../../..');
const cli = join(root, 'apps/server/src/cli.ts');

/** The profile has core.settings, which will not start without a key (ADR 0016). */
const SECRETS_KEY = makeSecretsKey();

let server: StartedPostgres;
beforeAll(async () => {
  server = await startPostgres();
}, 120_000);
afterAll(async () => {
  await server?.stop();
});

function run(args: string[], env: Record<string, string> = {}, input?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', SECRETS_KEY, ...env },
    encoding: 'utf8',
    timeout: 60_000,
    input,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Starts a long-running command and collects its output. */
function launch(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', SECRETS_KEY, ...env },
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
    // A fresh install also shows the first-run token as a plain-text block on the console (the one
    // thing that is not a log line); everything else is JSON.
    const all = proc.output().trim().split('\n');
    expect(
      all.filter((line) => !line.startsWith('{')).every((line) => /^(\s|=|$)/.test(line)),
    ).toBe(true);
    const lines = all
      .filter((line) => line.startsWith('{'))
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
      PROFILE: 'core-only',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/built for profile "full" but PROFILE is "core-only"/);
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
    // Two processes that each load every module: well over the default 5 s on a loaded CI runner.
  }, 60_000);

  it('profile:generate --check passes on the committed profile', () => {
    const result = run(['profile:generate', 'full', '--check'], {});
    expect(result.code).toBe(0);
  }, 60_000);
});

describe('scorpion create-admin', () => {
  const password = 'a long password for the admin';
  const args = ['create-admin', '--username', 'root', '--email', 'root@example.org'];
  const users = async (url: string) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (
        await client.query<{ username: string; status: string; admin: boolean; hash: string }>(
          `select u.username, u.status, a.password_hash as hash,
                  exists (select 1 from authz_role_assignment ra join authz_role r on r.id = ra.role_id
                           where ra.user_id = u.id and r.key = 'admin' and ra.assigned_by is null) as admin
             from identity_user u join identity_auth_method a on a.user_id = u.id order by u.username`,
        )
      ).rows;
    } finally {
      await client.end();
    }
  };

  /**
   * A migrated database whose `core.identity` settings turn the breach check off: the command runs as
   * a real process (not under NODE_ENV=test, so no stub), and a test must not call a third party.
   */
  const offlineDatabase = async () => {
    const url = await server.createDatabase();
    expect(run(['migrate'], { DATABASE_URL: url }).code).toBe(0);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(
        `insert into settings_setting (module_id, value, version) values ('core.identity', $1, 1)`,
        [JSON.stringify({ passwordBreachCheck: false })],
      );
    } finally {
      await client.end();
    }
    return url;
  };

  it('is listed in the usage text, with no database', () => {
    const result = run([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('create-admin --username <name> --email <address>');
  });

  it('creates an active administrator with a password read from stdin, and prints no secret', async () => {
    const url = await offlineDatabase();
    const result = run(args, { DATABASE_URL: url }, `${password}\n`);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Created the administrator "root"');
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout + result.stderr).not.toContain('$argon2');
    const rows = await users(url);
    expect(rows).toEqual([
      {
        username: 'root',
        status: 'active',
        admin: true, // the Admin role, given by the system
        hash: expect.stringMatching(/^\$argon2id\$/) as unknown,
      },
    ]);
  }, 90_000);

  it('refuses a password on the command line, and creates nothing', async () => {
    const url = await server.createDatabase();
    expect(run(['migrate'], { DATABASE_URL: url }).code).toBe(0);
    for (const extra of [
      ['--password', 'hunter2hunter2'],
      ['--password=hunter2hunter2'],
      ['--pass', 'x'],
    ]) {
      const result = run([...args, ...extra], { DATABASE_URL: url }, `${password}\n`);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('never taken from the command line');
      expect(result.stdout + result.stderr).not.toContain('hunter2hunter2');
    }
    expect(await users(url)).toEqual([]);
  }, 90_000);

  it.each([
    ['no username', ['create-admin', '--email', 'root@example.org']],
    ['no email', ['create-admin', '--username', 'root']],
    ['an unknown option', [...args, '--role', 'admin']],
  ])(
    'exits with 2 and the usage for %s',
    async (_name, argv) => {
      const url = await server.createDatabase();
      const result = run(argv, { DATABASE_URL: url }, `${password}\n`);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('Usage: scorpion create-admin');
    },
    90_000,
  );

  it('exits with 1 and names the field, never the value, for a weak password', async () => {
    const url = await server.createDatabase();
    const result = run(args, { DATABASE_URL: url }, 'short\n');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('password');
    expect(result.stderr).not.toContain('short\n');
    expect(await users(url)).toEqual([]);
  }, 90_000);

  it('exits with 1 for a name that is taken, and does not touch the first account', async () => {
    const url = await offlineDatabase();
    expect(run(args, { DATABASE_URL: url }, `${password}\n`).code).toBe(0);
    const again = run(args, { DATABASE_URL: url }, `another long password\n`);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('taken');
    expect(again.stdout + again.stderr).not.toContain('another long password');
    expect(await users(url)).toHaveLength(1);
  }, 90_000);
});

describe('the first-run token of a fresh install', () => {
  const TOKEN = /sfr_[A-Za-z0-9_-]{43}/g;
  const admin = {
    username: 'root',
    email: 'root@example.org',
    password: 'a long password for the admin',
  };

  it('is shown once on the console, redeemed over HTTP, never logged, and not shown again', async () => {
    const url = await server.createDatabase();
    const port = freePort();
    const base = `http://127.0.0.1:${port}`;
    const env = { DATABASE_URL: url, PORT: String(port), LOG_LEVEL: 'trace' };

    const first = launch(['start'], env);
    await waitFor(async () => (await fetch(`${base}/readyz`)).status === 200, '/readyz');
    const token = first.output().match(TOKEN)?.[0];
    expect(token).toBeDefined();
    expect(first.output().match(TOKEN)).toHaveLength(1);

    const redeemed = await fetch(`${base}/api/internal/bootstrap/first-admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...admin }),
    });
    expect(redeemed.status).toBe(201);
    const again = await fetch(`${base}/api/internal/bootstrap/first-admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...admin, username: 'second', email: 'b@example.org' }),
    });
    expect(again.status).toBe(401);

    first.child.kill('SIGTERM');
    expect(await first.exited).toBe(0);
    // Every line the structured logger wrote (JSON) is free of the secret, requests included.
    const jsonLines = first
      .output()
      .split('\n')
      .filter((line) => line.startsWith('{'));
    expect(jsonLines.length).toBeGreaterThan(0);
    for (const line of jsonLines) {
      expect(line).not.toContain(token!.slice(4));
      expect(line).not.toContain(admin.password);
    }

    // A restart finds an administrator and shows nothing.
    const second = launch(['start'], { ...env, PORT: String(freePort()) });
    await waitFor(() => Promise.resolve(/ready/.test(second.output())), 'the second start');
    second.child.kill('SIGTERM');
    expect(await second.exited).toBe(0);
    expect(second.output()).not.toMatch(TOKEN);
    expect(second.output()).not.toContain('no administrator yet');
  }, 120_000);
});

describe('SECRETS_KEY', () => {
  const HOW = /openssl rand -base64 32/;

  it('is needed by start, which exits 1 with how to make one and prints no value', async () => {
    const url = await server.createDatabase();
    for (const key of ['', 'short-and-invalid-key-text']) {
      const proc = launch(['start'], {
        DATABASE_URL: url,
        PORT: String(freePort()),
        SECRETS_KEY: key,
      });
      expect(await proc.exited).toBe(1);
      expect(proc.output()).toMatch(/Cannot start core\.settings:/);
      expect(proc.output()).toMatch(HOW);
      expect(proc.output()).not.toContain('short-and-invalid-key-text');
    }
  }, 90_000);

  it('is needed by worker as well', async () => {
    const url = await server.createDatabase();
    const proc = launch(['worker'], { DATABASE_URL: url, SECRETS_KEY: '' });
    expect(await proc.exited).toBe(1);
    expect(proc.output()).toMatch(HOW);
  }, 60_000);

  it('is not needed by migrate', async () => {
    const url = await server.createDatabase();
    expect(run(['migrate'], { DATABASE_URL: url, SECRETS_KEY: '' }).code).toBe(0);
  }, 60_000);

  it('never appears in the log of a running server', async () => {
    const url = await server.createDatabase();
    const port = freePort();
    const proc = launch(['start'], { DATABASE_URL: url, PORT: String(port), LOG_LEVEL: 'trace' });
    await waitFor(
      async () => (await fetch(`http://127.0.0.1:${port}/readyz`)).status === 200,
      '/readyz',
    );
    proc.child.kill('SIGTERM');
    expect(await proc.exited).toBe(0);
    expect(proc.output().length).toBeGreaterThan(0);
    expect(proc.output()).not.toContain(SECRETS_KEY);
  }, 90_000);
});

describe('scorpion set-secret and rotate-secrets', () => {
  const secret = 'an-oidc-client-secret-8f2a41';
  const stored = async (url: string) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (
        await client.query<{ name: string; key_id: string; ciphertext: Buffer }>(
          'select name, key_id, ciphertext from settings_secret order by name',
        )
      ).rows;
    } finally {
      await client.end();
    }
  };

  it('are listed in the usage text, with no database', () => {
    const result = run([]);
    expect(result.stderr).toContain('set-secret <name>');
    expect(result.stderr).toContain('rotate-secrets [--batch-size <n>]');
  });

  it('stores a secret read from stdin, prints only its name, and keeps it out of the table in clear', async () => {
    const url = await server.createDatabase();
    const result = run(
      ['set-secret', 'oidc.keycloak.client-secret'],
      { DATABASE_URL: url },
      `${secret}\n`,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Stored the secret "oidc.keycloak.client-secret"');
    expect(result.stdout + result.stderr).not.toContain(secret);
    const rows = await stored(url);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ciphertext.includes(Buffer.from(secret))).toBe(false);
  }, 90_000);

  it('refuses a value on the command line and a bad name, and stores nothing', async () => {
    const url = await server.createDatabase();
    const onCommandLine = run(['set-secret', 'a.b', secret], { DATABASE_URL: url }, `${secret}\n`);
    expect(onCommandLine.code).toBe(2);
    expect(onCommandLine.stderr).toContain('never taken from the command line');
    expect(onCommandLine.stdout + onCommandLine.stderr).not.toContain(secret);
    expect(run(['set-secret', 'Bad Name'], { DATABASE_URL: url }, `${secret}\n`).code).toBe(2);
    expect(await stored(url)).toEqual([]);
  }, 90_000);

  it('rotates to a new key: the rows move, the old key is no longer needed afterwards', async () => {
    const url = await server.createDatabase();
    const next = makeSecretsKey();
    expect(run(['set-secret', 'a.one'], { DATABASE_URL: url }, 'first-value\n').code).toBe(0);
    expect(run(['set-secret', 'b.two'], { DATABASE_URL: url }, 'second-value\n').code).toBe(0);
    const before = await stored(url);

    const withoutNext = run(['rotate-secrets'], { DATABASE_URL: url });
    expect(withoutNext.code).toBe(1);
    expect(withoutNext.stderr).toMatch(/SECRETS_KEY_NEXT/);

    const rotated = run(['rotate-secrets', '--batch-size', '1'], {
      DATABASE_URL: url,
      SECRETS_KEY_NEXT: next,
    });
    expect(rotated.code).toBe(0);
    expect(rotated.stdout).toContain('Re-encrypted 2 secret(s); 0 remain on another key.');
    expect(rotated.stdout + rotated.stderr).not.toMatch(/first-value|second-value/);
    expect(rotated.stdout + rotated.stderr).not.toContain(next);
    const after = await stored(url);
    expect(after.map((row) => row.key_id)).not.toEqual(before.map((row) => row.key_id));
    expect(new Set(after.map((row) => row.key_id)).size).toBe(1);

    // The operator then swaps the keys: the new key alone reads everything.
    const again = run(['rotate-secrets'], { DATABASE_URL: url, SECRETS_KEY: next });
    expect(again.code).toBe(1); // no SECRETS_KEY_NEXT: it says what to set
    const reads = run(
      ['set-secret', 'c.three'],
      { DATABASE_URL: url, SECRETS_KEY: next },
      'third\n',
    );
    expect(reads.code).toBe(0);
    // The old key does not read the rotated rows any more: rotation really re-encrypted them.
    const withOld = run(['rotate-secrets'], {
      DATABASE_URL: url,
      SECRETS_KEY_NEXT: makeSecretsKey(),
    });
    expect(withOld.code).toBe(1);
    expect(withOld.stderr).toMatch(/Rotation stopped/);
  }, 120_000);
});
