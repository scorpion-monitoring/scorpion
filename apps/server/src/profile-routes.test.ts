// The profile routes through the whole pipeline: own profile only, session callers only, the
// address change that waits for its link, and bad input.
import { describe, expect, it } from 'vitest';
import { ALL_USER_SCOPES, createMemoryMailer, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();

async function start(options: Parameters<typeof app.start>[0] = {}) {
  const mailer = createMemoryMailer();
  const started = await app.start({ mailer, tokenCacheTtlMs: 0, ...options });
  return { ...started, mailer };
}
const patch = (
  s: Awaited<ReturnType<typeof start>>,
  session: { cookie: string; csrf: string },
  body: unknown,
) => s.call('PATCH', '/account/profile', { ...session, body });

describe('GET and PATCH /account/profile', () => {
  it('shows and edits the caller’s own profile', async () => {
    const s = await start();
    const alice = await s.signedIn('alice', { email: 'alice@example.org' });
    const bobby = await s.signedIn('bobby');

    const before = await s.get('/account/profile', alice);
    expect(before.status).toBe(200);
    expect(before.res.headers.get('cache-control')).toBe('no-store');
    expect(before.body).toEqual({
      username: 'alice',
      displayName: null,
      email: 'alice@example.org',
      emailVerified: false,
      pendingEmail: null,
      bio: null,
      avatarHash: null,
    });

    const changed = await patch(s, alice, {
      displayName: 'Alice L.',
      bio: 'Plain text <b>only</b>',
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ displayName: 'Alice L.', bio: 'Plain text <b>only</b>' });
    expect((await s.get('/account/profile', bobby)).body).toMatchObject({
      displayName: null,
      bio: null,
    });
  });

  it('keeps the old address and shows the new one as pending until its link is opened', async () => {
    const s = await start();
    const alice = await s.signedIn('alice', { email: 'alice@example.org' });
    const reply = await patch(s, alice, { email: 'new@example.org' });
    expect(reply.body).toMatchObject({
      email: 'alice@example.org',
      pendingEmail: 'new@example.org',
    });
    expect(s.mailer.sent.map((m) => m.to)).toEqual(['new@example.org']);

    const token = decodeURIComponent(/#token=([^\s]+)/.exec(s.mailer.sent[0]!.text)![1]!);
    expect((await s.post('/auth/verify-email', { body: { token } })).status).toBe(204);
    expect((await s.get('/account/profile', alice)).body).toMatchObject({
      email: 'new@example.org',
      emailVerified: true,
      pendingEmail: null,
    });
  });

  it.each([
    ['nothing', {}],
    ['a username', { username: 'root' }],
    ['a role', { roles: ['admin'] }],
    ['a user id', { userId: '019a0000-0000-7000-8000-000000000000' }],
    ['a name that is too long', { displayName: 'x'.repeat(101) }],
    ['a bio that is too long', { bio: 'x'.repeat(2001) }],
    ['a bad address', { email: 'nope' }],
    ['text instead of an object', 'hello'],
  ])('is 422 for %s', async (_name, body) => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const reply = await patch(s, alice, body);
    expect(reply.status).toBe(422);
    expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('is 429 after five address changes, and a PATCH needs the CSRF token', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const statuses = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await patch(s, alice, { email: `a${i}@example.org` })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(
      (await s.call('PATCH', '/account/profile', { cookie: alice.cookie, body: { bio: 'x' } }))
        .status,
    ).toBe(401);
  });
});

describe('the profile routes refuse the callers who may not use them', () => {
  const routes: [string, string, string, unknown][] = [
    ['GET', '/account/profile', 'core.identity.profile.read', undefined],
    ['PATCH', '/account/profile', 'core.identity.profile.update', { bio: 'x' }],
  ];

  it.each(routes)(
    '%s %s: anonymous → 401, without %s → 403, with a token → 403',
    async (method, path, permission, body) => {
      const anonymous = await start();
      const reply = await anonymous.call(method, path, { body });
      expect(reply.status).toBe(401);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');

      const denied = await start({ permissions: ['core.identity.session.manage'] });
      const session = await denied.signedIn('alice');
      expect((await denied.call(method, path, { ...session, body })).status).toBe(403);

      const allowed = await start({ permissions: [permission, 'core.identity.token.manage'] });
      const mine = await allowed.signedIn('alice');
      const created = (
        await allowed.post('/tokens', { ...mine, body: { name: 'ci', scopes: ALL_USER_SCOPES } })
      ).body as {
        token: string;
      };
      const viaToken = await allowed.call(method, path, {
        headers: { authorization: `Bearer ${created.token}` },
        body,
      });
      expect(viaToken.status).toBe(403);
      expect((await allowed.call(method, path, { ...mine, body })).status).toBe(200);
    },
  );
});
