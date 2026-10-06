// The routes of core.identity through the whole pipeline, on real Postgres.
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const registration = { username: 'alice', email: 'alice@example.org', password: PASSWORD };
const UNKNOWN_ID = '019a0000-0000-7000-8000-000000000000';

describe('POST /auth/register', () => {
  it('creates a pending account and answers 202 { accepted: true } without a cookie, an id or any secret', async () => {
    const { post, logText, identity } = await app.start();
    const reply = await post('/auth/register', { body: registration });
    expect(reply.status).toBe(202);
    expect(reply.body).toEqual({ accepted: true });
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(reply.setCookie).toBeUndefined();
    expect(await identity.users.findByUsername('alice')).toMatchObject({
      status: 'pending',
      emailVerified: false,
    });
    expect(JSON.stringify(reply.body)).not.toContain(PASSWORD);
    expect(logText()).not.toContain(PASSWORD);
  });

  it('answers 409 problem+json for a taken username, and the same 202 for a taken email address', async () => {
    const { post, identity } = await app.start();
    await post('/auth/register', { body: registration });
    const sameName = await post('/auth/register', {
      body: { ...registration, email: 'other@example.org' },
    });
    expect(sameName.status).toBe(409);
    expect(sameName.res.headers.get('content-type')).toContain('application/problem+json');
    const sameAddress = await post('/auth/register', {
      body: { ...registration, username: 'carol' },
    });
    expect(sameAddress.status).toBe(202);
    expect(sameAddress.body).toEqual({ accepted: true });
    expect(await identity.users.findByUsername('carol')).toBeUndefined();
  });

  it('accepts the language of the mails in the body, a well-formed tag that is not shipped is fine, a malformed one is a 422', async () => {
    const { post, mail } = await app.start();
    expect((await post('/auth/register', { body: { ...registration, locale: 'de' } })).status).toBe(
      202,
    );
    expect(
      (
        await post('/auth/register', {
          body: { ...registration, username: 'bob', email: 'bob@example.org', locale: 'fr' },
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await post('/auth/register', {
          body: {
            ...registration,
            username: 'eve',
            email: 'eve@example.org',
            locale: 'not a tag!',
          },
        })
      ).status,
    ).toBe(422);
    expect((await mail.of('identity.welcome')).map((m) => [m.to, m.locale])).toEqual([
      ['alice@example.org', 'de'],
      ['bob@example.org', 'en'],
    ]);
  });

  it.each([
    ['an empty body', {}],
    ['a short password', { ...registration, password: 'short' }],
    ['a long password', { ...registration, password: 'x'.repeat(256) }],
    ['an upper-case username', { ...registration, username: 'Alice' }],
    ['an extra field', { ...registration, status: 'active' }],
    ['a number for the username', { ...registration, username: 7 }],
  ])('answers 422 for %s, naming the field and never repeating the password', async (_n, body) => {
    const { post, logText } = await app.start();
    const reply = await post('/auth/register', { body });
    expect(reply.status).toBe(422);
    expect(JSON.stringify(reply.body)).not.toContain(PASSWORD);
    expect(logText()).not.toContain(PASSWORD);
  });

  it('answers 4xx, never 500, for a body that is not JSON or not sent as JSON', async () => {
    const { post, kernel } = await app.start();
    const broken = await post('/auth/register', {
      body: '{"username":',
      headers: { 'content-type': 'application/json' },
    });
    expect(broken.status).toBeGreaterThanOrEqual(400);
    expect(broken.status).toBeLessThan(500);
    // A cross-site HTML form can send these two types, and neither is accepted as a registration.
    for (const type of [
      'application/x-www-form-urlencoded',
      'text/plain',
      'multipart/form-data; boundary=x',
    ]) {
      const form = await post('/auth/register', {
        body: `username=alice&email=alice%40example.org&password=${PASSWORD}`,
        headers: { 'content-type': type },
      });
      // Refused as an unsupported media type (or as invalid input), as problem+json, and no account is made.
      expect([415, 422]).toContain(form.status);
      expect(form.res.headers.get('content-type')).toContain('application/problem+json');
    }
    expect((await kernel.pool.query('select 1 from identity_user')).rows).toEqual([]);
  });

  it('uses the strict rate-limit bucket', async () => {
    const { post } = await app.start({
      rateLimits: { strict: { capacity: 2, refillPerSecond: 0.001 } },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (
          await post('/auth/register', {
            body: { ...registration, username: `user${i}`, email: `u${i}@example.org` },
          })
        ).status,
      );
    }
    expect(statuses).toEqual([202, 202, 429, 429]);
    // The default bucket of other routes is a different one.
    expect(
      (await post('/auth/register', { body: registration, peer: '198.51.100.9' })).status,
    ).toBe(202);
  });
});

describe('POST /auth/login', () => {
  it('sets the session cookie with the right attributes and returns the user and a CSRF token', async () => {
    const { signedIn, post } = await app.start();
    await signedIn('alice');
    const reply = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });

    expect(reply.status).toBe(200);
    const { cookie, setCookie } = reply;
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setCookie).toMatch(/^__Host-session=/);
    expect(setCookie).toMatch(/;\s*Path=\/(;|$)/);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Domain=/i);
    expect(setCookie).toMatch(/Expires=/i);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(reply.body).toEqual({
      user: expect.objectContaining({ username: 'alice', status: 'active' }) as unknown,
      csrfToken: expect.any(String) as unknown,
    });
    expect(JSON.stringify(reply.body)).not.toContain(cookie!);
  });

  it('gives an unknown user and a wrong password the same status and body', async () => {
    const { signedIn, post } = await app.start();
    await signedIn('alice');
    const unknown = await post('/auth/login', { body: { username: 'nobody', password: PASSWORD } });
    const wrong = await post('/auth/login', {
      body: { username: 'alice', password: 'wrong password' },
    });
    const strip = (body: unknown) => ({ ...(body as object), requestId: undefined });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(strip(unknown.body)).toEqual(strip(wrong.body));
    expect(unknown.setCookie).toBeUndefined();
    expect(wrong.setCookie).toBeUndefined();
  });

  it('tells a pending account to wait (403) and a rejected one nothing but 401', async () => {
    const { post, identity, kernel } = await app.start();
    await post('/auth/register', { body: registration });
    const pending = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    expect(pending.status).toBe(403);
    expect(pending.setCookie).toBeUndefined();

    await kernel.pool.query(`update identity_user set status = 'rejected', deleted_at = now()`);
    const rejected = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    expect(rejected.status).toBe(401);
    expect(identity).toBeDefined();
  });

  it('works with a stale or revoked cookie in the request (it must not block signing in again)', async () => {
    const { signedIn, post } = await app.start();
    const first = await signedIn('alice');
    await post('/auth/logout', { cookie: first.cookie, csrf: first.csrf });
    const again = await post('/auth/login', {
      body: { username: 'alice', password: PASSWORD },
      cookie: first.cookie,
    });
    expect(again.status).toBe(200);
    expect(again.cookie).toBeTruthy();
    expect(again.cookie).not.toBe(first.cookie);
  });

  it('ends the session of the cookie it was called with, and starts a new one [ASVS-7.2.4]', async () => {
    const { signedIn, post, get } = await app.start({ sessionCacheTtlMs: 60_000 });
    const first = await signedIn('alice');
    const again = await post('/auth/login', {
      body: { username: 'alice', password: PASSWORD },
      cookie: first.cookie,
      csrf: first.csrf,
    });
    expect((await get('/auth/me', { cookie: first.cookie })).status).toBe(401);
    expect((await get('/auth/me', { cookie: again.cookie })).status).toBe(200);
  });

  it.each([
    ['an empty body', {}],
    ['no password', { username: 'alice' }],
    ['an array', []],
    ['a very long username', { username: 'a'.repeat(5000), password: PASSWORD }],
  ])('answers 422 for %s', async (_n, body) => {
    const { post } = await app.start();
    expect((await post('/auth/login', { body })).status).toBe(422);
  });

  it('uses the strict rate-limit bucket: failed guesses run out', async () => {
    const { post, signedIn } = await app.start({
      rateLimits: { strict: { capacity: 3, refillPerSecond: 0.001 } },
    });
    await signedIn('alice'); // uses one
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await post('/auth/login', { body: { username: 'alice', password: `guess number ${i}` } }))
          .status,
      );
    }
    expect(statuses).toEqual([401, 401, 429, 429]);
  });
});

describe('GET /auth/me', () => {
  it('returns the caller, the roles core.authz holds for them, and the CSRF token of the session', async () => {
    const { signedIn, get } = await app.start();
    const { cookie, csrf, user } = await signedIn('alice');
    const reply = await get('/auth/me', { cookie });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      user: expect.objectContaining({ id: user.id, username: 'alice' }) as unknown,
      roles: ['user'],
      csrfToken: csrf,
    });
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
  });

  it('shows every role the account holds, and refuses an account that holds none', async () => {
    const { signedIn, get } = await app.start();
    const both = await signedIn('both', { roles: ['user', 'reviewer'] });
    expect((await get('/auth/me', { cookie: both.cookie })).body).toMatchObject({
      roles: ['reviewer', 'user'],
    });
    // No role, no permission: a signed-in account without roles is a 403, not an empty answer.
    const none = await signedIn('norole', { roles: [] });
    expect((await get('/auth/me', { cookie: none.cookie })).status).toBe(403);
  });

  it('needs no CSRF token (it reads)', async () => {
    const { signedIn, get } = await app.start();
    const { cookie } = await signedIn('alice');
    expect((await get('/auth/me', { cookie, csrf: 'wrong' })).status).toBe(200);
  });

  it('renews the cookie when the session’s expiry slides', async () => {
    const { signedIn, get, kernel } = await app.start({ sessionCacheTtlMs: 0 });
    const { cookie } = await signedIn('alice');
    expect((await get('/auth/me', { cookie })).setCookie).toBeUndefined(); // just used: nothing to renew
    await kernel.pool.query(
      `update identity_session set last_seen_at = now() - interval '2 minutes'`,
    );
    const reply = await get('/auth/me', { cookie });
    expect(reply.cookie).toBe(cookie);
    expect(reply.setCookie).toMatch(/HttpOnly/i);
  });
});

describe('CSRF protection of cookie-authenticated writes (ADR 0007)', () => {
  it.each([
    ['no token', undefined],
    ['an empty token', ''],
    ['a made-up token', 'A'.repeat(43)],
  ])('refuses a write with %s, and the session survives', async (_n, csrf) => {
    const { signedIn, post, get } = await app.start();
    const { cookie } = await signedIn('alice');
    for (const path of ['/auth/logout', '/auth/logout-all']) {
      const reply = await post(path, { cookie, csrf });
      expect(reply.status).toBe(401);
      expect(reply.body).toMatchObject({ detail: expect.stringContaining('CSRF') as unknown });
    }
    expect((await get('/auth/me', { cookie })).status).toBe(200);
  });

  it('refuses the token of another session', async () => {
    const { signedIn, post } = await app.start();
    const alice = await signedIn('alice');
    const bob = await signedIn('bobby');
    expect((await post('/auth/logout', { cookie: alice.cookie, csrf: bob.csrf })).status).toBe(401);
  });

  it('refuses a token sent as the session id', async () => {
    const { signedIn, post } = await app.start();
    const { cookie } = await signedIn('alice');
    expect((await post('/auth/logout', { cookie, csrf: cookie })).status).toBe(401);
  });
});

describe('POST /auth/logout and /auth/logout-all', () => {
  it('logout answers 204 and clears the cookie', async () => {
    const { signedIn, post } = await app.start();
    const { cookie, csrf } = await signedIn('alice');
    const reply = await post('/auth/logout', { cookie, csrf });
    expect(reply.status).toBe(204);
    expect(reply.cookie).toBe('');
    expect(reply.setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(reply.setCookie).toMatch(/Secure/i);
  });

  it('logout-all counts the sessions it ended', async () => {
    const { signedIn, post } = await app.start();
    const { cookie, csrf } = await signedIn('alice');
    await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    const reply = await post('/auth/logout-all', { cookie, csrf });
    expect(reply.body).toEqual({ revoked: 2 });
    expect(reply.cookie).toBe('');
  });
});

describe('every protected route refuses the caller who may not use it', () => {
  const routes: [string, string, string][] = [
    ['POST', '/auth/logout', 'core.identity.session.manage'],
    ['POST', '/auth/logout-all', 'core.identity.session.manage'],
    ['GET', '/auth/me', 'core.identity.me.read'],
    ['GET', '/users/pending', 'core.identity.user.list-pending'],
    ['POST', `/users/${UNKNOWN_ID}/approve`, 'core.identity.user.approve'],
    ['POST', `/users/${UNKNOWN_ID}/reject`, 'core.identity.user.reject'],
  ];

  it.each(routes)(
    '%s %s: anonymous → 401, signed in without %s → 403',
    async (method, path, permission) => {
      const anonymous = await app.start();
      const reply = await anonymous.call(method, path);
      expect(reply.status).toBe(401);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');

      const denied = await app.start({ permissions: [] });
      const { cookie, csrf } = await denied.signedIn('alice');
      const forbidden = await denied.call(method, path, { cookie, csrf });
      expect(forbidden.status).toBe(403);

      // The permission named by the route is the one that lets the call through.
      const allowed = await app.start({ permissions: [permission] });
      const session = await allowed.signedIn('alice');
      const through = await allowed.call(method, path, {
        cookie: session.cookie,
        csrf: session.csrf,
      });
      expect([401, 403]).not.toContain(through.status);
    },
  );

  it('a bad cookie is a 401 on a protected route, not an anonymous pass', async () => {
    const { get } = await app.start();
    expect((await get('/auth/me', { cookie: 'A'.repeat(43) })).status).toBe(401);
  });
});

describe('approval over HTTP', () => {
  it('registers, is approved by someone else, then can sign in and out (the whole journey)', async () => {
    const { post, get, signedIn, identity, mail } = await app.start();
    const admin = await signedIn('admin', { roles: ['admin'] });
    const registered = await post('/auth/register', { body: registration });
    expect(registered.status).toBe(202);
    const { id } = (await identity.users.findByUsername('alice'))!;
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: PASSWORD } })).status,
    ).toBe(403);

    const pending = await get('/users/pending', { cookie: admin.cookie });
    expect(pending.body).toEqual({
      metadata: { currentPage: 0, pageSize: 20, totalCount: 1, totalPages: 1 },
      result: [expect.objectContaining({ id, username: 'alice', email: 'alice@example.org' })],
    });

    const approved = await post(`/users/${id}/approve`, { cookie: admin.cookie, csrf: admin.csrf });
    expect(approved.body).toEqual({ id, status: 'active' });
    // The administrator was told about the request, and the person about the decision.
    expect((await mail.all()).map((m) => [m.template, m.to]).sort()).toEqual(
      [
        ['identity.email-verification', 'alice@example.org'],
        ['identity.welcome', 'alice@example.org'],
        ['identity.registration-request', 'admin@example.org'],
        ['identity.approved', 'alice@example.org'],
      ].sort(),
    );

    const login = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    expect(login.status).toBe(200);
    const me = await get('/auth/me', { cookie: login.cookie });
    expect(me.body).toMatchObject({ user: { username: 'alice', status: 'active' } });
    const out = await post('/auth/logout', {
      cookie: login.cookie,
      csrf: (login.body as { csrfToken: string }).csrfToken,
    });
    expect(out.status).toBe(204);
    expect((await get('/auth/me', { cookie: login.cookie })).status).toBe(401);
  });

  it('rejects an account, which then cannot sign in', async () => {
    const { post, signedIn, identity, mail } = await app.start();
    const admin = await signedIn('admin', { roles: ['admin'] });
    await post('/auth/register', { body: registration });
    const { id } = (await identity.users.findByUsername('alice'))!;
    const rejected = await post(`/users/${id}/reject`, { cookie: admin.cookie, csrf: admin.csrf });
    expect(rejected.body).toEqual({ id, status: 'rejected' });
    expect(await mail.of('identity.rejected')).toMatchObject([{ to: 'alice@example.org' }]);
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: PASSWORD } })).status,
    ).toBe(401);
  });

  it('refuses self-approval with 403 for an active user who holds the permission', async () => {
    const { post, signedIn } = await app.start();
    const me = await signedIn('alice');
    for (const verb of ['approve', 'reject']) {
      const reply = await post(`/users/${me.user.id}/${verb}`, {
        cookie: me.cookie,
        csrf: me.csrf,
      });
      expect(reply.status).toBe(403);
    }
  });

  it('needs the CSRF token for approve and reject', async () => {
    const { post, signedIn } = await app.start();
    const admin = await signedIn('admin', { roles: ['admin'] });
    expect((await post(`/users/${UNKNOWN_ID}/approve`, { cookie: admin.cookie })).status).toBe(401);
  });

  it.each([
    ['approve', 'not-a-uuid'],
    ['reject', '123'],
    ['approve', "';drop table identity_user;--"],
  ])('answers 422 for %s with the id %j', async (verb, id) => {
    const { post, signedIn } = await app.start();
    const admin = await signedIn('admin', { roles: ['admin'] });
    const reply = await post(`/users/${encodeURIComponent(id)}/${verb}`, {
      cookie: admin.cookie,
      csrf: admin.csrf,
    });
    expect(reply.status).toBe(422);
  });

  it('answers 404 for an unknown user and 409 for one that is not pending', async () => {
    const { post, signedIn } = await app.start();
    const admin = await signedIn('admin', { roles: ['admin'] });
    const other = await signedIn('bobby');
    expect(
      (await post(`/users/${UNKNOWN_ID}/approve`, { cookie: admin.cookie, csrf: admin.csrf }))
        .status,
    ).toBe(404);
    expect(
      (await post(`/users/${other.user.id}/approve`, { cookie: admin.cookie, csrf: admin.csrf }))
        .status,
    ).toBe(409);
  });

  it('pages the pending list, and refuses a bad page with 422', async () => {
    const { post, get, signedIn } = await app.start();
    const admin = await signedIn('admin', { roles: ['admin'] });
    for (const n of ['one', 'two', 'three']) {
      await post('/auth/register', {
        body: { username: `user-${n}`, email: `${n}@example.org`, password: PASSWORD },
      });
    }
    const page = await get('/users/pending?page=1&pageSize=2', { cookie: admin.cookie });
    expect(page.body).toMatchObject({
      metadata: { currentPage: 1, pageSize: 2, totalCount: 3, totalPages: 2 },
      result: [expect.objectContaining({ username: 'user-three' })],
    });
    expect((await get('/users/pending?page=-1', { cookie: admin.cookie })).status).toBe(422);
  });
});

describe('secrets in logs and responses', () => {
  it('writes no password, session id, CSRF token or cookie to the log through register, login and logout', async () => {
    const { post, get, logText, kernel, lines } = await app.start();
    await post('/auth/register', { body: registration });
    await kernel.pool.query(`update identity_user set status = 'active'`);
    const wrong = await post('/auth/login', {
      body: { username: 'alice', password: 'wrong password 123' },
    });
    const login = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    const { csrfToken } = login.body as { csrfToken: string };
    await get('/auth/me', { cookie: login.cookie });
    await post('/auth/logout', { cookie: login.cookie, csrf: csrfToken }); // ok
    await post('/auth/logout', { cookie: login.cookie, csrf: csrfToken }); // the replay, a 401
    await post('/auth/login', { body: { username: 'alice' } }); // a 422
    await post('/auth/register', { body: { ...registration, email: 'not an email' } }); // a 422

    expect(wrong.status).toBe(401);
    expect(lines.length).toBeGreaterThan(5); // something was logged, so the absence below means something
    const text = logText();
    for (const secret of [
      PASSWORD,
      'wrong password 123',
      login.cookie!,
      csrfToken,
      login.setCookie!,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/__Host-session=[A-Za-z0-9_-]{10}/);
    expect(text).not.toMatch(/set-cookie/i);
    expect(text).not.toMatch(/x-csrf-token/i);
    expect(text).not.toMatch(/\$argon2/);
    // The stored hash of the session is not logged either.
    const { rows } = await kernel.pool.query<{ secret_hash: string }>(
      'select secret_hash from identity_session',
    );
    for (const row of rows) expect(text).not.toContain(row.secret_hash);
  });

  it('puts no hash, secret or internal flag in any response', async () => {
    const { post, get, signedIn } = await app.start();
    const admin = await signedIn('admin', { roles: ['admin'] });
    await post('/auth/register', { body: registration });
    const bodies = [
      (await get('/auth/me', { cookie: admin.cookie })).body,
      (await get('/users/pending', { cookie: admin.cookie })).body,
      (await post('/auth/login', { body: { username: 'admin', password: PASSWORD } })).body,
    ];
    const text = JSON.stringify(bodies);
    expect(text).not.toMatch(/argon2|password|secret|hash|bootstrap/i);
  });
});
