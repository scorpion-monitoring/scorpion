import { Writable } from 'node:stream';
import { ANONYMOUS, Unauthorized, type Actor, type AppEnv } from '@scorpion/contracts';
import { createLogger, loadConfig, type Authenticator, type Authorizer } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { useKernels } from '../../../../packages/kernel/test/helpers.ts';
import { createApp, SURFACE_PREFIX, type AppOptions } from '../app.ts';
import { createMetrics } from '../metrics.ts';

const kernels = useKernels();
const config = loadConfig({ DATABASE_URL: 'postgres://unused@localhost/unused' });
const probes = {
  readiness: () =>
    Promise.resolve({
      ready: true,
      checks: { database: 'ok', migrations: 'complete', kernel: 'started' } as const,
    }),
  metrics: createMetrics(),
};
const things = `${SURFACE_PREFIX.internal}/things`;
const ping = `${SURFACE_PREFIX.internal}/ping`; // public

const alice: Actor = { kind: 'user', userId: 'u1', username: 'alice', roles: [], via: 'session' };

async function app(extra: Partial<AppOptions> = {}) {
  const kernel = await kernels.fixture('routes');
  await kernel.start();
  const lines: string[] = [];
  const seen: { actor: Actor; permission: string }[] = [];
  const authorizer: Authorizer = ({ actor, permission }) => {
    seen.push({ actor, permission });
  };
  const built = createApp({
    config,
    log: createLogger({
      level: 'trace',
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    }),
    routes: kernel.routes,
    authorizer,
    probes,
    ...extra,
  });
  return {
    request: (path: string, init?: RequestInit) => Promise.resolve(built.request(path, init)),
    seen,
    lines,
  };
}

describe('step 4: authentication', () => {
  it('makes every caller anonymous when there is no authenticator, and a public route accepts that', async () => {
    const { request, seen } = await app();
    expect((await request(ping)).status).toBe(200);
    expect((await request(things)).status).toBe(200); // the test authoriser lets it through
    expect(seen).toEqual([{ actor: ANONYMOUS, permission: 'fixture.routes.read' }]);
  });

  it('makes a caller without credentials anonymous when the authenticator finds none', async () => {
    const { request, seen } = await app({ authenticator: () => undefined });
    await request(things);
    expect(seen[0]!.actor).toEqual({ kind: 'anonymous' });
  });

  it('gives the authoriser the actor the authenticator resolved, from the request headers', async () => {
    const authenticator: Authenticator = ({ context }) =>
      context.req.header('authorization') === 'Bearer good' ? alice : undefined;
    const { request, seen } = await app({ authenticator });
    await request(things, { headers: { authorization: 'Bearer good' } });
    await request(things);
    expect(seen.map((s) => s.actor)).toEqual([alice, ANONYMOUS]);
  });

  it('answers 401 problem+json for bad credentials, and does not reach the authoriser', async () => {
    const { request, seen } = await app({
      authenticator: () => {
        throw new Unauthorized('The token is not valid.');
      },
    });
    const response = await request(things);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(seen).toEqual([]);
  });

  it('treats bad credentials as "not signed in" on a public route', async () => {
    const { request } = await app({
      authenticator: () => {
        throw new Unauthorized('The session has expired.');
      },
    });
    expect((await request(ping)).status).toBe(200);
  });

  it('answers 500 without detail when the authenticator breaks, and never lets the request through', async () => {
    const { request, seen, lines } = await app({
      authenticator: () => {
        throw new Error('database password is hunter2');
      },
    });
    const response = await request(things);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('hunter2');
    expect(seen).toEqual([]);
    expect((await request(ping)).status).toBe(500); // public routes are no exception
    expect(lines.join('')).toContain('unhandled error');
  });

  it('refuses a result that is not an Actor', async () => {
    const { request, seen } = await app({
      authenticator: () => ({ kind: 'admin' }) as unknown as Actor,
    });
    expect((await request(things)).status).toBe(500);
    expect(seen).toEqual([]);
  });

  it('does not run for the probes, which must not need the database', async () => {
    let calls = 0;
    const { request } = await app({
      authenticator: () => {
        calls += 1;
        return undefined;
      },
    });
    expect((await request('/healthz')).status).toBe(200);
    expect(calls).toBe(0);
    await request(things);
    expect(calls).toBe(1);
  });
});

describe('recheckActor (ADR-0028: a stream that outlives the check at its start)', () => {
  const sessionActor: Actor = {
    kind: 'user',
    userId: 'u1',
    username: 'alice',
    roles: [],
    via: 'session',
    sessionId: 's1',
  };

  /** One request through only this step, then the re-check as the handler of a stream would ask it. */
  async function ask(authenticator: Authenticator, route: { public?: true } = {}) {
    const { Hono } = await import('hono');
    const { authenticate } = await import('./authenticate.ts');
    const hono = new Hono<AppEnv>();
    hono.use('*', authenticate(authenticator, route));
    hono.get('/', async (c) => {
      const recheck = c.get('recheckActor');
      return c.json({ first: await recheck(), second: await recheck() });
    });
    const reply = await hono.request('/');
    return {
      status: reply.status,
      body: (await reply.json()) as { first: boolean; second: boolean },
    };
  }

  it('is true while the same session is still good, and the re-check is passive', async () => {
    const calls: { passive?: boolean }[] = [];
    const { body } = await ask((request) => {
      calls.push({ passive: request.passive });
      return sessionActor;
    });
    expect(body).toEqual({ first: true, second: true });
    // The first call is the request's own; the others are re-checks and must not count as activity.
    expect(calls.map((call) => call.passive)).toEqual([undefined, true, true]);
  });

  it.each([
    ['the session ended', () => Promise.reject(new Unauthorized('gone'))],
    ['the credentials vanished', () => undefined],
    ['it is another session', () => ({ ...sessionActor, sessionId: 's2' })],
    ['it is another person', () => ({ ...sessionActor, userId: 'u2' })],
    ['it is a token now', () => ({ ...sessionActor, via: 'token', sessionId: undefined })],
    ['the authenticator fails', () => Promise.reject(new Error('database down'))],
  ])('is false when %s', async (_name, again) => {
    let n = 0;
    const { body } = await ask(() => (n++ === 0 ? sessionActor : (again() as never)));
    expect(body.first).toBe(false);
  });

  it('is false for an anonymous caller, and on a public route whose credentials were bad', async () => {
    expect((await ask(() => undefined, { public: true })).body).toEqual({
      first: false,
      second: false,
    });
    expect(
      (await ask(() => Promise.reject(new Unauthorized('stale')), { public: true })).body.first,
    ).toBe(false);
  });
});
