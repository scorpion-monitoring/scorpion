import { Writable } from 'node:stream';
import { createLogger, loadConfig, type Authorizer } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { useKernels } from '../../../../packages/kernel/test/helpers.ts';
import { createApp, SURFACE_PREFIX, type AppOptions } from '../app.ts';
import { createMetrics } from '../metrics.ts';

const kernels = useKernels();
const allow: Authorizer = () => undefined;
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
const SLOW = { refillPerSecond: 0.001 };

async function rateLimitedApp(extra: Partial<AppOptions> = {}, trusted: string[] = []) {
  const kernel = await kernels.fixture('routes');
  await kernel.start();
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    level: 'trace',
    destination: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        callback();
      },
    }),
  });
  const app = createApp({
    config: { ...config, TRUSTED_PROXIES: trusted },
    log,
    routes: kernel.routes,
    authorizer: allow,
    probes,
    rateLimiter: kernel.rateLimiter,
    rateLimits: { default: { capacity: 3, ...SLOW }, strict: { capacity: 1, ...SLOW } },
    ...extra,
  });
  return {
    kernel,
    lines,
    /** A request from the socket address `peer`. */
    from: (peer: string, path: string, init?: RequestInit) =>
      Promise.resolve(app.request(path, init, { incoming: { socket: { remoteAddress: peer } } })),
  };
}

const post = (name: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name }),
});

describe('step 2: rate limit', () => {
  it('answers 429 problem+json with Retry-After once the burst is used up', async () => {
    const { from } = await rateLimitedApp();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await from('203.0.113.1', things)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);

    const refused = await from('203.0.113.1', things);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toContain('application/problem+json');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await refused.json()).toMatchObject({
      status: 429,
      title: 'Too Many Requests',
      requestId: refused.headers.get('x-request-id'),
    });
  });

  it('keeps a bucket per client address', async () => {
    const { from } = await rateLimitedApp();
    for (let i = 0; i < 3; i++) await from('203.0.113.1', things);
    expect((await from('203.0.113.1', things)).status).toBe(429);
    expect((await from('203.0.113.2', things)).status).toBe(200);
  });

  it('refuses before the handler and before the body is read', async () => {
    const { from } = await rateLimitedApp();
    expect((await from('203.0.113.1', things, post('first'))).status).toBe(201);
    // Strict allows one request. The second would be a 422 if it got as far as validation.
    const refused = await from('203.0.113.1', things, post(''));
    expect(refused.status).toBe(429);
  });

  it('gives a strict route its own budget, apart from the default routes', async () => {
    const { from } = await rateLimitedApp();
    expect((await from('203.0.113.1', things, post('a'))).status).toBe(201);
    expect((await from('203.0.113.1', things, post('b'))).status).toBe(429); // strict: 1
    expect((await from('203.0.113.1', things)).status).toBe(200); // default is untouched
  });

  it('does not limit the probes', async () => {
    const { from } = await rateLimitedApp({ rateLimits: { default: { capacity: 1, ...SLOW } } });
    for (let i = 0; i < 5; i++) expect((await from('203.0.113.1', '/healthz')).status).toBe(200);
  });

  it('limits nothing when no limiter is given', async () => {
    const { from } = await rateLimitedApp({ rateLimiter: undefined });
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.1', things)).status).toBe(200);
  });

  it('gives the last token to one of two parallel requests, never to both', async () => {
    const { from } = await rateLimitedApp({ rateLimits: { default: { capacity: 1, ...SLOW } } });
    for (let round = 0; round < 10; round++) {
      const peer = `198.51.100.${round + 1}`;
      const responses = await Promise.all([from(peer, things), from(peer, things)]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
    }
  });

  describe('the client address', () => {
    const forwarded = (client: string) => ({ headers: { 'x-forwarded-for': client } });

    it('ignores X-Forwarded-For when no proxy is trusted: a client cannot pick its own address', async () => {
      const { from } = await rateLimitedApp();
      for (let i = 0; i < 3; i++) await from('203.0.113.1', things, forwarded(`9.9.9.${i}`));
      expect((await from('203.0.113.1', things, forwarded('9.9.9.99'))).status).toBe(429);
    });

    it('reads the header from a trusted proxy, from the right', async () => {
      const { from } = await rateLimitedApp({}, ['10.0.0.1']);
      // The proxy appended the real client; whatever the client wrote at the left is irrelevant.
      for (let i = 0; i < 3; i++)
        await from('10.0.0.1', things, forwarded(`1.1.1.${i}, 198.51.100.50`));
      expect((await from('10.0.0.1', things, forwarded('2.2.2.2, 198.51.100.50'))).status).toBe(
        429,
      );
      expect((await from('10.0.0.1', things, forwarded('198.51.100.51'))).status).toBe(200);
    });
  });

  describe('credentials', () => {
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

    it('limits a token across addresses, so rotating addresses does not help', async () => {
      const { from } = await rateLimitedApp();
      for (let i = 0; i < 3; i++)
        await from(`192.0.2.${i + 1}`, things, bearer('scp_abcd1234_s3cret'));
      expect((await from('192.0.2.200', things, bearer('scp_abcd1234_s3cret'))).status).toBe(429);
      expect((await from('192.0.2.200', things, bearer('scp_other000_s3cret'))).status).toBe(200);
    });

    it('applies to X-API-Key as well', async () => {
      const { from } = await rateLimitedApp();
      const key = { headers: { 'x-api-key': 'scp_abcd1234_s3cret' } };
      for (let i = 0; i < 3; i++) await from(`192.0.2.${i + 1}`, things, key);
      expect((await from('192.0.2.200', things, key)).status).toBe(429);
    });

    it('never stores or logs the token itself', async () => {
      const { from, kernel, lines } = await rateLimitedApp();
      for (let i = 0; i < 4; i++) await from('192.0.2.1', things, bearer('scp_abcd1234_s3cret'));
      const { rows } = await kernel.pool.query<{ key: string }>(
        'select key from kernel_rate_bucket',
      );
      expect(JSON.stringify(rows)).not.toContain('s3cret');
      expect(JSON.stringify(rows)).not.toContain('scp_abcd1234');
      expect(JSON.stringify(lines)).not.toContain('s3cret');
      expect(JSON.stringify(lines)).toContain('rate limit exceeded');
    });
  });
});
