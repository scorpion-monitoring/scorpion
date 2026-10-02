// The first-run token through the whole pipeline, on real Postgres: redeeming it over HTTP, its
// refusals, and the one place the secret may appear.
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const admin = { username: 'root', email: 'root@example.org', password: PASSWORD };

async function fresh(options: Parameters<typeof app.start>[0] = {}) {
  const shown: string[] = [];
  const started = await app.start({ announce: (text) => shown.push(text), ...options });
  // Start-up already showed a token on this empty database.
  const token = /sfr_[A-Za-z0-9_-]{43}/.exec(shown.join('\n'))?.[0];
  expect(token).toBeDefined();
  return { ...started, shown, token: token! };
}

describe('POST /bootstrap/first-admin', () => {
  it('creates the first administrator with the printed token, who can then sign in', async () => {
    const { post, token } = await fresh();
    const reply = await post('/bootstrap/first-admin', { body: { token, ...admin } });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ user: { username: 'root', status: 'active' } });
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(reply.body)).not.toContain(PASSWORD);
    expect(reply.setCookie).toBeUndefined(); // it does not sign anyone in

    const login = await post('/auth/login', {
      body: { username: 'root', password: PASSWORD },
    });
    expect(login.status).toBe(200);
  });

  it('works once: the same token again is a 401, and so is any token after an administrator exists', async () => {
    const { post, token, kernel } = await fresh();
    expect((await post('/bootstrap/first-admin', { body: { token, ...admin } })).status).toBe(201);
    const again = await post('/bootstrap/first-admin', {
      body: { token, ...admin, username: 'other', email: 'other@example.org' },
    });
    expect(again.status).toBe(401);
    expect(again.res.headers.get('content-type')).toContain('application/problem+json');
    const { rows } = await kernel.pool.query('select 1 from identity_user');
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['no token', undefined],
    ['an unknown token', `sfr_${'A'.repeat(43)}`],
    ['an access token', `scp_abcd1234_${'A'.repeat(43)}`],
    ['text', 'let me in'],
  ])('answers 401 (or 422) and creates nothing for %s', async (_name, token) => {
    const { post, kernel } = await fresh();
    const reply = await post('/bootstrap/first-admin', { body: { ...admin, token } });
    expect(reply.status).toBe(token === undefined ? 422 : 401);
    expect((await kernel.pool.query('select 1 from identity_user')).rows).toEqual([]);
  });

  it('answers 401 after the expiry', async () => {
    const { post, token, kernel } = await fresh();
    await kernel.pool.query(
      `update identity_first_run_token set expires_at = now() - interval '1 second'`,
    );
    expect((await post('/bootstrap/first-admin', { body: { token, ...admin } })).status).toBe(401);
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['a bad address', { email: 'nope' }],
    ['an upper-case username', { username: 'Root' }],
    ['an extra field', { role: 'admin' }],
  ])('answers 422 for %s and leaves the token usable', async (_name, change) => {
    const { post, token } = await fresh();
    const bad = await post('/bootstrap/first-admin', { body: { token, ...admin, ...change } });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).not.toContain(PASSWORD);
    expect((await post('/bootstrap/first-admin', { body: { token, ...admin } })).status).toBe(201);
  });

  it('answers 409 for a taken name and leaves the token usable', async () => {
    const { post, token, identity } = await fresh();
    await identity.users.createUser({
      username: 'root',
      email: 'someone@example.org',
      auth: { provider: 'local', password: PASSWORD },
    }); // pending, so still no administrator
    expect((await post('/bootstrap/first-admin', { body: { token, ...admin } })).status).toBe(409);
    const retry = await post('/bootstrap/first-admin', {
      body: { token, ...admin, username: 'root2' },
    });
    expect(retry.status).toBe(201);
  });

  it('is rate limited like login (strict), and needs no credentials', async () => {
    const { post } = await fresh({
      rateLimits: { default: { capacity: 1000, refillPerSecond: 100 } },
    });
    const body = { token: `sfr_${'A'.repeat(43)}`, ...admin };
    for (let i = 0; i < 10; i++) {
      expect((await post('/bootstrap/first-admin', { body })).status).toBe(401);
    }
    const blocked = await post('/bootstrap/first-admin', { body });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('where the first-run token may appear', () => {
  it('only in what the announcer was given, once: not in the log, a response or the database', async () => {
    const { post, token, shown, logText, kernel } = await fresh();
    expect(shown.join('').split(token)).toHaveLength(2); // shown exactly once

    const bad = await post('/bootstrap/first-admin', { body: { token, ...admin, password: 'x' } });
    const good = await post('/bootstrap/first-admin', { body: { token, ...admin } });
    const used = await post('/bootstrap/first-admin', { body: { token, ...admin } });
    for (const reply of [bad, good, used]) expect(JSON.stringify(reply.body)).not.toContain(token);

    for (const secret of [token, token.slice(4)]) expect(logText()).not.toContain(secret);
    const stored = JSON.stringify(
      (await kernel.pool.query('select * from identity_first_run_token')).rows,
    );
    expect(stored).not.toContain(token.slice(4));
    const events = JSON.stringify(
      (await kernel.pool.query('select payload from kernel_outbox')).rows,
    );
    expect(events).not.toContain(token.slice(4));
    expect(shown.join('')).not.toContain(PASSWORD);
  });
});
