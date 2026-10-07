// The real thing, for the browser tests: a PostgreSQL container, the API server and the web server as
// separate processes (as an image runs them), once per base path. Nothing is faked. A test never calls
// a third party: the password breach check is switched off in the stored settings (as `cli.test.ts`
// does), and no mail relay is configured.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import pg from 'pg';

const repo = resolve(import.meta.dirname, '../../../..');
export const ADMIN = {
  username: 'root',
  email: 'root@example.org',
  password: 'a long password for the admin',
};

export interface StackSpec {
  name: string;
  basePath: string;
  webPort: number;
  apiPort: number;
}

export interface Stack extends StackSpec {
  origin: string;
  /** Everything the two processes wrote, for a failing test. */
  logs: () => string;
  stop: () => Promise<void>;
}

/** The stacks the projects of `playwright.config.ts` use. */
export const SPECS: StackSpec[] = [
  { name: 'root', basePath: '/', webPort: 4173, apiPort: 4183 },
  { name: 'nested', basePath: '/a/b', webPort: 4174, apiPort: 4184 },
];

const prefix = (basePath: string) => (basePath === '/' ? '' : basePath);

function run(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync('node', args, { cwd: repo, env, input, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`node ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

async function until(check: () => Promise<boolean>, what: string, logs: () => string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} did not come up in time.\n${logs()}`);
}

export async function startStack(spec: StackSpec, database: StartedPostgres): Promise<Stack> {
  const url = await database.createDatabase();
  const origin = `http://localhost:${spec.webPort}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: url,
    PROFILE: 'full',
    BASE_PATH: spec.basePath,
    ORIGIN: origin,
    LOG_LEVEL: 'warn',
    SECRETS_KEY: randomBytes(32).toString('base64'),
    // The web process is the API's only peer; its X-Forwarded-For tells who the caller was.
    TRUSTED_PROXIES: '127.0.0.1,::1',
  };
  delete env.NODE_ENV;

  run(['apps/server/src/cli.ts', 'migrate'], env);
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
  run(
    [
      'apps/server/src/cli.ts',
      'create-admin',
      '--username',
      ADMIN.username,
      '--email',
      ADMIN.email,
    ],
    env,
    `${ADMIN.password}\n`,
  );

  let log = '';
  // Also on disk, for a test that fails in a worker (which cannot see this process's memory).
  mkdirSync(resolve(import.meta.dirname, '../../test-results'), { recursive: true });
  const logFile = resolve(import.meta.dirname, `../../test-results/stack-${spec.name}.log`);
  writeFileSync(logFile, '');
  const children: ChildProcess[] = [];
  const start = (label: string, args: string[], extra: NodeJS.ProcessEnv) => {
    const child = spawn('node', args, { cwd: repo, env: { ...env, ...extra }, stdio: 'pipe' });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk: Buffer) => {
        const text = `[${spec.name} ${label}] ${chunk.toString()}`;
        log += text;
        appendFileSync(logFile, text);
      });
    }
    children.push(child);
  };
  start('api', ['apps/server/src/cli.ts', 'start'], { PORT: String(spec.apiPort) });
  start('web', ['apps/web/src/front/main.ts'], {
    PORT: String(spec.webPort),
    API_ORIGIN: `http://127.0.0.1:${spec.apiPort}`,
  });

  const logs = () => log;
  // Ready through the public origin: this also proves the proxy passes /readyz.
  await until(
    async () => (await fetch(`${origin}${prefix(spec.basePath)}/readyz`)).ok,
    `the ${spec.name} stack`,
    logs,
  );

  return {
    ...spec,
    origin,
    logs,
    stop: async () => {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((done) => {
              child.once('exit', () => done());
              child.kill('SIGTERM');
              setTimeout(() => child.kill('SIGKILL'), 15_000).unref();
            }),
        ),
      );
    },
  };
}

export async function startAll(): Promise<{ stacks: Stack[]; stop: () => Promise<void> }> {
  const database = await startPostgres();
  const stacks: Stack[] = [];
  try {
    for (const spec of SPECS) stacks.push(await startStack(spec, database));
  } catch (error) {
    await Promise.all(stacks.map((stack) => stack.stop()));
    await database.stop();
    throw error;
  }
  return {
    stacks,
    stop: async () => {
      await Promise.all(stacks.map((stack) => stack.stop()));
      await database.stop();
    },
  };
}
