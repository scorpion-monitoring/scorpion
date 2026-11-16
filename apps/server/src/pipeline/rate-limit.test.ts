import { Writable } from 'node:stream';
import { createLogger, loadConfig, type Authenticator, type Authorizer } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { useKernels } from '../../../../packages/kernel/test/helpers.ts';
import { createApp, SURFACE_PREFIX, type AppOptions } from '../app.ts';
import { createMetrics } from '../metrics.ts';
import {
  bucketKeys,
  limitsFromSettings,
  RATE_LIMITS,
  sessionBucketId,
  SESSION_ADDRESS_FACTOR,
  TOKEN_ADDRESS_FACTOR,
} from './rate-limit.ts';

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

describe('limits an administrator saved (core.settings)', () => {
  const saved = (over: Record<string, unknown> = {}) => ({
    rateLimits: {
      default: { burst: 2, perMinute: 30 },
      strict: { burst: 1, perMinute: 6 },
      ...over,
    },
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'x'],
    ['no rateLimits', {}],
    ['a group missing', { rateLimits: { default: { burst: 2, perMinute: 30 } } }],
    ['a zero burst', saved({ default: { burst: 0, perMinute: 30 } })],
    ['a negative rate', saved({ strict: { burst: 1, perMinute: -1 } })],
    ['a text number', saved({ strict: { burst: '1', perMinute: 6 } })],
  ])('leaves the constants in force for %s', (_name, values) => {
    expect(limitsFromSettings(values)).toBeUndefined();
  });

  it('turns a burst and a rate per minute into a token bucket', () => {
    expect(limitsFromSettings(saved())).toEqual({
      default: { capacity: 2, refillPerSecond: 0.5 },
      strict: { capacity: 1, refillPerSecond: 0.1 },
    });
  });

  it('has defaults, the module’s, that equal the constants of the pipeline', () => {
    expect(
      limitsFromSettings({
        rateLimits: {
          default: { burst: 120, perMinute: 120 },
          strict: { burst: 10, perMinute: 10 },
        },
      }),
    ).toEqual({
      default: {
        capacity: RATE_LIMITS.default.capacity,
        refillPerSecond: RATE_LIMITS.default.refillPerSecond,
      },
      strict: {
        capacity: RATE_LIMITS.strict.capacity,
        refillPerSecond: RATE_LIMITS.strict.refillPerSecond,
      },
    });
  });

  it('are read for every request: a change applies at once, and a failing source leaves the constants', async () => {
    let current: Parameters<typeof limitsFromSettings>[0] = saved();
    let failing = false;
    const { from, lines } = await rateLimitedApp({
      rateLimits: undefined,
      storedRateLimits: () => {
        if (failing) return Promise.reject(new Error('the database is away'));
        return Promise.resolve(limitsFromSettings(current));
      },
    });
    const statuses = async (peer: string, n: number) => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push((await from(peer, things)).status);
      return out;
    };
    expect(await statuses('203.0.113.50', 3)).toEqual([200, 200, 429]); // the saved burst of 2
    current = saved({ default: { burst: 5, perMinute: 30 } });
    expect(await statuses('203.0.113.51', 6)).toEqual([200, 200, 200, 200, 200, 429]);
    failing = true;
    expect(await statuses('203.0.113.52', 3)).toEqual([200, 200, 200]); // the constants: a burst of 120
    expect(
      lines.some(
        (line) => line.msg === 'could not read the stored rate limits; the defaults apply',
      ),
    ).toBe(true);
  });

  it('lose against a limit a test fixes, so existing tests keep their numbers', async () => {
    const { from } = await rateLimitedApp({
      storedRateLimits: () => Promise.resolve(limitsFromSettings(saved())),
    });
    const out: number[] = [];
    for (let i = 0; i < 4; i++) out.push((await from('203.0.113.60', things)).status);
    expect(out).toEqual([200, 200, 200, 429]); // the fixture's burst of 3, not the saved 2
  });
});

describe('the bucket keys of a request', () => {
  const A = 'session-row-a';
  const keyOf = (input: Parameters<typeof bucketKeys>[0]) =>
    bucketKeys(input).map(({ key, scale }) => ({
      key: key.replace(sessionBucketId(A), '<A>'),
      scale,
    }));

  it.each([
    [
      'anonymous: the address bucket, as before',
      { group: 'default', address: '203.0.113.1' },
      [{ key: 'ip:default:203.0.113.1', scale: 1 }],
    ],
    [
      'a session cookie not yet judged: the larger address bucket of a browser',
      { group: 'default', address: '203.0.113.1', sessionCookie: true },
      [{ key: 'ip-session:default:203.0.113.1', scale: SESSION_ADDRESS_FACTOR }],
    ],
    [
      'a session found good: the ceiling and the session',
      { group: 'default', address: '203.0.113.1', sessionCookie: true, sessionId: A },
      [
        { key: 'ip-session:default:203.0.113.1', scale: SESSION_ADDRESS_FACTOR },
        { key: 'session:default:<A>', scale: 1 },
      ],
    ],
    [
      'a token: the larger address bucket and the credential, as before',
      { group: 'default', address: '203.0.113.1', credential: 'abc' },
      [
        { key: 'ip-token:default:203.0.113.1', scale: TOKEN_ADDRESS_FACTOR },
        { key: 'credential:default:abc', scale: 1 },
      ],
    ],
    [
      'a token wins over a cookie',
      { group: 'default', address: '203.0.113.1', credential: 'abc', sessionCookie: true },
      [
        { key: 'ip-token:default:203.0.113.1', scale: TOKEN_ADDRESS_FACTOR },
        { key: 'credential:default:abc', scale: 1 },
      ],
    ],
    [
      'the strict group: the address only, whatever the caller carries',
      { group: 'strict', address: '203.0.113.1', sessionCookie: true, sessionId: A },
      [{ key: 'ip:strict:203.0.113.1', scale: 1 }],
    ],
    [
      'the strict group with a token: unchanged',
      { group: 'strict', address: '203.0.113.1', credential: 'abc' },
      [{ key: 'ip:strict:203.0.113.1', scale: 1 }],
    ],
  ] as const)('%s', (_name, input, expected) => {
    expect(keyOf({ ...input })).toEqual(expected);
  });

  it('keys two sessions on one address apart, and hashes the session id', () => {
    const one = bucketKeys({ group: 'default', address: 'x', sessionCookie: true, sessionId: 'a' });
    const two = bucketKeys({ group: 'default', address: 'x', sessionCookie: true, sessionId: 'b' });
    expect(one[0]).toEqual(two[0]); // the same ceiling
    expect(one[1]!.key).not.toBe(two[1]!.key);
    expect(one[1]!.key).not.toContain('a'.repeat(1) + ':'); // not the id itself
    expect(sessionBucketId('a')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('step 3b: a bucket for each session [ASVS-6.1.1]', () => {
  const COOKIE = '__Host-session';
  const sessions: Record<string, string> = {
    'cookie-of-ann-0123456789': 'row-ann',
    'cookie-of-bob-0123456789': 'row-bob',
  };
  /** The authenticator of the test: the cookie value names a session row; an unknown value is no caller. */
  const authenticator: Authenticator = ({ context }) => {
    const value = /__Host-session=([^;]+)/.exec(context.req.header('cookie') ?? '')?.[1];
    const sessionId = value === undefined ? undefined : sessions[value];
    return sessionId === undefined
      ? undefined
      : {
          kind: 'user',
          userId: sessionId,
          username: sessionId,
          roles: [],
          via: 'session',
          sessionId,
        };
  };
  const as = (name: 'ann' | 'bob' | 'forged') => ({
    headers: {
      cookie: `${COOKIE}=${name === 'forged' ? 'forged-value-0123456789' : `cookie-of-${name}-0123456789`}`,
    },
  });
  const app = () => rateLimitedApp({ authenticator, sessionCookie: COOKIE });

  it('two people behind one address do not share a budget', async () => {
    const { from } = await app();
    const address = '198.51.100.7';
    // Ann uses her whole burst of 3 (the default group in this test) ...
    for (let i = 0; i < 3; i++) expect((await from(address, things, as('ann'))).status).toBe(200);
    // ... and is refused, with Retry-After, ...
    const refused = await from(address, things, as('ann'));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(refused.headers.get('content-type')).toContain('application/problem+json');
    // ... while Bob, from the same address, has all of his own.
    for (let i = 0; i < 3; i++) expect((await from(address, things, as('bob'))).status).toBe(200);
    expect((await from(address, things, as('bob'))).status).toBe(429);
  });

  it('keeps the address as a ceiling: many sessions on one address stop at the ceiling', async () => {
    const sessionsOf: Record<string, string> = {};
    for (let i = 0; i < 40; i++) sessionsOf[`cookie-${i}-0123456789012`] = `row-${i}`;
    const many: Authenticator = ({ context }) => {
      const value = /__Host-session=([^;]+)/.exec(context.req.header('cookie') ?? '')?.[1];
      const sessionId = value === undefined ? undefined : sessionsOf[value];
      return sessionId === undefined
        ? undefined
        : {
            kind: 'user',
            userId: sessionId,
            username: sessionId,
            roles: [],
            via: 'session',
            sessionId,
          };
    };
    const { from } = await rateLimitedApp({ authenticator: many, sessionCookie: COOKIE });
    // The ceiling is 3 * SESSION_ADDRESS_FACTOR; one request each from forty different sessions.
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++)
      statuses.push(
        (
          await from('198.51.100.8', things, {
            headers: { cookie: `${COOKIE}=cookie-${i}-0123456789012` },
          })
        ).status,
      );
    expect(statuses.filter((status) => status === 200)).toHaveLength(3 * SESSION_ADDRESS_FACTOR);
    expect(statuses.at(-1)).toBe(429);
  });

  it('leaves anonymous callers and the strict group as they were', async () => {
    const { from } = await app();
    const address = '198.51.100.9';
    for (let i = 0; i < 3; i++) expect((await from(address, things)).status).toBe(200);
    expect((await from(address, things)).status).toBe(429); // anonymous: the address bucket of 3
    // A browser on the same address has its own, larger address bucket and its own session.
    expect((await from(address, things, as('ann'))).status).toBe(200);
    // Strict: by address, whoever asks (a budget of 1 here).
    expect(
      (
        await from('198.51.100.10', things, {
          ...post('a'),
          headers: { ...(post('a').headers as object), ...as('ann').headers },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await from('198.51.100.10', things, {
          ...post('b'),
          headers: { ...(post('b').headers as object), ...as('bob').headers },
        })
      ).status,
    ).toBe(429);
  });

  it('a forged cookie is no session: it is charged to the address bucket and never gets one of its own', async () => {
    const { from, kernel } = await app();
    for (let i = 0; i < 3; i++)
      expect((await from('198.51.100.11', things, as('forged'))).status).toBe(200);
    const { rows } = await kernel.pool.query<{ key: string }>('select key from kernel_rate_bucket');
    expect(rows.map((row) => row.key.split(':')[0])).toEqual(['ip-session']);
  });

  it('never stores or logs the cookie value or the session id', async () => {
    const { from, kernel, lines } = await app();
    for (let i = 0; i < 4; i++) await from('198.51.100.12', things, as('ann'));
    const { rows } = await kernel.pool.query<{ key: string }>('select key from kernel_rate_bucket');
    const stored = JSON.stringify(rows);
    expect(stored).toContain('session:default:');
    for (const secret of ['cookie-of-ann', 'row-ann']) {
      expect(stored).not.toContain(secret);
      expect(JSON.stringify(lines)).not.toContain(secret);
    }
    expect(JSON.stringify(lines)).toContain('rate limit exceeded');
  });
});
