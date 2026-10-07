// The process an image runs (`CMD` of docker/Dockerfile; ADR-0027). A profile with `core.ui-shell` has a
// web app next to the API:
//
//   web  `node apps/web/src/front/main.ts` on PORT (the public origin: pages, and `/api`, `/healthz` and
//        `/readyz` streamed to the API);
//   api  `node apps/server/src/cli.ts start` on API_PORT (default 3001), which only the web process
//        talks to. `/metrics` is served there and is not proxied: do not publish that port.
//
// A profile without the shell has no `apps/web/build` in its image and runs the API alone on PORT, as
// before. Either way this process forwards SIGTERM and SIGINT, and when one of the two ends it stops the
// other and ends with the first one's exit code, so the container never runs half an application.
import { spawn, type ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Child {
  name: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface Plan {
  children: Child[];
  problems: string[];
}

/**
 * What to run, from the environment and from whether the image has the web app. A pure function, so the
 * ports and the proxy trust are tested without starting anything.
 */
export function plan(env: NodeJS.ProcessEnv, hasWeb: boolean): Plan {
  const api = ['apps/server/src/cli.ts', 'start'];
  if (!hasWeb) return { children: [{ name: 'api', args: api, env }], problems: [] };

  const port = env.PORT ?? '3000';
  const apiPort = env.API_PORT ?? '3001';
  const problems: string[] = [];
  for (const [name, value] of [
    ['PORT', port],
    ['API_PORT', apiPort],
  ] as const) {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
      problems.push(`${name} must be a port number`);
    }
  }
  if (port === apiPort)
    problems.push('PORT and API_PORT must differ: the web server and the API each need one');

  // The API's only peer is the web process on the loopback address, whose X-Forwarded-For tells who the
  // caller was; the API must trust it, or the rate limit would see one address for everybody.
  const trusted = [
    ...new Set([
      ...(env.TRUSTED_PROXIES ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
      '127.0.0.1',
      '::1',
    ]),
  ].join(',');

  return {
    problems,
    children: [
      { name: 'api', args: api, env: { ...env, PORT: apiPort, TRUSTED_PROXIES: trusted } },
      {
        name: 'web',
        args: ['apps/web/src/front/main.ts'],
        env: { ...env, PORT: port, API_ORIGIN: `http://127.0.0.1:${apiPort}` },
      },
    ],
  };
}

/** Runs the children until one ends or a signal arrives. Resolves with the exit code of the process. */
export function supervise(
  children: readonly Child[],
  cwd: string,
  signals: Pick<EventEmitter, 'once'> = process,
): Promise<number> {
  return new Promise((resolve) => {
    const running = new Map<string, ChildProcess>();
    let code: number | undefined;
    let stopping = false;
    const stopAll = (signal: NodeJS.Signals) => {
      stopping = true;
      for (const child of running.values()) child.kill(signal);
    };
    for (const { name, args, env } of children) {
      const child = spawn('node', args, { cwd, env, stdio: 'inherit' });
      running.set(name, child);
      child.on('error', (error) => {
        console.error(`image: could not start ${name}: ${error.message}`);
        code ??= 1;
        running.delete(name);
        if (!stopping) stopAll('SIGTERM');
        if (running.size === 0) resolve(code);
      });
      child.on('exit', (status, signal) => {
        running.delete(name);
        // The first process to end decides the exit code: a crash is 1 (or its own code), a clean stop is 0.
        code ??= status ?? (signal ? 1 : 0);
        if (!stopping) {
          console.error(`image: ${name} ended (${status ?? signal}); stopping the rest`);
          stopAll('SIGTERM');
        }
        if (running.size === 0) resolve(code);
      });
    }
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      signals.once(signal, () => {
        code ??= 0;
        stopAll(signal);
      });
    }
  });
}

if (import.meta.main) {
  const root = process.cwd();
  const hasWeb = existsSync(join(root, 'apps/web/build/handler.js'));
  const { children, problems } = plan(process.env, hasWeb);
  if (problems.length > 0) {
    console.error(`image: ${problems.join('; ')}`);
    process.exit(2);
  }
  process.exitCode = await supervise(children, root);
}
