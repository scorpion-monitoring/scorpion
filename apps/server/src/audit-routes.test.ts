// core.audit through the whole pipeline on real Postgres and the real authoriser: what a route with
// `audit` leaves in the trail (including what was turned away), what the trail never holds, the viewer,
// the CSV export and the kernel's system routes. The denied cases of every route are also in
// defect-01.privilege-escalation.test.ts.
import { randomUUID } from 'node:crypto';
import { createRoute, z } from '@scorpion/contracts';
import { defineModule, KernelStartupError } from '@scorpion/kernel';
import { makeAuditEvent, tablesContaining } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp, PASSWORD } from './testing/identity-app.ts';

const app = useIdentityApp();

const session = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
type Envelope = {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: Record<string, unknown>[];
};

/** A module with a route that opts in to the body, and one that does not: the pipeline's contract in isolation. */
const echo = createRoute({
  method: 'post',
  path: '/fixture/echo/{id}',
  permission: 'fix.audit.use',
  audit: { body: true, redact: ['iban'] },
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'ok' } },
});
const quiet = createRoute({
  method: 'post',
  path: '/fixture/quiet',
  permission: 'fix.audit.use',
  audit: true,
  responses: { 200: { description: 'ok' } },
});
const unaudited = createRoute({
  method: 'post',
  path: '/fixture/unaudited',
  permission: 'fix.audit.use',
  responses: { 200: { description: 'ok' } },
});
const fixture = {
  id: 'fix.audit',
  manifest: defineModule({
    id: 'fix.audit',
    version: '1.0.0',
    permissions: { 'fix.audit.use': { description: 'use the fixture routes' } },
    routes: (r) => {
      r.internal(echo, ((c: { json: (b: unknown) => Response }) => c.json({ ok: true })) as never);
      r.internal(quiet, ((c: { json: (b: unknown) => Response }) => c.json({ ok: true })) as never);
      r.internal(unaudited, ((c: { json: (b: unknown) => Response }) =>
        c.json({ ok: true })) as never);
    },
  }),
};

const start = (options: Parameters<typeof app.start>[0] = {}) =>
  app.start({ tokenCacheTtlMs: 0, ...options });
type Started = Awaited<ReturnType<typeof start>>;
const withFixture = () => start({ extraModules: [fixture], permissions: ['fix.audit.use'] });

const dispatch = async (s: Started) => {
  while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
    // run until the outbox is quiet
  }
};
const trail = async (s: Started, where = 'true', params: unknown[] = []) =>
  (
    await s.kernel.pool.query(
      `select * from audit_event where ${where} order by occurred_at, id`,
      params,
    )
  ).rows as Record<string, unknown>[];

describe('a route with `audit` leaves an entry, also when it turned the caller away', () => {
  it('records a denied admin call as `denied`, with the caller and the route template', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const victim = randomUUID();
    const reply = await s.call('POST', `/users/${victim}/approve`, {
      ...session(plain),
      body: { role: 'admin' },
    });
    expect(reply.status).toBe(403);
    const [row] = await trail(s, "path = $1 and outcome = 'denied'", [
      '/api/internal/users/{id}/approve',
    ]);
    expect(row).toMatchObject({
      source: 'api',
      action: 'api.POST',
      outcome: 'denied',
      status: 403,
      actor_kind: 'user',
      user_id: plain.user.id,
      method: 'POST',
      subject_type: 'users',
      subject_id: victim,
      ip: '203.0.113.7',
    });
    expect(row!.request_id).toBe(reply.res.headers.get('x-request-id'));
    // Not the concrete URL, and the route opted in to the body, which was stored (the role, no secret).
    expect(row!.path).not.toContain(victim);
    expect(row!.body).toEqual({ role: 'admin' });
  });

  it('records an anonymous call (401) with the anonymous actor, and a bad token (401) the same way', async () => {
    const s = await start();
    const victim = randomUUID();
    const anonymous = await s.call('POST', `/users/${victim}/reject`);
    const badToken = await s.call('POST', `/users/${victim}/reject`, {
      headers: bearer('scp_not-a-real-token'),
    });
    expect([anonymous.status, badToken.status]).toEqual([401, 401]);
    const rows = await trail(s, 'path = $1', ['/api/internal/users/{id}/reject']);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        outcome: 'denied',
        status: 401,
        actor_kind: 'anonymous',
        user_id: null,
      });
    }
    expect(JSON.stringify(rows)).not.toContain('scp_not-a-real-token');
  });

  it('records an invalid request (422) as an error', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const reply = await s.call('POST', `/users/${randomUUID()}/roles`, {
      ...session(root),
      body: { roles: 'admin' },
    });
    expect(reply.status).toBe(422);
    const [row] = await trail(s, 'path = $1', ['/api/internal/users/{id}/roles']);
    expect(row).toMatchObject({ outcome: 'error', status: 422, user_id: root.user.id });
  });

  it('records the success, with the actor, once the response is formed', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const alice = await s.signedIn('alice');
    const target = await s.signedIn('target');
    await s.call('POST', `/users/${target.user.id}/roles`, {
      ...session(root),
      body: { role: 'reviewer' },
    });
    const rows = await trail(s, "path = $1 and outcome = 'ok'", ['/api/internal/users/{id}/roles']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 200,
      user_id: root.user.id,
      subject_id: target.user.id,
    });
    expect(alice).toBeDefined();
  });

  it('records a call made with a token as the token kind, with the token id and never the token', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const made = await s.post('/tokens', {
      ...session(root),
      body: { name: 'for-audit', scopes: ['core.identity.role.assign', 'core.authz.role.assign'] },
    });
    const { id, token } = made.body as { id: string; token: string };
    const target = await s.signedIn('target');
    const reply = await s.call('POST', `/users/${target.user.id}/roles`, {
      headers: bearer(token),
      body: { role: 'reviewer' },
    });
    expect(reply.status).toBe(200);
    const [row] = await trail(s, "actor_kind = 'token'");
    expect(row).toMatchObject({ user_id: root.user.id, token_id: id, outcome: 'ok' });
    expect(JSON.stringify(await trail(s))).not.toContain(token);
  });

  it('does not record a route without `audit`', async () => {
    const s = await withFixture();
    const u = await s.signedIn('someone');
    expect((await s.call('POST', '/fixture/unaudited', session(u))).status).toBe(200);
    expect(await trail(s, "path like '%unaudited%'")).toHaveLength(0);
    expect((await s.call('POST', '/fixture/quiet', session(u))).status).toBe(200);
    expect(await trail(s, "path like '%quiet%'")).toHaveLength(1);
  });

  it('takes the client address from the pipeline’s rule: a spoofed X-Forwarded-For is not stored', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    await s.call('POST', `/users/${randomUUID()}/approve`, {
      ...session(plain),
      body: {},
      peer: '198.51.100.20',
      headers: { 'x-forwarded-for': '6.6.6.6' },
    });
    const [row] = await trail(s, "outcome = 'denied'");
    expect(row!.ip).toBe('198.51.100.20');
  });
});

describe('what a request leaves of its body and query', () => {
  const body = {
    name: 'ok',
    password: 'hunter2-hunter2',
    iban: 'DE89 3704 0044 0532 0130 00',
    nested: { deep: [{ token: 'tok-12345', keep: 'kept' }] },
  };

  it('stores a body and query only for the route that opted in, redacted at any depth, with the route’s own keys', async () => {
    const s = await withFixture();
    const u = await s.signedIn('someone');
    const id = randomUUID();
    const reply = await s.call('POST', `/fixture/echo/${id}?page=2&apikey=k-9876&token=t-5432`, {
      ...session(u),
      body,
    });
    expect(reply.status).toBe(200);
    const [row] = await trail(s, "path like '%fixture/echo%'");
    expect(row!.body).toEqual({
      name: 'ok',
      password: '[redacted]',
      iban: '[redacted]',
      nested: { deep: [{ token: '[redacted]', keep: 'kept' }] },
    });
    expect(row!.query).toEqual({ page: '2', apikey: '[redacted]', token: '[redacted]' });
    const text = JSON.stringify(row);
    for (const secret of ['hunter2', 'DE89', 'tok-12345', 'k-9876', 't-5432'])
      expect(text).not.toContain(secret);
    expect(row).toMatchObject({ subject_type: 'fixture', subject_id: id, truncated: false });
  });

  it('stores neither body nor query for `audit: true`', async () => {
    const s = await withFixture();
    const u = await s.signedIn('someone');
    await s.call('POST', '/fixture/quiet?token=abc', { ...session(u), body });
    const [row] = await trail(s, "path like '%quiet%'");
    expect(row!.body).toBeNull();
    expect(row!.query).toBeNull();
    expect(JSON.stringify(row)).not.toContain('hunter2');
  });

  it('describes a body that is not JSON instead of copying it', async () => {
    const s = await withFixture();
    const u = await s.signedIn('someone');
    const text = 'password=hunter2&secret=abc';
    await s.call('POST', `/fixture/echo/${randomUUID()}`, {
      ...session(u),
      body: text,
      headers: { 'content-type': 'text/plain' },
    });
    await s.call('POST', `/fixture/echo/${randomUUID()}`, {
      ...session(u),
      body: '{"password": "hunter2", broken',
      headers: { 'content-type': 'application/json' },
    });
    const rows = await trail(s, "path like '%fixture/echo%'");
    expect(rows.map((r) => r.body)).toEqual([
      `[non-JSON body, ${Buffer.byteLength(text)} bytes]`,
      expect.stringMatching(/^\[non-JSON body, \d+ bytes\]$/),
    ]);
    expect(JSON.stringify(rows)).not.toContain('hunter2');
  });

  it('caps a large body at 8 KB and says so; a very large one is not read at all', async () => {
    const s = await withFixture();
    const u = await s.signedIn('someone');
    await s.call('POST', `/fixture/echo/${randomUUID()}`, {
      ...session(u),
      body: { password: 'top-secret', filler: 'x'.repeat(20_000) },
    });
    await s.call('POST', `/fixture/echo/${randomUUID()}`, {
      ...session(u),
      body: { filler: 'y'.repeat(400_000) },
    });
    const rows = await trail(s, "path like '%fixture/echo%'");
    expect(rows[0]).toMatchObject({ truncated: true, body: { _truncated: true } });
    expect(JSON.stringify(rows[0])).not.toContain('top-secret');
    expect(Buffer.byteLength(JSON.stringify(rows[0]!.body))).toBeLessThanOrEqual(8 * 1024);
    expect(rows[1]!.body).toMatch(/not stored/);
  });

  it('refuses to start a profile where a route under /auth/ asks to store its body', async () => {
    const login = createRoute({
      method: 'post',
      path: '/auth/fixture-login',
      permission: 'fix.auth.use',
      audit: { body: true },
      responses: { 200: { description: 'ok' } },
    });
    const bad = {
      id: 'fix.auth',
      manifest: defineModule({
        id: 'fix.auth',
        version: '1.0.0',
        permissions: { 'fix.auth.use': { description: 'x' } },
        routes: (r) => r.internal(login, (() => undefined) as never),
      }),
    };
    const error = await start({ extraModules: [bad] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KernelStartupError);
    expect((error as Error).message).toContain('Cannot register routes');
    expect((error as KernelStartupError).problems?.join(' ') ?? (error as Error).message).toContain(
      '/auth/',
    );
  });
});

describe('the trail never fails a request', () => {
  it('logs a write failure by request id and error code only, and the response is the same', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const target = await s.signedIn('target');
    await s.kernel.pool.query('drop table audit_event cascade');
    const reply = await s.call('POST', `/users/${target.user.id}/roles`, {
      ...session(root),
      body: { role: 'reviewer' },
    });
    expect(reply.status).toBe(200);
    expect((await s.get('/auth/me', session(root))).status).toBe(200);
    const line = s
      .logText()
      .split('\n')
      .find((l) => l.includes('audit entry could not be written'))!;
    expect(line).toBeDefined();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.requestId).toBe(reply.res.headers.get('x-request-id'));
    expect(parsed.code).toBe('42P01');
    expect(line).not.toContain('reviewer');
    expect(line).not.toContain(target.user.id);
  });
});

describe('no secret reaches the log, the trail, an event or a response', () => {
  it('[ASVS-V16.2.5] holds for a reset token, the SMTP password and the webhook secret', async () => {
    const s = await start({
      notificationSettings: {
        emailTransport: 'smtp',
        smtp: { host: '127.0.0.1', port: 1, tls: 'none', timeoutSeconds: 1, user: 'mailer' },
        webhook: { enabled: true, url: 'https://hooks.example.org/in' },
      },
    });
    const root = await s.signedIn('root', { roles: ['admin'] });
    const SMTP_PASSWORD = `smtp-pw-${randomUUID()}`;
    const WEBHOOK_SECRET = `hook-${randomUUID()}`;
    for (const [name, value] of [
      ['notifications.smtp.password', SMTP_PASSWORD],
      ['notifications.webhook.secret', WEBHOOK_SECRET],
    ] as const) {
      expect(
        (await s.call('PUT', `/secrets/${name}`, { ...session(root), body: { value } })).status,
      ).toBe(200);
    }
    await s.signedIn('alice', { email: 'alice@example.org' });
    await s.post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    const resetMail = (await s.mail.of('identity.password-reset'))[0]!;
    const RESET_TOKEN = decodeURIComponent(/#token=([A-Za-z0-9_%-]+)/.exec(resetMail.text)![1]!);
    expect(RESET_TOKEN.length).toBeGreaterThan(20);
    await s.post('/auth/password-reset/confirm', {
      body: { token: RESET_TOKEN, password: 'brand new passphrase' },
    });
    // The settings that name the relay were saved through the API too (their body is stored).
    await s.call('PUT', '/settings/core.notifications', {
      ...session(root),
      body: { version: 0, values: { defaultLocale: 'de' } },
    });
    await dispatch(s);

    const everything = [
      JSON.stringify(await trail(s)),
      s.logText(),
      JSON.stringify((await s.kernel.pool.query('select * from kernel_outbox')).rows),
    ].join('\n');
    for (const [what, secret] of [
      ['the reset token', RESET_TOKEN],
      ['the SMTP password', SMTP_PASSWORD],
      ['the webhook secret', WEBHOOK_SECRET],
    ] as const) {
      expect(everything, what).not.toContain(secret);
    }
    // And in no table of the audit module at all.
    for (const secret of [RESET_TOKEN, SMTP_PASSWORD, WEBHOOK_SECRET]) {
      expect(await tablesContaining(s.kernel.pool, secret)).not.toContain('audit_event');
      expect(await tablesContaining(s.kernel.pool, secret)).not.toContain('kernel_outbox');
    }
    // The secret changes themselves are on the record: by name.
    const named = await trail(s, "action = 'settings.secret.changed@1'");
    expect(named.map((r) => r.subject_id).sort()).toEqual([
      'notifications.smtp.password',
      'notifications.webhook.secret',
    ]);
    // ... and the PUT of the value is a request entry without a body.
    const puts = await trail(s, "path = '/api/internal/secrets/{name}'");
    expect(puts).toHaveLength(2);
    expect(puts.every((r) => r.body === null)).toBe(true);
  });
});

describe('the changes the plan names leave an entry with the right actor', () => {
  it('a role change, a setting change, an approval and a token revoke, by request', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const alice = await s.signedIn('alice');
    const pending = (await s.identity.accounts.register({
      username: 'pendy',
      email: 'pendy@example.org',
      password: PASSWORD,
    })) as unknown;
    expect(pending).toBeDefined();
    const pendy = (await s.identity.users.findByUsername('pendy'))!;

    expect(
      (
        await s.call('POST', `/users/${alice.user.id}/roles`, {
          ...session(root),
          body: { role: 'reviewer' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await s.call('PUT', '/settings/core.notifications', {
          ...session(root),
          body: { version: 0, values: { maxAttempts: 3 } },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await s.call('POST', `/users/${pendy.id}/approve`, {
          ...session(root),
          body: { role: 'user' },
        })
      ).status,
    ).toBe(200);
    const made = await s.post('/tokens', {
      ...session(alice),
      body: { name: 't', scopes: ['core.identity.me.read'] },
    });
    const { id: tokenId } = made.body as { id: string };
    expect((await s.call('DELETE', `/tokens/${tokenId}`, session(root))).status).toBe(204);
    await dispatch(s);

    const actors = async (action: string) =>
      (await trail(s, 'action = $1', [action])).map((r) => r.user_id);
    expect(await actors('authz.role.assigned@1')).toContain(root.user.id);
    expect(await actors('settings.changed@1')).toContain(root.user.id);
    expect(await actors('identity.user.approved@1')).toEqual([root.user.id]);
    expect(await actors('identity.token.revoked@1')).toEqual([root.user.id]);
    // The request entries name the same actor.
    const requests = await trail(s, "source = 'api' and outcome = 'ok' and user_id = $1", [
      root.user.id,
    ]);
    expect(requests.map((r) => r.path).sort()).toEqual(
      [
        '/api/internal/settings/{module}',
        '/api/internal/tokens/{id}',
        '/api/internal/users/{id}/approve',
        '/api/internal/users/{id}/roles',
      ].sort(),
    );
  });
});

describe('without core.audit', () => {
  it('serves the same routes and writes nothing: the profile starts and the audit option is inert', async () => {
    const s = await start({ audit: false });
    expect(s.audit).toBeUndefined();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const alice = await s.signedIn('alice');
    expect(
      (
        await s.call('POST', `/users/${alice.user.id}/roles`, {
          ...session(root),
          body: { role: 'reviewer' },
        })
      ).status,
    ).toBe(200);
    expect((await s.get('/audit', session(root))).status).toBe(404); // no such route in this profile
    expect(
      (await s.kernel.pool.query<{ t: string | null }>("select to_regclass('audit_event') as t"))
        .rows[0]!.t,
    ).toBeNull();
  });
});

describe('the viewer', () => {
  it('lists in the standard envelope, 0-based, filtered, and shows one entry', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const tag = `/api/internal/seen-${randomUUID().slice(0, 8)}`;
    const user = randomUUID();
    const made = [];
    for (let i = 0; i < 5; i += 1)
      made.push(
        await makeAuditEvent(s.kernel.pool, {
          path: `${tag}/${i}`,
          userId: user,
          method: i === 0 ? 'POST' : 'GET',
        }),
      );

    const first = (
      await s.get(`/audit?endpoint=${encodeURIComponent(tag)}&pageSize=2`, session(root))
    ).body as Envelope;
    expect(first.metadata).toEqual({ currentPage: 0, pageSize: 2, totalCount: 5, totalPages: 3 });
    expect(first.result).toHaveLength(2);
    const last = (
      await s.get(`/audit?endpoint=${encodeURIComponent(tag)}&pageSize=2&page=2`, session(root))
    ).body as Envelope;
    expect(last.result).toHaveLength(1);
    const posts = (await s.get(`/audit?user=${user}&method=POST`, session(root))).body as Envelope;
    expect(posts.result.map((r) => r.id)).toEqual([made[0]!.id]);

    const one = await s.get(`/audit/${made[0]!.id}`, session(root));
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: made[0]!.id, method: 'POST', userId: user });
    expect((await s.get(`/audit/${randomUUID()}`, session(root))).status).toBe(404);
    expect((await s.get('/audit/not-a-uuid', session(root))).status).toBe(422);
    expect((await s.get('/audit?page=-1', session(root))).status).toBe(422);
    expect((await s.get('/audit?method=TRACE', session(root))).status).toBe(422);
    expect((await s.get('/audit?outcome=fine', session(root))).status).toBe(422);
    expect((await s.get('/audit?from=yesterday', session(root))).status).toBe(422);
    expect((await s.get(`/audit?endpoint=${'x'.repeat(501)}`, session(root))).status).toBe(422);
  });

  it('does not audit the list (a screen pages it) but audits opening one entry, without the filters', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const made = await makeAuditEvent(s.kernel.pool, { path: '/looked-at' });
    await s.get('/audit?user=somebody', session(root));
    expect(await trail(s, "path = '/api/internal/audit' and user_id = $1", [root.user.id])).toEqual(
      [],
    );
    await s.get(`/audit/${made.id}`, session(root));
    const [row] = await trail(s, "path = '/api/internal/audit/{id}' and user_id = $1", [
      root.user.id,
    ]);
    expect(row).toMatchObject({ method: 'GET', outcome: 'ok', status: 200 });
    expect(row!.query).toBeNull();
  });

  it('exports CSV: headers, the cap, formula-injection guard, and an audit entry for the export', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const tag = `/exp-${randomUUID().slice(0, 8)}`;
    await makeAuditEvent(s.kernel.pool, {
      path: `${tag}/one`,
      action: '@evil',
      subjectId: '=cmd()',
    });
    await makeAuditEvent(s.kernel.pool, { path: `${tag}/plain` });
    const reply = await s.get(
      `/audit/export.csv?endpoint=${encodeURIComponent(tag)}`,
      session(root),
    );
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(reply.res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(reply.res.headers.get('x-row-count')).toBe('2');
    expect(reply.res.headers.get('x-truncated')).toBe('false');
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    const text = reply.bytes.toString('utf8');
    expect(text.split('\r\n')[0]).toContain('occurred_at');
    expect(text).toContain("'@evil");
    expect(text).toContain(",'=cmd(),");
    expect(text).not.toMatch(/(^|,)[=@]/m);

    // The export is an entry of its own (the domain action) and a request entry with the filters.
    const [action] = await trail(
      s,
      "action = 'audit.exported' and payload->'filters'->>'endpoint' = $1",
      [tag],
    );
    expect(action).toMatchObject({ user_id: root.user.id, payload: { rows: 2, capped: false } });
    const [request] = await trail(s, "path = '/api/internal/audit/export.csv' and user_id = $1", [
      root.user.id,
    ]);
    expect(request!.query).toEqual({ endpoint: tag });
  });

  it('answers 403 to a plain User, 401 to nobody, and records the denied try of every read but the list', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    for (const path of ['/audit', `/audit/${randomUUID()}`, '/audit/export.csv']) {
      const denied = await s.get(path, session(plain));
      expect(denied.status, path).toBe(403);
      expect((await s.get(path)).status, path).toBe(401);
    }
    const rows = await trail(s, "outcome = 'denied' and user_id = $1", [plain.user.id]);
    expect(rows.map((r) => r.path).sort()).toEqual([
      '/api/internal/audit/export.csv',
      '/api/internal/audit/{id}',
    ]);
  });
});

const statusOf = async (s: Started, deliveryId: string) =>
  (
    await s.kernel.pool.query<{ status: string }>(
      'select status from kernel_outbox_delivery where id = $1',
      [deliveryId],
    )
  ).rows[0]!.status;

describe('the system routes', () => {
  async function deadDelivery(s: Started) {
    const eventId = randomUUID();
    const id = randomUUID();
    await s.kernel.pool.query(
      `insert into kernel_outbox (id, name, emitter, payload) values ($1, 'settings.changed@1', 'core.settings', $2::jsonb)`,
      [eventId, JSON.stringify({ module: 'core.audit', keys: ['x'], version: 2, actorId: null })],
    );
    await s.kernel.pool.query(
      `insert into kernel_outbox_delivery (id, event_id, subscriber, status, attempts, last_error) values ($1, $2, 'core.audit', 'dead', 8, 'boom')`,
      [id, eventId],
    );
    return id;
  }

  it('shows the outbox and requeues a dead delivery, which is audited and then delivered', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const id = await deadDelivery(s);
    const overview = (await s.get('/system/outbox', session(root))).body as {
      stats: { dead: number };
      dead: { deliveryId: string }[];
    };
    expect(overview.stats.dead).toBe(1);
    expect(overview.dead.map((d) => d.deliveryId)).toEqual([id]);

    const done = await s.call('POST', `/system/outbox/deliveries/${id}/requeue`, session(root));
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      deliveryId: id,
      eventName: 'settings.changed@1',
      subscriber: 'core.audit',
    });
    await dispatch(s);
    expect(await statusOf(s, id)).toBe('delivered');

    expect((await trail(s, "action = 'system.outbox.requeued'")).map((r) => r.user_id)).toEqual([
      root.user.id,
    ]);
    expect(await trail(s, "path like '%requeue' and outcome = 'ok'")).toHaveLength(1);

    expect(
      (await s.call('POST', `/system/outbox/deliveries/${id}/requeue`, session(root))).status,
    ).toBe(409);
    expect(
      (await s.call('POST', `/system/outbox/deliveries/${randomUUID()}/requeue`, session(root)))
        .status,
    ).toBe(404);
  });

  it('lists the job runs in the list envelope, with the result counts and the failure, and filters them', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    for (const [name, status, result, error] of [
      ['core.audit.retention', 'succeeded', { removed: 12, capped: false }, null],
      ['core.audit.system.outbox-retention', 'failed', null, 'connection reset'],
    ] as const) {
      await s.kernel.pool.query(
        `insert into kernel_job_run (id, job_name, module, job_id, attempt, status, timeout_seconds, started_at, finished_at, duration_ms, error, result)
         values ($1, $2, 'core.audit', $2, 1, $3, 60, now(), now(), 5, $4, $5::jsonb)`,
        [randomUUID(), name, status, error, result ? JSON.stringify(result) : null],
      );
    }
    const all = await s.get('/system/job-runs?pageSize=1', session(root));
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({
      metadata: { currentPage: 0, pageSize: 1, totalCount: 2, totalPages: 2 },
    });
    const failed = (await s.get('/system/job-runs?status=failed', session(root))).body as {
      result: { jobName: string; error: string; result: unknown }[];
    };
    expect(failed.result).toHaveLength(1);
    expect(failed.result[0]).toMatchObject({
      jobName: 'core.audit.system.outbox-retention',
      error: 'connection reset',
      result: null,
    });
    const one = (await s.get('/system/job-runs?jobName=core.audit.retention', session(root)))
      .body as { result: { result: unknown }[] };
    expect(one.result[0]!.result).toEqual({ removed: 12, capped: false });
    expect((await s.get('/system/job-runs?pageSize=0', session(root))).status).toBe(422);
  });

  it('answers 403 to a plain User and changes nothing', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const id = await deadDelivery(s);
    expect((await s.get('/system/outbox', session(plain))).status).toBe(403);
    expect((await s.get('/system/job-runs', session(plain))).status).toBe(403);
    expect(
      (await s.call('POST', `/system/outbox/deliveries/${id}/requeue`, session(plain))).status,
    ).toBe(403);
    expect(await statusOf(s, id)).toBe('dead');
    expect(await trail(s, "action = 'system.outbox.requeued'")).toHaveLength(0);
  });
});
