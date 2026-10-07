// The routes of the administration screens of M5 sprint 3, through the whole pipeline on real
// Postgres: the list, one account, the roles and tokens of a user, deactivation, and the permissions of
// a role. Each is refused to a plain User, and what changes data is audited.
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const UNKNOWN = '019a0000-0000-7000-8000-000000000000';
type Started = Awaited<ReturnType<typeof app.start>>;
type Who = { cookie: string; csrf: string };
const as = (who: Who) => ({ cookie: who.cookie, csrf: who.csrf });
const start = () => app.start({ sessionCacheTtlMs: 0, tokenCacheTtlMs: 0 });
const dispatch = async (s: Started) => {
  while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
    // run until the outbox is quiet
  }
};
const trail = async (s: Started, where: string) =>
  (await s.kernel.pool.query(`select * from audit_event where ${where} order by occurred_at, id`))
    .rows as Record<string, unknown>[];
const list = (reply: Reply) =>
  reply.body as { metadata: { totalCount: number }; result: Record<string, unknown>[] };

describe('GET /users', () => {
  it('lists accounts in the legacy envelope, filtered, searched and sorted [ASVS-8.2.1]', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    await s.signedIn('anna');
    await s.signedIn('bert');

    const all = await s.get('/users', as(admin));
    expect(all.status).toBe(200);
    expect(list(all).metadata).toMatchObject({ currentPage: 0, totalCount: 3 });
    expect(list(all).result.map((u) => u.username)).toEqual(['anna', 'bert', 'root']);

    const filtered = await s.get('/users?q=be&status=active&sort=username&dir=desc', as(admin));
    expect(list(filtered).result.map((u) => u.username)).toEqual(['bert']);
    const reversed = await s.get('/users?sort=username&dir=desc', as(admin));
    expect(list(reversed).result.map((u) => u.username)).toEqual(['root', 'bert', 'anna']);
    const paged = await s.get('/users?pageSize=2&page=1', as(admin));
    expect(list(paged).result.map((u) => u.username)).toEqual(['root']);
  });

  it('never carries a hash, a secret or a profile text', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const text = JSON.stringify((await s.get('/users', as(admin))).body);
    expect(text).not.toMatch(/argon2|password|secret|hash|bio|avatar/i);
  });

  it('answers 422 for a bad filter, a long search text or a page size too big, never a 500', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    for (const query of [
      'status=nobody',
      `q=${'x'.repeat(101)}`,
      'sort=password',
      'dir=up',
      'pageSize=1000',
      'page=-1',
    ]) {
      const reply = await s.get(`/users?${query}`, as(admin));
      expect(reply.status, query).toBe(422);
    }
  });

  it('is refused to a plain User (403), a user without roles (403) and anonymous (401) [ASVS-8.3.1]', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const roleless = await s.signedIn('norole', { roles: [] });
    expect((await s.get('/users', as(plain))).status).toBe(403);
    expect((await s.get('/users', as(roleless))).status).toBe(403);
    expect((await s.get('/users')).status).toBe(401);
  });

  it('does not take /users/pending for an id', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const reply = await s.get('/users/pending', as(admin));
    expect(reply.status).toBe(200);
  });
});

describe('GET /users/{id}', () => {
  it('returns one account, 404 for an unknown one and 422 for a malformed id', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const target = await s.signedIn('target');
    const found = await s.get(`/users/${target.user.id}`, as(admin));
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ username: 'target', status: 'active' });
    expect((await s.get(`/users/${UNKNOWN}`, as(admin))).status).toBe(404);
    expect((await s.get('/users/not-a-uuid', as(admin))).status).toBe(422);
    const plain = await s.signedIn('plain');
    expect((await s.get(`/users/${target.user.id}`, as(plain))).status).toBe(403);
  });
});

describe('GET /users/{id}/roles', () => {
  it('lists the role keys in the envelope, and is refused to a plain User', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const target = await s.signedIn('target', { roles: ['user', 'reviewer'] });
    const reply = await s.get(`/users/${target.user.id}/roles`, as(admin));
    expect(reply.status).toBe(200);
    expect(list(reply).result).toEqual([{ key: 'reviewer' }, { key: 'user' }]);
    const plain = await s.signedIn('plain');
    expect((await s.get(`/users/${target.user.id}/roles`, as(plain))).status).toBe(403);
    expect((await s.get(`/users/${UNKNOWN}/roles`, as(admin))).status).toBe(404);
  });
});

describe('GET /users/{id}/tokens', () => {
  it('lists the open tokens of that user without secrets, and an administrator revokes one by id', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const target = await s.signedIn('target');
    const made = await s.post('/tokens', {
      ...as(target),
      body: { name: 'ci', scopes: ['core.identity.me.read'] },
    });
    const secret = (made.body as { token: string }).token;

    const reply = await s.get(`/users/${target.user.id}/tokens`, as(admin));
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
    expect(list(reply).result).toHaveLength(1);
    expect(JSON.stringify(reply.body)).not.toContain(secret);
    expect(list(reply).result[0]).toMatchObject({ name: 'ci' });

    const id = list(reply).result[0]!.id as string;
    expect((await s.call('DELETE', `/tokens/${id}`, as(admin))).status).toBe(204);
    expect(list(await s.get(`/users/${target.user.id}/tokens`, as(admin))).result).toEqual([]);
  });

  it('is refused to a plain User, who cannot read the tokens of another person', async () => {
    const s = await start();
    const target = await s.signedIn('target');
    const plain = await s.signedIn('plain');
    expect((await s.get(`/users/${target.user.id}/tokens`, as(plain))).status).toBe(403);
    expect((await s.get(`/users/${target.user.id}/tokens`)).status).toBe(401);
  });

  it('answers 404 for an unknown user and refuses an access token, which has no session', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    expect((await s.get(`/users/${UNKNOWN}/tokens`, as(admin))).status).toBe(404);
    const made = await s.post('/tokens', {
      ...as(admin),
      body: { name: 'wide', scopes: ['core.identity.token.manage-any'] },
    });
    const { token } = made.body as { token: string };
    const viaToken = await s.get(`/users/${admin.user.id}/tokens`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaToken.status).toBe(403);
  });
});

describe('POST /users/{id}/deactivate', () => {
  it('closes the account, ends its sessions at once, refuses its sign-in and its token, and is audited [ASVS-7.4.2]', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const target = await s.signedIn('target');
    const phone = await s.post('/auth/login', { body: { username: 'target', password: PASSWORD } });
    const made = await s.post('/tokens', {
      ...as(target),
      body: { name: 'ci', scopes: ['core.identity.me.read'] },
    });
    const { token } = made.body as { token: string };
    expect(
      (await s.get('/auth/me', { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(200);

    const reply = await s.post(`/users/${target.user.id}/deactivate`, as(admin));

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ id: target.user.id, status: 'deactivated' });
    expect((await s.get('/auth/me', { cookie: target.cookie })).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: phone.cookie })).status).toBe(401);
    expect(
      (await s.get('/auth/me', { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(401);
    const again = await s.post('/auth/login', { body: { username: 'target', password: PASSWORD } });
    expect(again.status).toBe(401); // the same answer as a wrong password
    expect(again.cookie).toBeUndefined();

    await dispatch(s);
    const [request] = await trail(
      s,
      "path = '/api/internal/users/{id}/deactivate' and source = 'api'",
    );
    expect(request).toMatchObject({ outcome: 'ok', status: 200, user_id: admin.user.id });
    const [event] = await trail(s, "action = 'identity.user.deactivated@1'");
    expect(event).toMatchObject({
      user_id: admin.user.id,
      subject_type: 'user',
      subject_id: target.user.id,
    });
  });

  it('refuses your own account, a second deactivation, an unknown id and a malformed one', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const target = await s.signedIn('target');
    expect((await s.post(`/users/${admin.user.id}/deactivate`, as(admin))).status).toBe(403);
    expect((await s.post(`/users/${target.user.id}/deactivate`, as(admin))).status).toBe(200);
    expect((await s.post(`/users/${target.user.id}/deactivate`, as(admin))).status).toBe(409);
    expect((await s.post(`/users/${UNKNOWN}/deactivate`, as(admin))).status).toBe(404);
    expect((await s.post('/users/not-a-uuid/deactivate', as(admin))).status).toBe(422);
  });

  it('is refused to a plain User (403, nothing changes) and to anonymous (401)', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    const target = await s.signedIn('target');
    expect((await s.post(`/users/${target.user.id}/deactivate`, as(plain))).status).toBe(403);
    expect((await s.post(`/users/${target.user.id}/deactivate`)).status).toBe(401);
    expect((await s.get('/auth/me', { cookie: target.cookie })).status).toBe(200);
  });
});

describe('PUT /roles/{key}/permissions', () => {
  const put = (s: Started, who: Who, key: string, permissions: string[]) =>
    s.call('PUT', `/roles/${key}/permissions`, { ...as(who), body: { permissions } });

  it('replaces the permissions of a role, takes effect at once, emits one event and is audited', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const member = await s.signedIn('member', { roles: ['reviewer'] });
    expect((await s.get('/users/pending', as(member))).status).toBe(403);

    const reply = await put(s, admin, 'reviewer', [
      'core.identity.user.list-pending',
      'core.identity.me.read',
    ]);

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      key: 'reviewer',
      permissions: ['core.identity.me.read', 'core.identity.user.list-pending'],
    });
    expect((await s.get('/users/pending', as(member))).status).toBe(200);

    await dispatch(s);
    const [request] = await trail(
      s,
      "path = '/api/internal/roles/{key}/permissions' and source = 'api'",
    );
    expect(request).toMatchObject({ outcome: 'ok', status: 200, user_id: admin.user.id });
    const [event] = await trail(s, "action = 'authz.role.permissions.changed@1'");
    expect(event).toMatchObject({ subject_type: 'role', subject_id: 'reviewer' });

    // Saving the same set again changes nothing and leaves no second event.
    await put(s, admin, 'reviewer', ['core.identity.me.read', 'core.identity.user.list-pending']);
    await dispatch(s);
    expect(await trail(s, "action = 'authz.role.permissions.changed@1'")).toHaveLength(1);
  });

  it('refuses Admin (403), an unknown role (404) and an undeclared permission (422), and stores nothing', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    expect((await put(s, admin, 'admin', [])).status).toBe(403);
    expect((await put(s, admin, 'nobody', [])).status).toBe(404);
    const bad = await put(s, admin, 'user', ['core.nothing.read']);
    expect(bad.status).toBe(422);
    const roles = await s.get('/roles', as(admin));
    const user = (roles.body as { result: { key: string; permissions: string[] }[] }).result.find(
      (role) => role.key === 'user',
    )!;
    expect(user.permissions).toContain('core.identity.me.read');
  });

  it('checks the size and the shape of the body, never a 500', async () => {
    const s = await start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const many = Array.from({ length: 1001 }, (_, n) => `core.x.p${n}`);
    expect((await put(s, admin, 'user', many)).status).toBe(422);
    expect(
      (await s.call('PUT', '/roles/user/permissions', { ...as(admin), body: { permissions: 'x' } }))
        .status,
    ).toBe(422);
    expect(
      (await s.call('PUT', '/roles/BAD KEY/permissions', { ...as(admin), body: {} })).status,
    ).toBe(422);
  });

  it('is refused to a plain User and to anonymous, and a token needs the scope [ASVS-8.2.1]', async () => {
    const s = await start();
    const plain = await s.signedIn('plain');
    expect((await put(s, plain, 'user', [])).status).toBe(403);
    expect(
      (await s.call('PUT', '/roles/user/permissions', { body: { permissions: [] } })).status,
    ).toBe(401);
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const made = await s.post('/tokens', {
      ...as(admin),
      body: { name: 'narrow', scopes: ['core.identity.me.read'] },
    });
    const { token } = made.body as { token: string };
    const viaToken = await s.call('PUT', '/roles/user/permissions', {
      headers: { authorization: `Bearer ${token}` },
      body: { permissions: [] },
    });
    expect(viaToken.status).toBe(403);
  });
});
