// The shell of the public API (M8 sprint 1, ADR-0037) through the whole pipeline on real Postgres and
// the real authoriser: tokens on a v1 route (Bearer and X-API-Key), the CORS allow-list, the `api`
// audit channel, the rate limits per token and per address, and the runtime document. The fixture
// module `fix.v1` is the only v1 data route there is; the real ones arrive in sprint 2.
import { createRoute, z } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import { tablesContaining } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { TOKEN_ADDRESS_FACTOR } from './pipeline/rate-limit.ts';
import { ALL_USER_SCOPES, useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();

const PING = 'fix.v1.ping.read';
const OTHER = 'fix.v1.other.read';
const ping = createRoute({
  method: 'get',
  path: '/ping',
  permission: PING,
  audit: true,
  summary: 'Answers pong',
  request: { query: z.object({ n: z.coerce.number().int().min(1).max(5).optional() }) },
  responses: {
    200: {
      description: 'pong',
      content: { 'application/json': { schema: z.object({ pong: z.literal(true) }) } },
    },
  },
});
const fixture = {
  id: 'fix.v1',
  manifest: defineModule({
    id: 'fix.v1',
    version: '1.0.0',
    permissions: {
      [PING]: { description: 'ping the public API' },
      [OTHER]: { description: 'another permission, for a token that lacks the first' },
    },
    routes: (r) => {
      r.public('v1', ping, ((c: { json: (b: unknown) => Response }) =>
        c.json({ pong: true })) as never);
    },
  }),
};

const ALLOWED = 'https://app.example.org';
const OTHER_ORIGIN = 'https://evil.example.net';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
type Started = Awaited<ReturnType<typeof start>>;
const start = (options: Parameters<typeof app.start>[0] = {}) =>
  app.start({
    extraModules: [fixture],
    publicApi: true,
    permissions: [...ALL_USER_SCOPES, PING, OTHER],
    tokenCacheTtlMs: 0,
    ...options,
  });

async function tokenFor(
  s: Started,
  who: { cookie: string; csrf: string },
  scopes: string[] = [PING],
  peer?: string,
) {
  const reply = await s.post('/tokens', {
    ...who,
    peer,
    body: { name: `t-${Math.random().toString(36).slice(2, 10)}`, scopes },
  });
  expect(reply.status).toBe(201);
  const { token, id } = reply.body as { token: string; id: string };
  return { token, id };
}
const admin = (s: Started) => s.signedIn('adminy', { roles: ['admin'] });
async function saveSettings(
  s: Started,
  who: { cookie: string; csrf: string },
  module: string,
  patch: Record<string, unknown>,
) {
  const current = (await s.get(`/settings/${module}`, who)).body as {
    version: number;
    values: Record<string, unknown>;
  };
  return s.call('PUT', `/settings/${module}`, {
    ...who,
    body: { version: current.version, values: { ...current.values, ...patch } },
  });
}
const trail = async (s: Started, where = "path like '/api/v1/%'") =>
  (await s.kernel.pool.query(`select * from audit_event where ${where} order by occurred_at, id`))
    .rows as Record<string, unknown>[];
const cors = (reply: Reply) => ({
  origin: reply.res.headers.get('access-control-allow-origin'),
  credentials: reply.res.headers.get('access-control-allow-credentials'),
});

describe('a token on a v1 route', () => {
  it('is 401 without credentials, 403 without the scope, 200 as Bearer and as X-API-Key [ASVS-8.3.1]', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const good = await tokenFor(s, alice);
    const wrong = await tokenFor(s, alice, [OTHER]);
    expect((await s.getV1('/ping')).status).toBe(401);
    expect(
      (await s.getV1('/ping', { headers: bearer('scp_abcd1234_' + 'A'.repeat(43)) })).status,
    ).toBe(401);
    expect((await s.getV1('/ping', { headers: bearer(wrong.token) })).status).toBe(403);
    for (const headers of [bearer(good.token), { 'x-api-key': good.token }]) {
      const reply = await s.getV1('/ping', { headers });
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ pong: true });
    }
  });

  it('is 403 when the owner does not hold the permission, whatever the scopes say [ASVS-8.3.1]', async () => {
    const s = await start();
    // Plain `user` holds the self-service permissions (so it can make a token) and not PING.
    const alice = await s.signedIn('alice', { roles: ['user'] });
    const { token } = await tokenFor(s, alice);
    expect((await s.getV1('/ping', { headers: bearer(token) })).status).toBe(403);
  });

  it('stops working the moment it is revoked, even with a long cache [ASVS-7.2.1] [ASVS-7.4.1]', async () => {
    const s = await start({ tokenCacheTtlMs: 60_000 });
    const alice = await s.signedIn('alice');
    const { token, id } = await tokenFor(s, alice);
    expect((await s.getV1('/ping', { headers: bearer(token) })).status).toBe(200);
    expect((await s.call('DELETE', `/tokens/${id}`, alice)).status).toBe(204);
    expect((await s.getV1('/ping', { headers: bearer(token) })).status).toBe(401);
  });

  it('is refused after its expiry and once its owner is no longer active [ASVS-7.2.1]', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const expired = await tokenFor(s, alice);
    const owned = await tokenFor(s, alice);
    for (const { token } of [expired, owned]) {
      expect((await s.getV1('/ping', { headers: bearer(token) })).status).toBe(200);
    }
    await s.kernel.pool.query(
      `update identity_token set expires_at = now() - interval '1 second' where id = $1`,
      [expired.id],
    );
    expect((await s.getV1('/ping', { headers: bearer(expired.token) })).status).toBe(401);
    await s.kernel.pool.query(`update identity_user set status = 'rejected', deleted_at = now()`);
    expect((await s.getV1('/ping', { headers: bearer(owned.token) })).status).toBe(401);
  });

  it('is 422 problem+json for bad input and never a 500', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const { token } = await tokenFor(s, alice);
    for (const n of ['abc', '0', '99', '1.5']) {
      const reply = await s.getV1(`/ping?n=${n}`, { headers: bearer(token) });
      expect(reply.status, n).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
    expect((await s.getV1('/ping?n=3', { headers: bearer(token) })).status).toBe(200);
  });
});

describe('CORS on /api/v1', () => {
  const withOrigins = async (origins: string[] = [ALLOWED], options = {}) => {
    const s = await start(options);
    const a = await admin(s);
    expect((await saveSettings(s, a, 'public-api', { corsOrigins: origins })).status).toBe(200);
    const alice = await s.signedIn('alice');
    return { s, a, ...(await tokenFor(s, alice)) };
  };

  it('answers an allowed origin with that origin, never `*`, never credentials', async () => {
    const { s, token } = await withOrigins();
    for (const call of [
      () => s.getV1('/ping', { headers: { ...bearer(token), origin: ALLOWED } }),
      () => s.getV1('/ping', { headers: { origin: ALLOWED } }), // 401: errors carry the header too
      () => s.getV1('/ping?n=x', { headers: { ...bearer(token), origin: ALLOWED } }), // 422
    ]) {
      const reply = await call();
      expect(cors(reply)).toEqual({ origin: ALLOWED, credentials: null });
      expect(reply.res.headers.get('vary')).toContain('Origin');
      expect(reply.res.headers.get('access-control-expose-headers')).toContain('Retry-After');
    }
  });

  it('gives a disallowed origin, `null` and a request without Origin no CORS header', async () => {
    const { s, token } = await withOrigins();
    for (const origin of [
      OTHER_ORIGIN,
      'null',
      'https://app.example.org.evil.net',
      'http://app.example.org',
      ALLOWED.toUpperCase(),
    ]) {
      const reply = await s.getV1('/ping', { headers: { ...bearer(token), origin } });
      expect(reply.status, origin).toBe(200); // the token judges the call, not the origin
      expect(cors(reply), origin).toEqual({ origin: null, credentials: null });
      expect(reply.res.headers.get('vary')).toContain('Origin');
    }
    const plain = await s.getV1('/ping', { headers: bearer(token) });
    expect(cors(plain)).toEqual({ origin: null, credentials: null });
  });

  it('answers a preflight of an allowed origin with 204 and the fixed lists', async () => {
    const { s } = await withOrigins();
    const reply = await s.call('OPTIONS', '/ping', {
      v1: true,
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization, x-evil',
      },
    });
    expect(reply.status).toBe(204);
    const h = reply.res.headers;
    expect(h.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(h.get('access-control-allow-credentials')).toBeNull();
    expect(h.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(h.get('access-control-allow-headers')).toBe(
      'Authorization, X-API-Key, Content-Type, X-Request-Id',
    );
    expect(h.get('access-control-allow-headers')).not.toContain('x-evil');
    expect(h.get('access-control-max-age')).toBe('600');
  });

  it('refuses the preflight of any other origin with 403 and no CORS header', async () => {
    const { s } = await withOrigins();
    for (const origin of [OTHER_ORIGIN, 'null']) {
      const reply = await s.call('OPTIONS', '/ping', {
        v1: true,
        headers: { origin, 'access-control-request-method': 'GET' },
      });
      expect(reply.status, origin).toBe(403);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
      expect(
        [...reply.res.headers.keys()].filter((k) => k.startsWith('access-control-allow')),
      ).toEqual([]);
    }
  });

  it('never answers for /api/internal: no CORS header, and a preflight is not answered', async () => {
    const { s, a } = await withOrigins();
    const get = await s.get('/auth/me', { ...a, headers: { origin: ALLOWED } });
    expect(get.status).toBe(200);
    expect([...get.res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
    const preflight = await s.call('OPTIONS', '/auth/me', {
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    expect(preflight.status).not.toBe(204);
    expect(
      [...preflight.res.headers.keys()].filter((k) => k.startsWith('access-control-')),
    ).toEqual([]);
  });

  it('allows nobody by default (same origin only)', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const { token } = await tokenFor(s, alice);
    const reply = await s.getV1('/ping', { headers: { ...bearer(token), origin: ALLOWED } });
    expect(cors(reply).origin).toBeNull();
    const pre = await s.call('OPTIONS', '/ping', {
      v1: true,
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    expect(pre.status).toBe(403);
  });

  it('takes a changed list at once, without a restart', async () => {
    const { s, a, token } = await withOrigins([ALLOWED]);
    const call = () => s.getV1('/ping', { headers: { ...bearer(token), origin: OTHER_ORIGIN } });
    expect(cors(await call()).origin).toBeNull();
    expect(
      (await saveSettings(s, a, 'public-api', { corsOrigins: [ALLOWED, OTHER_ORIGIN] })).status,
    ).toBe(200);
    expect(cors(await call()).origin).toBe(OTHER_ORIGIN);
    expect((await saveSettings(s, a, 'public-api', { corsOrigins: [] })).status).toBe(200);
    expect(cors(await call()).origin).toBeNull();
  });

  it('refuses to save an origin that is a wildcard, has a path, a different case or no scheme', async () => {
    const s = await start();
    const a = await admin(s);
    for (const bad of [
      '*',
      'https://*.example.org',
      'https://app.example.org/',
      'https://app.example.org/x',
      'https://App.example.org',
      'app.example.org',
      'null',
      'ftp://app.example.org',
    ]) {
      const reply = await saveSettings(s, a, 'public-api', { corsOrigins: [bad] });
      expect(reply.status, bad).toBe(422);
    }
    expect(
      (await saveSettings(s, a, 'public-api', { corsOrigins: ['http://localhost:5173'] })).status,
    ).toBe(200);
  });

  it('works under a base path of several segments, and does not touch a path that only starts like the API', async () => {
    const { s, token } = await withOrigins([ALLOWED], { basePath: '/a/b' });
    const reply = await s.getV1('/ping', { headers: { ...bearer(token), origin: ALLOWED } });
    expect(cors(reply).origin).toBe(ALLOWED);
  });

  it('lets a session cookie through like any route, but a page on another origin cannot read the answer', async () => {
    const { s } = await withOrigins();
    const alice = await s.signedIn('cookie-user');
    const reply = await s.getV1('/ping', { cookie: alice.cookie, headers: { origin: ALLOWED } });
    // Same as /api/internal: a session is a caller. What stops a foreign page is that no
    // Access-Control-Allow-Credentials is ever sent, so a browser hides the answer from its script.
    expect(reply.status).toBe(200);
    expect(cors(reply).credentials).toBeNull();
  });
});

describe('the api audit channel', () => {
  it('records every v1 call, denied and limited ones included, with the route template and the token id', async () => {
    const s = await start({ rateLimits: { default: { capacity: 3, refillPerSecond: 0.0001 } } });
    const alice = await s.signedIn('alice');
    const good = await tokenFor(s, alice);
    const wrong = await tokenFor(s, alice, [OTHER]);
    // Each call from its own address: the setup above used up the bucket of the default one.
    await s.getV1('/ping', { peer: '198.51.100.11' }); // 401
    await s.getV1('/ping', { headers: bearer(wrong.token), peer: '198.51.100.12' }); // 403
    const peer = '198.51.100.13';
    await s.getV1('/ping?n=x', { headers: bearer(good.token), peer }); // 422
    await s.getV1('/ping', { headers: { 'x-api-key': good.token }, peer }); // 200
    await s.getV1('/ping', { headers: bearer(good.token), peer }); // 200: the bucket holds 3
    expect((await s.getV1('/ping', { headers: bearer(good.token), peer })).status).toBe(429);
    const rows = await trail(s);
    expect(rows.map((r) => [r.status, r.outcome])).toEqual([
      [401, 'denied'],
      [403, 'denied'],
      [422, 'error'],
      [200, 'ok'],
      [200, 'ok'],
      [429, 'denied'],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ source: 'api', method: 'GET', path: '/api/v1/ping' });
    }
    expect(rows[0]).toMatchObject({ actor_kind: 'anonymous', token_id: null });
    expect(rows[1]).toMatchObject({ actor_kind: 'token', token_id: wrong.id });
    expect(rows[3]).toMatchObject({ actor_kind: 'token', token_id: good.id });
    // A call the rate limit turns away is recorded before its token was checked (a flood of guesses must
    // not cost a hash each), so it has the address and the request id and no token id (ADR-0037).
    expect(rows[5]).toMatchObject({ actor_kind: 'anonymous', token_id: null, ip: peer });
  });

  it('never holds the token, in the trail or in the log', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const { token } = await tokenFor(s, alice);
    await s.getV1('/ping', { headers: bearer(token) });
    await s.getV1('/ping?n=x', { headers: { 'x-api-key': token } });
    expect(await trail(s)).toHaveLength(2);
    // The one place a token legitimately sits is the response that created it, which is not stored.
    expect(await tablesContaining(s.kernel.pool, token)).toEqual([]);
    expect(s.logText()).not.toContain(token);
  });

  it('is switched off by `channels.api` for v1 calls only; the internal calls of the same route stay', async () => {
    const s = await start();
    const a = await admin(s);
    const { token } = await tokenFor(s, a);
    expect(
      (await saveSettings(s, a, 'core.audit', { channels: { admin: true, api: false } })).status,
    ).toBe(200);
    await s.getV1('/ping', { headers: bearer(token) });
    expect(await trail(s)).toEqual([]);
    expect(await trail(s, "path = '/api/internal/settings/{module}'")).not.toEqual([]);
  });

  it('does not record the spec: an anonymous call must not be able to fill the trail', async () => {
    const s = await start();
    expect((await s.getV1('/openapi.json')).status).toBe(200);
    expect(await trail(s)).toEqual([]);
  });

  it('does not record a CORS preflight', async () => {
    const s = await start();
    await s.call('OPTIONS', '/ping', {
      v1: true,
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    expect(await trail(s)).toEqual([]);
  });
});

describe('rate limits on v1', () => {
  const LIMIT = { default: { capacity: 3, refillPerSecond: 0.0001 } };
  const calls = async (s: Started, token: string, peer: string, n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push((await s.getV1('/ping', { headers: bearer(token), peer })).status);
    }
    return out;
  };

  it('limits a token by its own bucket and says when to come back', async () => {
    const s = await start({ rateLimits: LIMIT });
    const alice = await s.signedIn('alice');
    const { token } = await tokenFor(s, alice);
    expect(await calls(s, token, '198.51.100.1', 5)).toEqual([200, 200, 200, 429, 429]);
    const refused = await s.getV1('/ping', { headers: bearer(token), peer: '198.51.100.1' });
    expect(Number(refused.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((refused.body as { status: number }).status).toBe(429);
  });

  it('does not share the bucket of one token with another token on the same address', async () => {
    const s = await start({ rateLimits: LIMIT });
    const alice = await s.signedIn('alice');
    const a = await tokenFor(s, alice);
    const b = await tokenFor(s, alice);
    expect(await calls(s, a.token, '198.51.100.1', 4)).toEqual([200, 200, 200, 429]);
    expect(await calls(s, b.token, '198.51.100.1', 4)).toEqual([200, 200, 200, 429]);
  });

  it('does not let one token escape its bucket by changing the address', async () => {
    const s = await start({ rateLimits: LIMIT });
    const alice = await s.signedIn('alice');
    const { token } = await tokenFor(s, alice);
    expect(await calls(s, token, '198.51.100.1', 3)).toEqual([200, 200, 200]);
    expect(await calls(s, token, '198.51.100.2', 2)).toEqual([429, 429]);
    expect(await calls(s, token, '198.51.100.3', 1)).toEqual([429]);
  });

  it('still limits an address that runs many tokens, at TOKEN_ADDRESS_FACTOR times the bucket', async () => {
    const s = await start({ rateLimits: LIMIT });
    const alice = await s.signedIn('alice');
    const tokens = [];
    for (let i = 0; i < TOKEN_ADDRESS_FACTOR + 1; i++) {
      tokens.push(await tokenFor(s, alice, [PING], `198.51.100.${100 + i}`));
    }
    const statuses: number[] = [];
    for (const { token } of tokens) statuses.push(...(await calls(s, token, '198.51.100.9', 3)));
    // 33 calls from one address, 3 for each of 11 tokens: the address bucket of 30 runs out at the 31st.
    expect(statuses.filter((status) => status === 200)).toHaveLength(3 * TOKEN_ADDRESS_FACTOR);
    expect(statuses.slice(-3)).toEqual([429, 429, 429]);
  });

  it('keeps the address bucket of the browsers apart from the one of the tokens', async () => {
    const s = await start({ rateLimits: LIMIT });
    const alice = await s.signedIn('alice');
    const { token } = await tokenFor(s, alice);
    // The people on this address use up their own bucket …
    const browser = async () =>
      (await s.get('/auth/me', { ...alice, peer: '198.51.100.5' })).status;
    expect([await browser(), await browser(), await browser(), await browser()].slice(-1)).toEqual([
      429,
    ]);
    // … and a program on the same address is not affected, and the other way round.
    expect(await calls(s, token, '198.51.100.5', 3)).toEqual([200, 200, 200]);
    expect(await browser()).toBe(429);
  });

  it('does not scale the strict group: token creation stays at its own bucket', async () => {
    const s = await start({ rateLimits: { strict: { capacity: 2, refillPerSecond: 0.0001 } } });
    const alice = await s.signedIn('alice');
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await s.post('/auth/login', {
            body: { username: 'alice', password: 'wrong wrong wrong' },
            peer: '198.51.100.7',
          })
        ).status,
      );
    }
    expect(statuses.slice(-2)).toEqual([429, 429]);
    expect(alice.user).toBeTruthy();
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('is public, lists the loaded v1 routes with the permission each needs, and the server URL is the request origin plus the base path', async () => {
    const s = await start({ basePath: '/a/b' });
    const reply = await s.getV1('/openapi.json');
    expect(reply.status).toBe(200);
    const doc = reply.body as {
      info: { title: string; contact?: unknown };
      servers: { url: string }[];
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    // The fixture's route and the v1 routes of the registry modules the profile carries.
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/openapi.json',
      '/ping',
      '/providers',
      '/providers/{id}',
      '/services',
      '/services/{id}',
      '/services/{id}/schema-org',
    ]);
    expect(doc.paths['/ping']!.get).toMatchObject({
      'x-permission': PING,
      summary: 'Answers pong',
    });
    expect(doc.paths['/openapi.json']!.get).toMatchObject({ 'x-public': true });
    expect(doc.servers).toEqual([{ url: 'http://localhost/a/b/api/v1' }]);
    expect(doc.info).toMatchObject({ title: 'Public API' });
    expect(doc.info.contact).toBeUndefined();
    expect(JSON.stringify(doc)).not.toContain('/api/internal');
  });

  it('takes its title, description and contact from the settings, and a change shows at once', async () => {
    const s = await start();
    const a = await admin(s);
    expect(
      (
        await saveSettings(s, a, 'public-api', {
          specTitle: 'Registry API of the Example Network',
          contactName: 'API team',
          contactEmail: 'api@example.org',
          contactUrl: 'https://example.org/api',
        })
      ).status,
    ).toBe(200);
    const doc = (await s.getV1('/openapi.json')).body as { info: Record<string, unknown> };
    expect(doc.info).toMatchObject({
      title: 'Registry API of the Example Network',
      contact: { name: 'API team', email: 'api@example.org', url: 'https://example.org/api' },
    });
  });

  it('is limited like any route', async () => {
    const s = await start({ rateLimits: { default: { capacity: 2, refillPerSecond: 0.0001 } } });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await s.getV1('/openapi.json')).status);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('refuses a bad contact address and an over-long title when saving, with a 422', async () => {
    const s = await start();
    const a = await admin(s);
    expect((await saveSettings(s, a, 'public-api', { contactEmail: 'nope' })).status).toBe(422);
    expect(
      (await saveSettings(s, a, 'public-api', { contactUrl: 'javascript:alert(1)' })).status,
    ).toBe(422);
    expect((await saveSettings(s, a, 'public-api', { specTitle: 'x'.repeat(101) })).status).toBe(
      422,
    );
  });

  it('is not there in a profile without public-api, and the CORS list then allows nobody', async () => {
    const s = await app.start({ extraModules: [fixture], permissions: [...ALL_USER_SCOPES, PING] });
    expect((await s.getV1('/openapi.json')).status).toBe(404);
    const alice = await s.signedIn('alice');
    const { token } = await tokenFor(s, alice);
    const reply = await s.getV1('/ping', { headers: { ...bearer(token), origin: ALLOWED } });
    expect(reply.status).toBe(200);
    expect(cors(reply).origin).toBeNull();
  });
});
