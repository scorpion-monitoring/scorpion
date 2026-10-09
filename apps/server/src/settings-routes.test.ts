// The settings, secrets and preferences routes through the whole pipeline: rate limit, cookie
// authentication with CSRF, validation, the real authoriser and the error mapper, on real Postgres.
// The denied cases of every route are in defect-01.privilege-escalation.test.ts; this file is about
// what the routes do, and above all what they never say: a stored secret is not in any response.
import { defineModule } from '@scorpion/kernel';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

const VALUE = 'stored-secret-VALUE-5c1d9e';

const preferences = {
  id: 'fix.ui',
  manifest: defineModule({
    id: 'fix.ui',
    version: '1.0.0',
    contributes: {
      'settings.userPreference': [
        { key: 'fix.ui.theme', description: 'Colour scheme', schema: z.enum(['light', 'dark']) },
      ],
    },
  }),
};

const app = useIdentityApp();
const start = () => app.start({ extraModules: [preferences] });
type Started = Awaited<ReturnType<typeof start>>;

const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const admin = (s: Started) => s.signedIn('adminy', { roles: ['admin'] });
const problemOf = (reply: Reply) =>
  reply.body as { status: number; errors?: { in?: string; path: string; message: string }[] };

describe('GET /settings', () => {
  it('lists the settings of every module that has some, in the list envelope, with defaults', async () => {
    const s = await start();
    const a = await admin(s);
    const reply = await s.get('/settings', as(a));
    expect(reply.status).toBe(200);
    const body = reply.body as {
      metadata: Record<string, number>;
      result: { module: string; version: number; values: Record<string, unknown> }[];
    };
    expect(body.metadata).toEqual({ currentPage: 0, pageSize: 20, totalCount: 6, totalPages: 1 });
    expect(body.result.map((entry) => entry.module)).toEqual([
      'core.audit',
      'core.blob',
      'core.identity',
      'core.notifications',
      'core.settings',
      'registry.organisations',
    ]);
    expect(body.result[5]).toMatchObject({
      values: {
        exposeContactPoint: true,
        membership: {
          maxPendingPerUser: 10,
          membersVisibleToMembers: true,
          maxManagersPerOrganisation: 20,
        },
      },
    });
    expect(body.result[2]).toMatchObject({
      version: 0,
      values: { localAccounts: true, approvalPolicy: 'manual', oidcProviders: [] },
    });
  });

  it('pages: page and pageSize are honoured, 0-based', async () => {
    const s = await start();
    const a = await admin(s);
    const second = await s.get('/settings?page=1&pageSize=1', as(a));
    expect((second.body as { result: { module: string }[] }).result.map((e) => e.module)).toEqual([
      'core.blob',
    ]);
    expect((await s.get('/settings?pageSize=0', as(a))).status).toBe(422);
  });
});

describe('GET and PUT /settings/{module}', () => {
  it('reads one module, saves it with the version it read, and shows the new version', async () => {
    const s = await start();
    const a = await admin(s);
    const before = await s.get('/settings/core.identity', as(a));
    expect(before.body).toMatchObject({ module: 'core.identity', version: 0 });
    const saved = await s.call('PUT', '/settings/core.identity', {
      ...as(a),
      body: { version: 0, values: { localAccounts: false } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      version: 1,
      values: { localAccounts: false, approvalPolicy: 'manual' },
      updatedBy: a.user.id,
    });
    expect((await s.get('/settings/core.identity', as(a))).body).toMatchObject({ version: 1 });
  });

  it('answers 404 for an unknown module and for one without settings', async () => {
    const s = await start();
    const a = await admin(s);
    for (const path of ['/settings/nope', '/settings/core.authz', '/settings/nope/schema']) {
      const reply = await s.get(path, as(a));
      expect(reply.status, path).toBe(404);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
    const put = await s.call('PUT', '/settings/core.authz', {
      ...as(a),
      body: { version: 0, values: {} },
    });
    expect(put.status).toBe(404);
  });

  it('answers 422 with the failing fields, never 500, for invalid settings', async () => {
    const s = await start();
    const a = await admin(s);
    const put = (values: unknown, version: unknown = 0) =>
      s.call('PUT', '/settings/core.identity', { ...as(a), body: { version, values } });
    const wrongType = await put({ localAccounts: 'yes' });
    expect(wrongType.status).toBe(422);
    expect(problemOf(wrongType).errors?.map((e) => e.path)).toContain('values.localAccounts');
    const nested = await put({ retention: { purgeBatch: 0 } });
    expect(problemOf(nested).errors?.map((e) => e.path)).toContain('values.retention.purgeBatch');
    const unknownKey = await put({ colour: 'red' });
    expect(unknownKey.status).toBe(422);
    const badProvider = await put({ oidcProviders: [{ id: 'x', issuer: 'http://evil.example' }] });
    expect(badProvider.status).toBe(422);
    for (const body of [
      { values: {} }, // no version
      { version: -1, values: {} },
      { version: 'one', values: {} },
      { version: 0 },
      { version: 0, values: [] },
      { version: 0, values: {}, extra: 1 },
    ]) {
      const reply = await s.call('PUT', '/settings/core.identity', { ...as(a), body });
      expect(reply.status, JSON.stringify(body)).toBe(422);
    }
    expect((await s.get('/settings/core.identity', as(a))).body).toMatchObject({ version: 0 });
  });

  it('answers 409 for a stale version', async () => {
    const s = await start();
    const a = await admin(s);
    const put = (version: number) =>
      s.call('PUT', '/settings/core.identity', {
        ...as(a),
        body: { version, values: { localAccounts: version === 0 } },
      });
    expect((await put(0)).status).toBe(200);
    const stale = await put(0);
    expect(stale.status).toBe(409);
    expect(stale.res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('describes the settings as JSON Schema for the admin form', async () => {
    const s = await start();
    const a = await admin(s);
    const reply = await s.get('/settings/core.identity/schema', as(a));
    expect(reply.status).toBe(200);
    const schema = reply.body as { type: string; properties: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['localAccounts', 'approvalPolicy', 'oidcProviders', 'retention']),
    );
  });
});

describe('the secrets routes', () => {
  it('stores a secret, lists its name, and never returns the value', async () => {
    const s = await start();
    const a = await admin(s);
    const put = await s.call('PUT', '/secrets/oidc.keycloak.client-secret', {
      ...as(a),
      body: { value: VALUE },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ name: 'oidc.keycloak.client-secret', set: true });
    expect(put.res.headers.get('cache-control')).toBe('no-store');
    const list = await s.get('/secrets', as(a));
    expect(list.status).toBe(200);
    expect((list.body as { result: unknown[] }).result).toEqual([
      expect.objectContaining({ name: 'oidc.keycloak.client-secret', set: true }),
    ]);
    // The row is encrypted, and the stored secret is what the service gives to trusted code.
    expect(await s.settings.secrets.getSecret('oidc.keycloak.client-secret')).toBe(VALUE);
    const raw = await s.kernel.pool.query('select ciphertext from settings_secret');
    expect((raw.rows[0] as { ciphertext: Buffer }).ciphertext.includes(Buffer.from(VALUE))).toBe(
      false,
    );
  });

  it('removes a secret (204) and answers 404 for one that is not there', async () => {
    const s = await start();
    const a = await admin(s);
    await s.call('PUT', '/secrets/a.b', { ...as(a), body: { value: VALUE } });
    expect((await s.call('DELETE', '/secrets/a.b', as(a))).status).toBe(204);
    expect((await s.call('DELETE', '/secrets/a.b', as(a))).status).toBe(404);
  });

  it.each([
    ['a name with upper case', '/secrets/Bad.Name', { value: VALUE }],
    ['a name with a dot first', '/secrets/.hidden', { value: VALUE }],
    ['an empty value', '/secrets/a.b', { value: '' }],
    ['a value that is too long', '/secrets/a.b', { value: 'x'.repeat(5000) }],
    ['a value that is not text', '/secrets/a.b', { value: 42 }],
    ['an extra field', '/secrets/a.b', { value: VALUE, note: 'x' }],
    ['no value', '/secrets/a.b', {}],
  ])('answers 422 for %s, and the answer does not repeat the value', async (_n, path, body) => {
    const s = await start();
    const a = await admin(s);
    const reply = await s.call('PUT', path, { ...as(a), body });
    expect(reply.status).toBe(422);
    expect(JSON.stringify(reply.body)).not.toContain(VALUE);
    expect((await s.kernel.pool.query('select 1 from settings_secret')).rows).toEqual([]);
  });

  it('is rate limited with the strict bucket', async () => {
    const s = await app.start({ rateLimits: { strict: { capacity: 2, refillPerSecond: 0.001 } } });
    const a = await s.signedIn('adminy', { roles: ['admin'] });
    const put = () => s.call('PUT', '/secrets/a.b', { ...as(a), body: { value: VALUE } });
    expect((await put()).status).toBe(200); // the login used part of the strict bucket already
    const statuses = [(await put()).status, (await put()).status, (await put()).status];
    expect(statuses).toContain(429);
  });
});

describe('secrets never leave: every response and the log', () => {
  it('holds no stored value and no key in anything the settings routes answered or logged', async () => {
    const s = await start();
    const a = await admin(s);
    const answers: Reply[] = [];
    const call = async (method: string, path: string, body?: unknown) => {
      const reply = await s.call(method, path, { ...as(a), body });
      answers.push(reply);
      return reply;
    };
    await call('PUT', '/secrets/oidc.keycloak.client-secret', { value: VALUE });
    await call('PUT', '/secrets/oidc.other.client-secret', { value: `${VALUE}-2` });
    await call('PUT', '/secrets/Bad.Name', { value: VALUE }); // 422
    await call('PUT', '/secrets/a.b', { value: '' }); // 422
    await call('GET', '/secrets');
    await call('GET', '/secrets?page=3');
    await call('GET', '/settings');
    await call('GET', '/settings/core.identity');
    await call('GET', '/settings/core.identity/schema');
    await call('GET', '/settings/nope');
    await call('PUT', '/settings/core.identity', { version: 0, values: { localAccounts: true } });
    await call('PUT', '/settings/core.identity', { version: 0, values: { localAccounts: false } }); // 409
    await call('DELETE', '/secrets/oidc.other.client-secret');
    await call('DELETE', '/secrets/oidc.other.client-secret'); // 404
    // Denied callers get no value either.
    const plain = await s.signedIn('plainy');
    for (const [method, path] of [
      ['GET', '/secrets'],
      ['GET', '/settings'],
      ['PUT', '/secrets/oidc.keycloak.client-secret'],
    ] as const) {
      answers.push(
        await s.call(method, path, {
          ...as(plain),
          body: method === 'PUT' ? { value: 'whatever-attempt' } : undefined,
        }),
      );
    }
    answers.push(await s.call('GET', '/secrets'));

    expect(answers.length).toBeGreaterThan(15);
    const wire = answers
      .map((reply) => JSON.stringify(reply.body) + [...reply.res.headers].join(';'))
      .join('\n');
    expect(wire).not.toContain(VALUE);
    expect(wire).not.toContain(s.secretsKey);

    const log = s.logText();
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain(VALUE);
    expect(log).not.toContain('whatever-attempt');
    expect(log).not.toContain(s.secretsKey);
    expect(log).not.toContain('SECRETS_KEY');
    const events = JSON.stringify(
      (await s.kernel.pool.query('select payload from kernel_outbox')).rows,
    );
    expect(events).not.toContain(VALUE);
    expect(events).not.toContain(s.secretsKey);
  });
});

describe('the preferences routes', () => {
  it('stores, lists and removes the caller’s own preference', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const put = await s.call('PUT', '/preferences/fix.ui.theme', {
      ...as(alice),
      body: { value: 'dark' },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ key: 'fix.ui.theme', value: 'dark' });
    const list = await s.get('/preferences', as(alice));
    expect((list.body as { result: unknown[] }).result).toEqual([
      expect.objectContaining({ key: 'fix.ui.theme', value: 'dark' }),
    ]);
    expect((await s.call('DELETE', '/preferences/fix.ui.theme', as(alice))).status).toBe(204);
    expect((await s.call('DELETE', '/preferences/fix.ui.theme', as(alice))).status).toBe(204);
    expect(((await s.get('/preferences', as(alice))).body as { result: unknown[] }).result).toEqual(
      [],
    );
  });

  it('keeps users apart: there is no way to name another user’s preferences', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bobby');
    await s.call('PUT', '/preferences/fix.ui.theme', { ...as(alice), body: { value: 'dark' } });
    expect(((await s.get('/preferences', as(bob))).body as { result: unknown[] }).result).toEqual(
      [],
    );
    await s.call('DELETE', '/preferences/fix.ui.theme', as(bob));
    expect(
      ((await s.get('/preferences', as(alice))).body as { result: unknown[] }).result,
    ).toHaveLength(1);
    // A user id in the body is refused (strict input): there is nothing to name another user with.
    const sneaky = await s.call('PUT', '/preferences/fix.ui.theme', {
      ...as(bob),
      body: { value: 'light', userId: alice.user.id },
    });
    expect(sneaky.status).toBe(422);
    const own = await s.call('PUT', '/preferences/fix.ui.theme', {
      ...as(bob),
      body: { value: 'light' },
    });
    expect(own.status).toBe(200);
    const rows = await s.kernel.pool.query<{ user_id: string; value: unknown }>(
      'select user_id, value from settings_user_preference order by value::text',
    );
    expect(rows.rows).toEqual([
      { user_id: alice.user.id, value: 'dark' },
      { user_id: bob.user.id, value: 'light' },
    ]);
  });

  it('answers 404 for a key nobody registered and 422 for a value the schema rejects', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    expect(
      (await s.call('PUT', '/preferences/fix.ui.nothing', { ...as(alice), body: { value: 1 } }))
        .status,
    ).toBe(404);
    const bad = await s.call('PUT', '/preferences/fix.ui.theme', {
      ...as(alice),
      body: { value: 'purple' },
    });
    expect(bad.status).toBe(422);
    expect(problemOf(bad).errors?.map((e) => e.path)).toContain('value');
    expect(
      (await s.call('PUT', '/preferences/fix.ui.theme', { ...as(alice), body: {} })).status,
    ).toBe(422);
  });
});

describe('the rate limits an administrator saves', () => {
  it('apply to the next requests, in the same process, and come from core.settings', async () => {
    const s = await app.start({ storedRateLimits: true });
    const a = await s.signedIn('adminy', { roles: ['admin'] });
    const saved = await s.call('PUT', '/settings/core.settings', {
      ...as(a),
      body: {
        version: 0,
        values: {
          rateLimits: {
            default: { burst: 2, perMinute: 0.1 },
            strict: { burst: 10, perMinute: 10 },
          },
        },
      },
    });
    expect(saved.status).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await s.get('/settings', as(a))).status);
    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429);
  });

  it('are refused when out of range (422), and then nothing changes', async () => {
    const s = await start();
    const a = await admin(s);
    for (const rateLimits of [
      { default: { burst: 0, perMinute: 10 } },
      { strict: { burst: 5, perMinute: 0 } },
      { default: { burst: 5, perMinute: 10, extra: 1 } },
      { other: { burst: 5, perMinute: 10 } },
    ]) {
      const reply = await s.call('PUT', '/settings/core.settings', {
        ...as(a),
        body: { version: 0, values: { rateLimits } },
      });
      expect(reply.status, JSON.stringify(rateLimits)).toBe(422);
    }
  });
});
