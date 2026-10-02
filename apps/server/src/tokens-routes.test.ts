// The access-token routes through the whole pipeline, on real Postgres: PATs end to end, the
// denied requests, bad input, the secret that is shown once, and what the log may not hold.
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

interface Created {
  id: string;
  token: string;
  prefix: string;
  name: string;
}

async function withToken(options: Parameters<typeof app.start>[0] = {}, name = 'alice') {
  const started = await app.start({ tokenCacheTtlMs: 0, ...options });
  const session = await started.signedIn(name);
  const reply = await started.post('/tokens', {
    ...session,
    body: { name: 'ci', scopes: ['read:kpi'] },
  });
  expect(reply.status).toBe(201);
  return { ...started, session, created: reply.body as Created };
}

describe('using a token', () => {
  it('works as Authorization: Bearer and as X-API-Key, and the actor knows it is a token', async () => {
    const { get, created } = await withToken();
    for (const headers of [bearer(created.token), { 'x-api-key': created.token }]) {
      const reply = await get('/auth/me', { headers });
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({
        user: { username: 'alice' },
        csrfToken: null, // no session, so nothing to forge
      });
    }
  });

  it('needs no CSRF token for a write, and does not need the cookie', async () => {
    const { post, created } = await withToken();
    const reply = await post('/auth/logout-all', { headers: bearer(created.token) });
    expect(reply.status).toBe(200);
  });

  it('stops working the moment it is revoked, even with a long cache', async () => {
    const { get, call, session, created } = await withToken({ tokenCacheTtlMs: 60_000 });
    expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(200);
    expect((await call('DELETE', `/tokens/${created.id}`, session)).status).toBe(204);
    expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(401);
  });

  it('is refused when its owner is no longer active', async () => {
    const { get, kernel, created } = await withToken();
    await kernel.pool.query(`update identity_user set status = 'rejected', deleted_at = now()`);
    expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(401);
  });

  it('is refused after its expiry', async () => {
    const { get, kernel, created } = await withToken();
    await kernel.pool.query(`update identity_token set expires_at = now() - interval '1 second'`);
    expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(401);
  });

  it('takes precedence over a session cookie: it is a token request and nothing else', async () => {
    const { post, get, session, created } = await withToken();
    // A good cookie without a CSRF token would be a 401 as a session request; as a token request
    // it is a 403, because a token may not manage tokens. It is not a 201 either.
    const both = await post('/tokens', {
      cookie: session.cookie,
      headers: bearer(created.token),
      body: { name: 'second' },
    });
    expect(both.status).toBe(403);
    // A bad token is not rescued by a good cookie.
    const bad = await get('/auth/me', {
      cookie: session.cookie,
      headers: bearer('scp_abcd1234_' + 'A'.repeat(43)),
    });
    expect(bad.status).toBe(401);
    // A stale cookie does not break a good token.
    const stale = await get('/auth/me', { cookie: 'x'.repeat(43), headers: bearer(created.token) });
    expect(stale.status).toBe(200);
  });
});

describe('the token routes', () => {
  it('create: 201 with the token once, no-store, and the list never shows it again', async () => {
    const { get, post, session, created } = await withToken();
    expect(created.token).toMatch(/^scp_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const second = await post('/tokens', { ...session, body: { name: 'second' } });
    expect(second.res.headers.get('cache-control')).toBe('no-store');

    const list = await get('/tokens', session);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      metadata: { currentPage: 0, totalCount: 2 },
      result: [{ name: 'ci', scopes: ['read:kpi'], prefix: created.prefix }, { name: 'second' }],
    });
    const text = JSON.stringify(list.body);
    for (const secret of [created.token, (second.body as Created).token]) {
      expect(text).not.toContain(secret.slice(13)); // the secret part
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/argon2|secretHash|secret_hash/);
  });

  it('rotate: a new token under the same name, the old one dead, the new secret shown once', async () => {
    const { get, post, session, created } = await withToken();
    const rotated = await post(`/tokens/${created.id}/rotate`, { ...session, body: {} });
    expect(rotated.status).toBe(200);
    const next = rotated.body as Created;
    expect(next).toMatchObject({ name: 'ci', scopes: ['read:kpi'] });
    expect(next.id).not.toBe(created.id);
    expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(401);
    expect((await get('/auth/me', { headers: bearer(next.token) })).status).toBe(200);
    expect(JSON.stringify((await get('/tokens', session)).body)).not.toContain(
      next.token.slice(13),
    );
  });

  it('revoke: 204, again 204, and 404 for an unknown id', async () => {
    const { call, session, created } = await withToken();
    expect((await call('DELETE', `/tokens/${created.id}`, session)).status).toBe(204);
    expect((await call('DELETE', `/tokens/${created.id}`, session)).status).toBe(204);
    expect((await call('DELETE', `/tokens/${UNKNOWN_ID}`, session)).status).toBe(404);
  });

  it('one user cannot list, revoke or rotate another’s token, and is told the same as for an unknown id', async () => {
    const { get, post, call, signedIn, created } = await withToken();
    const bob = await signedIn('bobby');

    expect(JSON.stringify((await get('/tokens', bob)).body)).not.toContain(created.prefix);
    const revoke = await call('DELETE', `/tokens/${created.id}`, bob);
    const revokeUnknown = await call('DELETE', `/tokens/${UNKNOWN_ID}`, bob);
    const rotate = await post(`/tokens/${created.id}/rotate`, { ...bob, body: {} });
    const rotateUnknown = await post(`/tokens/${UNKNOWN_ID}/rotate`, { ...bob, body: {} });
    for (const reply of [revoke, revokeUnknown, rotate, rotateUnknown]) {
      expect(reply.status).toBe(404);
    }
    const strip = (body: unknown) => {
      return { ...(body as Record<string, unknown>), requestId: undefined };
    };
    expect(strip(revoke.body)).toEqual(strip(revokeUnknown.body));
    expect(strip(rotate.body)).toEqual(strip(rotateUnknown.body));
    expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(200);
  });

  describe('denied requests', () => {
    const routes: [string, string, (id: string) => string, unknown][] = [
      ['GET', 'list', () => '/tokens', undefined],
      ['POST', 'create', () => '/tokens', { name: 'x' }],
      ['DELETE', 'revoke', (id) => `/tokens/${id}`, undefined],
      ['POST', 'rotate', (id) => `/tokens/${id}/rotate`, {}],
    ];

    it.each(routes)('%s (%s): 401 without credentials', async (method, _name, path, body) => {
      const { call } = await app.start();
      const reply = await call(method, path(UNKNOWN_ID), { body });
      expect(reply.status).toBe(401);
    });

    it.each(routes)('%s (%s): 403 without the permission', async (method, _name, path, body) => {
      const { call, signedIn } = await app.start({
        permissions: ['core.identity.session.manage', 'core.identity.me.read'],
      });
      const session = await signedIn('alice');
      expect((await call(method, path(UNKNOWN_ID), { ...session, body })).status).toBe(403);
    });

    it.each(routes)(
      '%s (%s): 403 for a caller who uses a token',
      async (method, _name, path, body) => {
        const { call, created } = await withToken();
        const reply = await call(method, path(created.id), {
          headers: bearer(created.token),
          body,
        });
        expect(reply.status).toBe(403);
      },
    );

    it('a token cannot mint, list or remove tokens, so a stolen one stays what it was', async () => {
      const { get, kernel, created } = await withToken();
      expect((await get('/tokens', { headers: bearer(created.token) })).status).toBe(403);
      const { rows } = await kernel.pool.query('select count(*)::int as n from identity_token');
      expect(rows).toEqual([{ n: 1 }]);
    });
  });

  describe('bad input is 422, never 500', () => {
    it.each([
      ['no name', {}],
      ['an empty name', { name: '' }],
      ['an unknown scope shape', { name: 'a', scopes: ['superuser'] }],
      ['a wildcard scope', { name: 'a', scopes: ['read:*'] }],
      ['an expiry in the past', { name: 'a', expiresAt: '2001-01-01T00:00:00Z' }],
      ['an expiry that is not a date', { name: 'a', expiresAt: 'tomorrow' }],
      ['an extra field', { name: 'a', userId: 'someone-else' }],
      ['a name of the wrong type', { name: 7 }],
    ])('create: %s', async (_name, body) => {
      const { post, session } = await withToken();
      const reply = await post('/tokens', { ...session, body });
      expect(reply.status).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    });

    it('create: 409 for a taken name', async () => {
      const { post, session } = await withToken();
      expect((await post('/tokens', { ...session, body: { name: 'ci' } })).status).toBe(409);
    });

    it('rotate: an expiry in the past, and an id that is not a UUID', async () => {
      const { post, session, created } = await withToken();
      expect(
        (await post(`/tokens/${created.id}/rotate`, { ...session, body: { expiresAt: 'soon' } }))
          .status,
      ).toBe(422);
      expect((await post('/tokens/not-a-uuid/rotate', { ...session, body: {} })).status).toBe(422);
    });

    it('refuses a body that is not JSON', async () => {
      const { post, session } = await withToken();
      const reply = await post('/tokens', {
        ...session,
        body: 'name=x',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect([415, 422]).toContain(reply.status);
    });
  });
});

describe('failed token attempts are rate limited', () => {
  const limits = { default: { capacity: 1000, refillPerSecond: 100 } };

  it('answers 429 with Retry-After after ten wrong tokens, and then no guess is answered, not even a right one', async () => {
    const { get, created } = await withToken({ rateLimits: limits });
    const wrong = bearer('scp_abcd1234_' + 'A'.repeat(43));
    for (let i = 0; i < 10; i++) {
      expect((await get('/auth/me', { headers: wrong })).status).toBe(401);
    }
    const blocked = await get('/auth/me', { headers: wrong });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.res.headers.get('retry-after'))).toBeGreaterThan(0);
    // The right token from the same address waits too: the bucket is checked before verifying.
    expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(429);
    // Another address is not affected, and an address without a token is not either.
    expect(
      (await get('/auth/me', { headers: bearer(created.token), peer: '198.51.100.9' })).status,
    ).toBe(200);
  });

  it('charges a bad token on a public route as well', async () => {
    const { post } = await withToken({ rateLimits: limits });
    const wrong = bearer('garbage');
    const body = { username: 'nobody', password: PASSWORD };
    for (let i = 0; i < 10; i++) await post('/auth/login', { headers: wrong, body });
    const blocked = await post('/auth/login', { headers: wrong, body });
    expect(blocked.status).toBe(429);
  });

  it('does not charge good tokens, or requests that carry none', async () => {
    const { get, created } = await withToken({ rateLimits: limits });
    for (let i = 0; i < 15; i++) {
      expect((await get('/auth/me', { headers: bearer(created.token) })).status).toBe(200);
    }
    for (let i = 0; i < 15; i++) expect((await get('/auth/me')).status).toBe(401);
  });
});

describe('what the log may hold', () => {
  it('never contains a token, its secret, its hash or a password, through a whole life of one', async () => {
    const started = await withToken();
    const { get, post, call, session, created, logText, kernel } = started;
    const secrets = [created.token, created.token.slice(13)];

    await get('/auth/me', { headers: bearer(created.token) });
    await get('/auth/me', { headers: { 'x-api-key': created.token } });
    const wrongToken = 'scp_abcd1234_' + 'B'.repeat(43);
    await get('/auth/me', { headers: bearer(wrongToken) });
    await get('/tokens', { headers: bearer(created.token) }); // refused: a token may not list tokens
    const rotated = (await post(`/tokens/${created.id}/rotate`, { ...session, body: {} }))
      .body as Created;
    secrets.push(rotated.token, rotated.token.slice(13), wrongToken, wrongToken.slice(13));
    await get('/auth/me', { headers: bearer(created.token) }); // the old one, now dead
    await call('DELETE', `/tokens/${rotated.id}`, session);
    await post('/tokens', { ...session, body: { name: 'bad scope', scopes: ['nope'] } });

    const { rows } = await kernel.pool.query<{ secret_hash: string }>(
      'select secret_hash from identity_token',
    );
    const log = logText();
    expect(log.length).toBeGreaterThan(0);
    for (const secret of [...secrets, ...rows.map((r) => r.secret_hash), PASSWORD]) {
      expect(log).not.toContain(secret);
    }
    // And no stored event repeats one either.
    const events = JSON.stringify(
      (await kernel.pool.query('select payload from kernel_outbox')).rows,
    );
    for (const secret of secrets) expect(events).not.toContain(secret);
  });
});
