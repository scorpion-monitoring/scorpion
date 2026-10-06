// Defect 1 (FEATURES §5): unprotected internal endpoints let any signed-in user act as an
// administrator. This is the regression suite named in ADR-0005. It goes through the whole pipeline
// with the real authoriser of core.authz and real Postgres, and it never uses a test authoriser.
//
// Two layers:
//  1. The route-table walker. It iterates the LIVE route table and fails if a non-public route has
//     no entry in the matrix below, or if the matrix names a route that no longer exists. A route
//     added later without a decision here fails this file. Never weaken or delete it.
//  2. The scenarios: what a plain User, an anonymous caller, a user without roles and a token
//     with a broader scope than its owner's permissions can and cannot do.
import { randomUUID } from 'node:crypto';
import { makeInboxItem, makeRole } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { ALL_USER_SCOPES, PASSWORD, useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const start = () => app.start({ tokenCacheTtlMs: 0 });
type Started = Awaited<ReturnType<typeof start>>;

interface Sample {
  method: string;
  path: string;
  body?: unknown;
}

/**
 * `admin`: a plain User (the role `user`) must get 403, and the handler must not run.
 * `self`: the routes a plain User uses on their own account. They act on the caller only (no user id
 * in the input), so they are protected by the role: a user without roles gets 403.
 * Every entry also answers 401 to an anonymous caller and 403 to a user without any role.
 */
type Kind = 'admin' | 'self';
const FOREIGN = randomUUID();
const SAMPLES: Record<
  string,
  {
    kind: Kind;
    /** A self-service route on one of the caller's own items: the "plain User can use it" case needs the id of an item of theirs. */
    own?: boolean;
    sample: (ids: { id: string }) => Sample;
  }
> = {
  'POST /auth/logout': { kind: 'self', sample: () => ({ method: 'POST', path: '/auth/logout' }) },
  'POST /auth/logout-all': {
    kind: 'self',
    sample: () => ({ method: 'POST', path: '/auth/logout-all' }),
  },
  'GET /auth/me': { kind: 'self', sample: () => ({ method: 'GET', path: '/auth/me' }) },
  // M4b sprint 1: the caller's own sessions and re-authentication; and the administrators' termination.
  'GET /account/sessions': {
    kind: 'self',
    sample: () => ({ method: 'GET', path: '/account/sessions' }),
  },
  'DELETE /account/sessions/{id}': {
    kind: 'self',
    sample: ({ id }) => ({ method: 'DELETE', path: `/account/sessions/${id}` }),
  },
  'POST /account/reauthenticate': {
    kind: 'self',
    sample: () => ({
      method: 'POST',
      path: '/account/reauthenticate',
      body: { password: PASSWORD },
    }),
  },
  'POST /account/reauthenticate/oidc/{provider}': {
    kind: 'self',
    sample: () => ({ method: 'POST', path: '/account/reauthenticate/oidc/nowhere' }),
  },
  'POST /users/{id}/sessions/revoke': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'POST', path: `/users/${id}/sessions/revoke` }),
  },
  'POST /system/sessions/revoke-all': {
    kind: 'admin',
    sample: () => ({ method: 'POST', path: '/system/sessions/revoke-all' }),
  },
  'GET /users/pending': {
    kind: 'admin',
    sample: () => ({ method: 'GET', path: '/users/pending' }),
  },
  'POST /users/{id}/approve': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'POST', path: `/users/${id}/approve`, body: { role: 'admin' } }),
  },
  'POST /users/{id}/reject': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'POST', path: `/users/${id}/reject` }),
  },
  'POST /auth/oidc/{provider}/link': {
    kind: 'self',
    sample: () => ({ method: 'POST', path: '/auth/oidc/nowhere/link' }),
  },
  'POST /account/password': {
    kind: 'self',
    sample: () => ({
      method: 'POST',
      path: '/account/password',
      body: { currentPassword: PASSWORD, newPassword: 'another long passphrase' },
    }),
  },
  'POST /account/email/verification': {
    kind: 'self',
    sample: () => ({ method: 'POST', path: '/account/email/verification' }),
  },
  'GET /account/profile': {
    kind: 'self',
    sample: () => ({ method: 'GET', path: '/account/profile' }),
  },
  'PATCH /account/profile': {
    kind: 'self',
    sample: () => ({ method: 'PATCH', path: '/account/profile', body: { bio: 'hello' } }),
  },
  'GET /tokens': { kind: 'self', sample: () => ({ method: 'GET', path: '/tokens' }) },
  'POST /tokens': {
    kind: 'self',
    sample: () => ({
      method: 'POST',
      path: '/tokens',
      body: { name: 'walker', scopes: ['core.identity.me.read'] },
    }),
  },
  'DELETE /tokens/{id}': {
    kind: 'self',
    sample: ({ id }) => ({ method: 'DELETE', path: `/tokens/${id}` }),
  },
  'POST /tokens/{id}/rotate': {
    kind: 'self',
    sample: ({ id }) => ({ method: 'POST', path: `/tokens/${id}/rotate`, body: {} }),
  },
  'GET /roles': { kind: 'admin', sample: () => ({ method: 'GET', path: '/roles' }) },
  'POST /users/{id}/roles': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'POST', path: `/users/${id}/roles`, body: { role: 'admin' } }),
  },
  'DELETE /users/{id}/roles/{role}': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'DELETE', path: `/users/${id}/roles/admin` }),
  },
  // core.settings (M3 sprint 3). Configuration and secrets are Admin's; preferences are your own.
  'GET /settings': { kind: 'admin', sample: () => ({ method: 'GET', path: '/settings' }) },
  'GET /settings/{module}': {
    kind: 'admin',
    sample: () => ({ method: 'GET', path: '/settings/core.identity' }),
  },
  'GET /settings/{module}/schema': {
    kind: 'admin',
    sample: () => ({ method: 'GET', path: '/settings/core.identity/schema' }),
  },
  'PUT /settings/{module}': {
    kind: 'admin',
    sample: () => ({
      method: 'PUT',
      path: '/settings/core.identity',
      body: { version: 0, values: { localAccounts: false } },
    }),
  },
  'GET /secrets': { kind: 'admin', sample: () => ({ method: 'GET', path: '/secrets' }) },
  'PUT /secrets/{name}': {
    kind: 'admin',
    sample: () => ({
      method: 'PUT',
      path: '/secrets/oidc.evil.client-secret',
      body: { value: 'attacker-chosen-secret' },
    }),
  },
  'DELETE /secrets/{name}': {
    kind: 'admin',
    sample: () => ({ method: 'DELETE', path: '/secrets/oidc.evil.client-secret' }),
  },
  // core.settings vocabularies (M3 sprint 4). Reading the terms is self-service (forms need them);
  // changing them is Admin's.
  'GET /vocabularies': { kind: 'self', sample: () => ({ method: 'GET', path: '/vocabularies' }) },
  'GET /vocabularies/{vocabulary}/terms': {
    kind: 'self',
    sample: () => ({ method: 'GET', path: '/vocabularies/stage/terms' }),
  },
  'POST /vocabularies/{vocabulary}/terms': {
    kind: 'admin',
    sample: () => ({
      method: 'POST',
      path: '/vocabularies/stage/terms',
      body: { key: 'EVIL', labels: { en: 'Evil' } },
    }),
  },
  'PATCH /vocabularies/{vocabulary}/terms/{key}': {
    kind: 'admin',
    sample: () => ({
      method: 'PATCH',
      path: '/vocabularies/stage/terms/PROD',
      body: { active: false },
    }),
  },
  'DELETE /vocabularies/{vocabulary}/terms/{key}': {
    kind: 'admin',
    sample: () => ({ method: 'DELETE', path: '/vocabularies/stage/terms/PROD' }),
  },
  // core.blob: the generic upload is Admin's (logos). The avatar is the caller's own.
  'POST /files': {
    kind: 'admin',
    sample: () => ({ method: 'POST', path: '/files', body: 'not an image' }),
  },
  'PUT /account/avatar': {
    kind: 'self',
    sample: () => ({ method: 'PUT', path: '/account/avatar', body: 'not an image' }),
  },
  'DELETE /account/avatar': {
    kind: 'self',
    sample: () => ({ method: 'DELETE', path: '/account/avatar' }),
  },
  // core.notifications (M4 sprint 3). The inbox and the category list are every user's own; the status,
  // delivery list, requeue and test mail are Admin's.
  'GET /notifications/inbox': {
    kind: 'self',
    sample: () => ({ method: 'GET', path: '/notifications/inbox' }),
  },
  'GET /notifications/inbox/unread-count': {
    kind: 'self',
    sample: () => ({ method: 'GET', path: '/notifications/inbox/unread-count' }),
  },
  'POST /notifications/inbox/read-all': {
    kind: 'self',
    sample: () => ({ method: 'POST', path: '/notifications/inbox/read-all' }),
  },
  'POST /notifications/inbox/{id}/read': {
    kind: 'self',
    own: true,
    sample: ({ id }) => ({ method: 'POST', path: `/notifications/inbox/${id}/read` }),
  },
  'DELETE /notifications/inbox/{id}': {
    kind: 'self',
    own: true,
    sample: ({ id }) => ({ method: 'DELETE', path: `/notifications/inbox/${id}` }),
  },
  'GET /notifications/preferences/categories': {
    kind: 'self',
    sample: () => ({ method: 'GET', path: '/notifications/preferences/categories' }),
  },
  'GET /notifications/status': {
    kind: 'admin',
    sample: () => ({ method: 'GET', path: '/notifications/status' }),
  },
  'GET /notifications/deliveries': {
    kind: 'admin',
    sample: () => ({ method: 'GET', path: '/notifications/deliveries' }),
  },
  'POST /notifications/deliveries/{id}/requeue': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'POST', path: `/notifications/deliveries/${id}/requeue` }),
  },
  'POST /notifications/test': {
    kind: 'admin',
    sample: () => ({ method: 'POST', path: '/notifications/test' }),
  },
  // core.audit (M4 sprint 4). The trail and the kernel's maintenance surface are Admin's: reading the
  // log needs `core.audit.read` or `core.audit.export` and nothing else.
  'GET /audit': { kind: 'admin', sample: () => ({ method: 'GET', path: '/audit' }) },
  'GET /audit/export.csv': {
    kind: 'admin',
    sample: () => ({ method: 'GET', path: '/audit/export.csv' }),
  },
  'GET /audit/{id}': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'GET', path: `/audit/${id}` }),
  },
  'GET /system/outbox': {
    kind: 'admin',
    sample: () => ({ method: 'GET', path: '/system/outbox' }),
  },
  'POST /system/outbox/deliveries/{id}/requeue': {
    kind: 'admin',
    sample: ({ id }) => ({ method: 'POST', path: `/system/outbox/deliveries/${id}/requeue` }),
  },
  'GET /preferences': { kind: 'self', sample: () => ({ method: 'GET', path: '/preferences' }) },
  'PUT /preferences/{key}': {
    kind: 'self',
    sample: () => ({
      method: 'PUT',
      path: '/preferences/nobody.registered.this',
      body: { value: 1 },
    }),
  },
  'DELETE /preferences/{key}': {
    kind: 'self',
    sample: () => ({ method: 'DELETE', path: '/preferences/nobody.registered.this' }),
  },
};

const send = (s: Started, sample: Sample, auth: { cookie?: string; csrf?: string } = {}) =>
  s.call(sample.method, sample.path, { ...auth, body: sample.body });
const session = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });

const rolesOf = async (s: Started, userId: string) =>
  (
    await s.kernel.pool.query<{ key: string }>(
      `select r.key from authz_role_assignment a join authz_role r on r.id = a.role_id
        where a.user_id = $1 order by r.key`,
      [userId],
    )
  ).rows.map((r) => r.key);
const statusOf = async (s: Started, userId: string) =>
  (
    await s.kernel.pool.query<{ status: string }>(
      'select status from identity_user where id = $1',
      [userId],
    )
  ).rows[0]!.status;
const register = async (s: Started, username: string) => {
  const reply = await s.post('/auth/register', {
    body: { username, email: `${username}@example.org`, password: PASSWORD },
  });
  // 202 `{ accepted: true }` for every well-formed request (register without revealing): the id comes from the service.
  expect(reply.status).toBe(202);
  return (await s.identity.users.findByUsername(username))!.id;
};
const problem = (reply: Reply) => reply.res.headers.get('content-type') ?? '';

describe('defect 1: the route table', () => {
  it('has a decision in the matrix for every non-public route, and for nothing else (the walker) [ASVS-8.2.1]', async () => {
    const { kernel } = await start();
    const live = kernel.routes
      .filter((entry) => !entry.route.public)
      .map((entry) => {
        // The matrix is written for the internal API, which these helpers call.
        expect(entry.surface, `${entry.route.path} is not an internal route`).toBe('internal');
        return `${entry.route.method.toUpperCase()} ${entry.route.path}`;
      })
      .sort();
    expect(live.length).toBeGreaterThan(10);
    const missing = live.filter((key) => !(key in SAMPLES));
    expect(
      missing,
      `a non-public route has no entry in the "denied for a plain User" matrix of ` +
        `defect-01.privilege-escalation.test.ts: add one (and the denied-request cases) for ${missing.join(', ')}`,
    ).toEqual([]);
    expect(Object.keys(SAMPLES).filter((key) => !live.includes(key))).toEqual([]);
  });

  it('answers 401 to anonymous and 403 to a user without roles on every non-public route [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const s = await start();
    const roleless = await s.signedIn('norole', { roles: [] });
    for (const [key, { sample }] of Object.entries(SAMPLES)) {
      const request = sample({ id: FOREIGN });
      const anonymous = await send(s, request);
      expect(anonymous.status, `${key}: anonymous`).toBe(401);
      expect(problem(anonymous), key).toContain('application/problem+json');
      const nobody = await send(s, request, session(roleless));
      expect(nobody.status, `${key}: a user without roles`).toBe(403);
      expect(problem(nobody), key).toContain('application/problem+json');
    }
  });

  it('answers 403 to a plain User on every admin route, and leaves no trace', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const victim = await register(s, 'victim');
    const before = await s.kernel.pool.query(
      'select count(*)::int as n from authz_role_assignment',
    );
    for (const [key, { kind, sample }] of Object.entries(SAMPLES)) {
      if (kind !== 'admin') continue;
      const reply = await send(s, sample({ id: victim }), session(plain));
      expect(reply.status, key).toBe(403);
      expect(problem(reply), key).toContain('application/problem+json');
    }
    expect(await statusOf(s, victim)).toBe('pending');
    expect(await rolesOf(s, victim)).toEqual([]);
    expect(await rolesOf(s, plain.user.id)).toEqual(['user']);
    expect(
      (await s.kernel.pool.query('select count(*)::int as n from authz_role_assignment')).rows,
    ).toEqual(before.rows);
    expect(
      (await s.kernel.pool.query("select 1 from kernel_outbox where name like 'authz.%'")).rows,
    ).toEqual([]);
    // Nor did the settings and secrets routes change anything.
    for (const table of ['settings_setting', 'settings_secret', 'blob_blob']) {
      expect((await s.kernel.pool.query(`select 1 from ${table}`)).rows, table).toEqual([]);
    }
    expect(
      (await s.kernel.pool.query("select 1 from kernel_outbox where name like 'settings.%'")).rows,
    ).toEqual([]);
    // ... nor the vocabularies: the seeded terms are as they were.
    expect(
      (
        await s.kernel.pool.query(
          "select count(*)::int as n from settings_vocabulary_term where key = 'EVIL' or not active",
        )
      ).rows,
    ).toEqual([{ n: 0 }]);
  });

  it('lets a plain User use the self-service routes (so the 403s above are about the role, not a broken route)', async () => {
    const s = await start();
    let n = 0;
    for (const [key, { kind, own, sample }] of Object.entries(SAMPLES)) {
      if (kind !== 'self') continue;
      const who = await s.signedIn(`selfservice${n++}`);
      // An item id is the caller's own, or the answer is 403 by design (see notification-routes.test.ts).
      const id = own ? (await makeInboxItem(s.kernel.pool, { userId: who.user.id })).id : FOREIGN;
      const reply = await send(s, sample({ id }), session(who));
      expect([401, 403], key).not.toContain(reply.status);
    }
  });

  it('answers 403 to a token on every admin route, whatever its scopes name, when its owner is a plain User', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const permissions = [
      'core.identity.user.approve',
      'core.identity.user.reject',
      'core.identity.user.list-pending',
      'core.identity.role.read',
      'core.identity.role.assign',
      'core.authz.role.read',
      'core.authz.role.assign',
      'core.authz.role.manage',
      'core.identity.token.manage-any',
      'core.identity.session.manage-any',
      'core.settings.read',
      'core.settings.write',
      'core.settings.secret.write',
      'core.settings.vocabulary.write',
      'core.blob.manage',
      'core.notifications.status.read',
      'core.notifications.deliveries.read',
      'core.notifications.deliveries.manage',
      'core.notifications.test',
      'core.audit.read',
      'core.audit.export',
      'core.audit.system.read',
      'core.audit.system.manage',
    ];
    // A token holds at most 20 scopes, so the widest one the owner can make is two tokens.
    const wide = [[...ALL_USER_SCOPES, ...permissions.slice(0, 10)], permissions.slice(10)];
    const victim = await register(s, 'victim');
    for (const [index, scopes] of wide.entries()) {
      const made = await s.post('/tokens', {
        ...session(plain),
        body: { name: `wide${index}`, scopes },
      });
      expect(made.status).toBe(201); // a scope that names a permission the owner lacks is allowed ...
      const { token } = made.body as { token: string };
      for (const [key, { kind, sample }] of Object.entries(SAMPLES)) {
        if (kind !== 'admin') continue;
        const request = sample({ id: victim });
        const reply = await s.call(request.method, request.path, {
          headers: bearer(token),
          body: request.body,
        });
        expect(reply.status, `${key}: ... but it grants nothing`).toBe(403);
      }
    }
    expect(await statusOf(s, victim)).toBe('pending');
    expect(await rolesOf(s, victim)).toEqual([]);
  });
});

describe('defect 1: nobody grants themselves a role, or approves themselves', () => {
  it('refuses a plain User every way of giving themselves a role', async () => {
    const s = await start();
    const mallory = await s.signedIn('mallory');
    const me = mallory.user.id;
    for (const sample of [
      { method: 'POST', path: `/users/${me}/roles`, body: { role: 'admin' } },
      { method: 'POST', path: `/users/${me}/approve`, body: { role: 'admin' } },
      { method: 'POST', path: `/users/${me}/reject` },
    ]) {
      expect((await send(s, sample, session(mallory))).status, sample.path).toBe(403);
    }
    // No field of an account route carries a role: unknown fields are 422, nothing is stored.
    const profile = await s.call('PATCH', '/account/profile', {
      ...session(mallory),
      body: { bio: 'x', roles: ['admin'], role: 'admin' },
    });
    expect(profile.status).toBe(422);
    const registration = await s.post('/auth/register', {
      body: { username: 'sneaky', email: 'sneaky@example.org', password: PASSWORD, role: 'admin' },
    });
    expect(registration.status).toBe(422);
    expect(await rolesOf(s, me)).toEqual(['user']);
    expect(await rolesOf(s, (await s.identity.users.findByUsername('mallory'))!.id)).toEqual([
      'user',
    ]);
  });

  it('refuses Admin to change their own roles, and to approve or reject their own account', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const me = root.user.id;
    expect(
      (await s.call('POST', `/users/${me}/roles`, { ...session(root), body: { role: 'reviewer' } }))
        .status,
    ).toBe(403);
    expect((await s.call('DELETE', `/users/${me}/roles/admin`, session(root))).status).toBe(403);
    // 403 and not 409 ("not pending"): the protection comes before anything is looked at.
    for (const verb of ['approve', 'reject']) {
      expect((await s.call('POST', `/users/${me}/${verb}`, session(root))).status, verb).toBe(403);
    }
    expect(await rolesOf(s, me)).toEqual(['admin']);
  });

  it('refuses an approver who holds the permission in a custom role to approve their own account', async () => {
    const s = await start();
    const role = await makeRole(s.kernel.pool, {
      permissions: [
        'core.identity.user.approve',
        'core.identity.me.read',
        'core.authz.role.assign',
        'core.identity.role.assign',
      ],
    });
    const approver = await s.signedIn('approver', { roles: [role.key] });
    const reply = await s.call('POST', `/users/${approver.user.id}/approve`, {
      ...session(approver),
      body: { role: 'admin' },
    });
    expect(reply.status).toBe(403);
    expect(await rolesOf(s, approver.user.id)).toEqual([role.key]);
  });

  it('lets an administrator approve someone else with a role, in one step, and the account can then be used', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const alice = await register(s, 'alice');
    const approved = await s.call('POST', `/users/${alice}/approve`, {
      ...session(root),
      body: { role: 'user' },
    });
    expect(approved.status).toBe(200);
    expect(await rolesOf(s, alice)).toEqual(['user']);
    const login = await s.post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    expect(login.status).toBe(200);
    const me = await s.get('/auth/me', { cookie: login.cookie });
    expect(me.body).toMatchObject({ roles: ['user'] });
  });

  it('keeps the account pending when the approval names a role that does not exist', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const alice = await register(s, 'alice');
    const reply = await s.call('POST', `/users/${alice}/approve`, {
      ...session(root),
      body: { role: 'no-such-role' },
    });
    expect(reply.status).toBe(404);
    expect(await statusOf(s, alice)).toBe('pending');
    expect(await rolesOf(s, alice)).toEqual([]);
  });
});

describe('defect 1: tokens of other people, and tokens of the caller', () => {
  it('keeps a plain User from revoking or rotating the token of another user [ASVS-8.2.2]', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bobby');
    const made = await s.post('/tokens', {
      ...session(bob),
      body: { name: 'bobs', scopes: ['core.identity.me.read'] },
    });
    const { id, token } = made.body as { id: string; token: string };

    const revoke = await s.call('DELETE', `/tokens/${id}`, session(alice));
    expect(revoke.status).toBe(404); // the same answer as for an id that does not exist
    const rotate = await s.call('POST', `/tokens/${id}/rotate`, { ...session(alice), body: {} });
    expect(rotate.status).toBe(404);
    expect((await s.get('/auth/me', { headers: bearer(token) })).status).toBe(200);
    expect(JSON.stringify((await s.get('/tokens', session(alice))).body)).not.toContain(id);
  });

  it('lets only core.identity.token.manage-any revoke the token of someone else (and never rotate it)', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const bob = await s.signedIn('bobby');
    const { id, token } = (
      await s.post('/tokens', {
        ...session(bob),
        body: { name: 'bobs', scopes: ['core.identity.me.read'] },
      })
    ).body as { id: string; token: string };
    expect(
      (await s.call('POST', `/tokens/${id}/rotate`, { ...session(root), body: {} })).status,
    ).toBe(404);
    expect((await s.call('DELETE', `/tokens/${id}`, session(root))).status).toBe(204);
    expect((await s.get('/auth/me', { headers: bearer(token) })).status).toBe(401);
  });

  it('keeps one user from ending the sessions of another [ASVS-8.2.2]', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bobby');
    expect((await s.call('POST', '/auth/logout-all', session(bob))).status).toBe(200);
    expect((await s.get('/auth/me', { cookie: bob.cookie })).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: alice.cookie })).status).toBe(200);
  });

  it('refuses a token on every session-only route, with every scope its owner could have', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const { token, id } = (
      await s.post('/tokens', {
        ...session(alice),
        body: { name: 'all', scopes: ALL_USER_SCOPES },
      })
    ).body as { token: string; id: string };
    const attempts: Sample[] = [
      { method: 'GET', path: '/tokens' },
      {
        method: 'POST',
        path: '/tokens',
        body: { name: 'child', scopes: ['core.identity.me.read'] },
      },
      { method: 'DELETE', path: `/tokens/${id}` },
      { method: 'POST', path: `/tokens/${id}/rotate`, body: {} },
      { method: 'GET', path: '/account/profile' },
      { method: 'PATCH', path: '/account/profile', body: { bio: 'x' } },
      {
        method: 'POST',
        path: '/account/password',
        body: { currentPassword: PASSWORD, newPassword: 'another long passphrase' },
      },
      { method: 'POST', path: '/account/email/verification' },
      { method: 'GET', path: '/account/sessions' },
      { method: 'DELETE', path: `/account/sessions/${id}` },
      { method: 'POST', path: '/account/reauthenticate', body: { password: PASSWORD } },
      { method: 'POST', path: '/account/reauthenticate/oidc/nowhere' },
    ];
    for (const attempt of attempts) {
      const reply = await s.call(attempt.method, attempt.path, {
        headers: bearer(token),
        body: attempt.body,
      });
      expect(reply.status, `${attempt.method} ${attempt.path}`).toBe(403);
    }
    expect((await s.get('/auth/me', { headers: bearer(token) })).status).toBe(200); // still itself
    expect((await s.get('/auth/me', { cookie: alice.cookie })).status).toBe(200); // sessions untouched
  });
});

describe('defect 1: sessions', () => {
  it('lets a token end the sessions of its owner only when a scope names core.identity.session.manage', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bobby');
    const make = async (scopes: string[], name: string) =>
      (
        (await s.post('/tokens', { ...session(alice), body: { name, scopes } })).body as {
          token: string;
        }
      ).token;
    const without = await make(['core.identity.me.read'], 'plain');
    const withScope = await make(['core.identity.session.manage'], 'ends-sessions');
    expect((await s.post('/auth/logout-all', { headers: bearer(without) })).status).toBe(403);
    expect((await s.get('/auth/me', { cookie: alice.cookie })).status).toBe(200);
    expect((await s.post('/auth/logout-all', { headers: bearer(withScope) })).status).toBe(200);
    expect((await s.get('/auth/me', { cookie: alice.cookie })).status).toBe(401);
    // Only the owner's sessions: bob's is untouched.
    expect((await s.get('/auth/me', { cookie: bob.cookie })).status).toBe(200);
  });
});

describe('defect 1: a token is limited to its scopes and to what its owner holds', () => {
  const approveScopes = [
    'core.identity.me.read',
    'core.identity.user.approve',
    'core.authz.role.assign',
    'core.identity.role.assign',
  ];

  it('limits a token to the permissions it names, even for an administrator', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const alice = await register(s, 'alice');
    const narrow = (
      await s.post('/tokens', {
        ...session(root),
        body: { name: 'narrow', scopes: ['core.identity.me.read'] },
      })
    ).body as { token: string };
    expect((await s.get('/auth/me', { headers: bearer(narrow.token) })).status).toBe(200);
    // The owner may approve; the token was not given that.
    const denied = await s.call('POST', `/users/${alice}/approve`, {
      headers: bearer(narrow.token),
    });
    expect(denied.status).toBe(403);
    expect(await statusOf(s, alice)).toBe('pending');

    const wide = (
      await s.post('/tokens', { ...session(root), body: { name: 'wide', scopes: approveScopes } })
    ).body as { token: string };
    const allowed = await s.call('POST', `/users/${alice}/approve`, {
      headers: bearer(wide.token),
    });
    expect(allowed.status).toBe(200);
    expect(await statusOf(s, alice)).toBe('active');
    expect(await rolesOf(s, alice)).toEqual(['user']);
  });

  it('gives a token nothing the owner lacks: a plain User cannot widen themselves with a scope', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const alice = await register(s, 'alice');
    const { token } = (
      await s.post('/tokens', { ...session(plain), body: { name: 'wide', scopes: approveScopes } })
    ).body as { token: string };
    expect((await s.get('/auth/me', { headers: bearer(token) })).status).toBe(200);
    const reply = await s.call('POST', `/users/${alice}/approve`, { headers: bearer(token) });
    expect(reply.status).toBe(403);
    expect(await statusOf(s, alice)).toBe('pending');
  });

  it('takes the owner’s role away from the token at once in this process (and within the cache bound elsewhere)', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const second = await s.signedIn('second', { roles: ['admin'] });
    const { token } = (
      await s.post('/tokens', { ...session(second), body: { name: 'wide', scopes: approveScopes } })
    ).body as { token: string };
    const first = await register(s, 'first');
    const secondTry = await register(s, 'next');
    expect(
      (await s.call('POST', `/users/${first}/approve`, { headers: bearer(token) })).status,
    ).toBe(200);
    // root demotes second through the API.
    const demoted = await s.call('DELETE', `/users/${second.user.id}/roles/admin`, session(root));
    expect(demoted.status).toBe(204);
    expect(
      (await s.call('POST', `/users/${secondTry}/approve`, { headers: bearer(token) })).status,
    ).toBe(403);
    expect(await statusOf(s, secondTry)).toBe('pending');
  });

  it('cannot create a token for a permission that does not exist, or without any scope', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    for (const scopes of [[], ['read:kpi'], ['core.identity.made-up']]) {
      const reply = await s.post('/tokens', { ...session(alice), body: { name: 'bad', scopes } });
      expect(reply.status, JSON.stringify(scopes)).toBe(422);
    }
  });
});

describe('defect 1: administrators', () => {
  it('lets an Admin demote another Admin, and then nobody can demote the one who is left', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const other = await s.signedIn('other', { roles: ['admin'] });
    expect(
      (await s.call('DELETE', `/users/${other.user.id}/roles/admin`, session(root))).status,
    ).toBe(204);
    // root is now the only Admin: nobody else can act, and root cannot change their own roles.
    expect(
      (await s.call('DELETE', `/users/${root.user.id}/roles/admin`, session(root))).status,
    ).toBe(403);
    expect(await rolesOf(s, root.user.id)).toEqual(['admin']);
  });
});

describe('defect 1: settings, secrets and preferences', () => {
  it('lets a plain User change no setting and no secret, and read none, whatever they send', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const attempts = [
      {
        method: 'PUT',
        path: '/settings/core.identity',
        body: { version: 0, values: { localAccounts: false } },
      },
      { method: 'PUT', path: '/settings/core.settings', body: { version: 0, values: {} } },
      {
        method: 'PUT',
        path: '/secrets/oidc.evil.client-secret',
        body: { value: 'attacker-secret' },
      },
      { method: 'DELETE', path: '/secrets/oidc.evil.client-secret' },
      { method: 'GET', path: '/settings' },
      { method: 'GET', path: '/secrets' },
    ];
    for (const attempt of attempts) {
      const reply = await send(s, attempt, session(plain));
      expect(reply.status, `${attempt.method} ${attempt.path}`).toBe(403);
    }
    for (const table of ['settings_setting', 'settings_secret', 'blob_blob']) {
      expect((await s.kernel.pool.query(`select 1 from ${table}`)).rows, table).toEqual([]);
    }
  });

  it('keeps a token that names the settings scopes at what its owner holds', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const admin = await s.signedIn('boss', { roles: ['admin'] });
    const scopes = ['core.settings.read', 'core.settings.write', 'core.settings.secret.write'];
    const wide = (await s.post('/tokens', { ...session(plain), body: { name: 'wide', scopes } }))
      .body as { token: string };
    const narrow = (
      await s.post('/tokens', {
        ...session(admin),
        body: { name: 'read-only', scopes: ['core.settings.read'] },
      })
    ).body as { token: string };
    const write = { version: 0, values: { localAccounts: false } };
    // A plain User's token grants nothing, even with the scopes; an Admin's token is limited to its scopes.
    expect((await s.call('GET', '/settings', { headers: bearer(wide.token) })).status).toBe(403);
    expect(
      (await s.call('PUT', '/settings/core.identity', { headers: bearer(wide.token), body: write }))
        .status,
    ).toBe(403);
    expect((await s.call('GET', '/settings', { headers: bearer(narrow.token) })).status).toBe(200);
    expect(
      (
        await s.call('PUT', '/settings/core.identity', {
          headers: bearer(narrow.token),
          body: write,
        })
      ).status,
    ).toBe(403);
    expect(
      (await s.call('PUT', '/secrets/a.b', { headers: bearer(narrow.token), body: { value: 'x' } }))
        .status,
    ).toBe(403);
    expect((await s.kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
  });

  it('keeps Reviewer out: the role holds no settings permission unless an administrator gives it', async () => {
    const s = await start();
    const reviewer = await s.signedIn('reviewer', { roles: ['reviewer'] });
    for (const [method, path] of [
      ['GET', '/settings'],
      ['GET', '/secrets'],
    ] as const) {
      expect((await s.call(method, path, session(reviewer))).status, path).toBe(403);
    }
  });

  it('lets nobody read another user’s preferences: there is no route that names a user', async () => {
    const s = await start();
    const admin = await s.signedIn('boss', { roles: ['admin'] });
    // Even an Admin sees only their own list.
    const preferenceRoutes = [...s.kernel.routes]
      .filter((entry) => entry.route.path.startsWith('/preferences'))
      .map((entry) => entry.route.path);
    expect(preferenceRoutes.sort()).toEqual([
      '/preferences',
      '/preferences/{key}',
      '/preferences/{key}',
    ]);
    expect((await s.get('/preferences', session(admin))).status).toBe(200);
  });
});

describe('defect 1: log reads', () => {
  const READS = [
    { method: 'GET', path: '/audit' },
    { method: 'GET', path: '/audit/export.csv' },
    { method: 'GET', path: `/audit/${FOREIGN}` },
    { method: 'GET', path: '/system/outbox' },
  ];

  it('keeps the trail from a plain User, by session and by token, and from a token scoped to it whose owner lacks the permission', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const plain = await s.signedIn('plain');
    // The trail has something in it, so a 200 would be a leak and not an empty list.
    await s.call('POST', `/users/${FOREIGN}/approve`, { ...session(plain), body: {} });
    const made = await s.post('/tokens', {
      ...session(plain),
      body: {
        name: 'wishful',
        scopes: ['core.audit.read', 'core.audit.export', 'core.audit.system.read'],
      },
    });
    expect(made.status).toBe(201);
    const { token } = made.body as { token: string };
    for (const read of READS) {
      for (const auth of [{ cookie: plain.cookie, csrf: plain.csrf }, { headers: bearer(token) }]) {
        const reply = await s.call(read.method, read.path, auth);
        expect(reply.status, `${read.path}`).toBe(403);
        expect(reply.bytes.toString('utf8')).not.toContain('api.POST');
        expect(problem(reply)).toContain('application/problem+json');
      }
    }
    // The administrator reads the same trail, which shows the plain User's try as denied.
    const listed = await s.get('/audit?outcome=denied', session(root));
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).toContain(plain.user.id);
  });

  it('lets an administrator’s token read only what its scopes name', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const narrow = await s.post('/tokens', {
      ...session(root),
      body: { name: 'narrow', scopes: ['core.audit.read'] },
    });
    const { token } = narrow.body as { token: string };
    expect((await s.get('/audit', { headers: bearer(token) })).status).toBe(200);
    expect((await s.get('/audit/export.csv', { headers: bearer(token) })).status).toBe(403);
    expect((await s.get('/system/outbox', { headers: bearer(token) })).status).toBe(403);
  });

  it('does not let the log be changed through the API: there is no route that writes or deletes it', async () => {
    const s = await start();
    const root = await s.signedIn('root', { roles: ['admin'] });
    const routes = s.kernel.routes
      .filter((entry) => entry.route.path.startsWith('/audit'))
      .map((entry) => `${entry.route.method.toUpperCase()} ${entry.route.path}`)
      .sort();
    expect(routes).toEqual(['GET /audit', 'GET /audit/export.csv', 'GET /audit/{id}']);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await s.call(method, '/audit', session(root))).status, method).toBe(404);
      expect((await s.call(method, `/audit/${FOREIGN}`, session(root))).status, method).toBe(404);
    }
  });
});
