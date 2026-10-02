// The file routes through the whole pipeline: the public file route, the administrator's upload,
// the avatar, and the headers that make a stored file safe to serve. The denied cases of the
// non-public routes are in defect-01.privilege-escalation.test.ts.
import { createHash } from 'node:crypto';
import { makePng } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { ALL_USER_SCOPES, useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const start = () => app.start({ tokenCacheTtlMs: 0 });
type Started = Awaited<ReturnType<typeof start>>;
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const MiB = 1024 * 1024;
const text = (value: string) => new TextEncoder().encode(value);
const hashOf = (reply: Reply) => (reply.body as { hash: string }).hash;
const upload = (
  s: Started,
  who: { cookie: string; csrf: string },
  body: Uint8Array,
  headers = {},
) => s.call('POST', '/files', { ...as(who), body, headers });

describe('POST /files', () => {
  it('stores an image for an administrator and says where to find it', async () => {
    const s = await start();
    const admin = await s.signedIn('adminy', { roles: ['admin'] });
    const png = makePng(16);
    const reply = await upload(s, admin, png);
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ mime: 'image/png', url: `/files/${hashOf(reply)}` });
    expect(hashOf(reply)).toMatch(/^[0-9a-f]{64}$/);
    expect(reply.res.headers.get('cache-control')).toBe('no-store');
  });

  it('ignores the Content-Type the client sends: the type comes from the content', async () => {
    const s = await start();
    const admin = await s.signedIn('adminy', { roles: ['admin'] });
    const png = await upload(s, admin, makePng(16), { 'content-type': 'text/html' });
    expect(png.body).toMatchObject({ mime: 'image/png' });
    const html = await upload(s, admin, text('<script>alert(1)</script>'), {
      'content-type': 'image/png',
    });
    expect(html.status).toBe(422);
    expect(html.res.headers.get('content-type')).toContain('application/problem+json');
    expect(JSON.stringify(html.body)).not.toContain('alert(1)');
  });

  it('takes a body above the 1 MiB of other routes, and refuses one above the upload ceiling (413)', async () => {
    const s = await start();
    const admin = await s.signedIn('adminy', { roles: ['admin'] });
    // 1.5 MiB of text is no image: 422 proves the body was read, which the server-wide limit forbids.
    expect((await upload(s, admin, new Uint8Array(1.5 * MiB))).status).toBe(422);
    expect((await upload(s, admin, new Uint8Array(8 * MiB + 1))).status).toBe(413);
    // A route without the override keeps the 1 MiB limit.
    const other = await s.call('PATCH', '/account/profile', {
      ...as(admin),
      body: JSON.stringify({ bio: 'x'.repeat(1.2 * MiB) }),
    });
    expect(other.status).toBe(413);
  });

  it('refuses an empty body and a request without a session', async () => {
    const s = await start();
    const admin = await s.signedIn('adminy', { roles: ['admin'] });
    expect((await upload(s, admin, new Uint8Array())).status).toBe(422);
    expect((await s.call('POST', '/files', { body: makePng(8) })).status).toBe(401);
  });

  it('is rate limited like the other strict routes', async () => {
    const s = await app.start({
      rateLimits: {
        default: { capacity: 100, refillPerSecond: 100 },
        strict: { capacity: 2, refillPerSecond: 0.001 },
      },
    });
    const admin = await s.signedIn('adminy', { roles: ['admin'] });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await upload(s, admin, makePng(8 + i))).status);
    expect(statuses).toContain(429);
  });
});

describe('GET /files/{hash}', () => {
  async function stored(s: Started, body: Uint8Array) {
    const admin = await s.signedIn('adminy', { roles: ['admin'] });
    return hashOf(await upload(s, admin, body));
  }

  it('serves a stored file to anyone, without a session, with the headers that make it safe', async () => {
    const s = await start();
    const png = makePng(16);
    const hash = await stored(s, png);
    const reply = await s.get(`/files/${hash}`);
    expect(reply.status).toBe(200);
    const h = reply.res.headers;
    expect(h.get('content-type')).toBe('image/png');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(h.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(h.get('etag')).toBe(`"${hash}"`);
    expect(h.get('content-disposition')).toBe('inline');
    expect(h.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(h.get('content-length')).toBe(String(reply.bytes.length));
    expect(createHash('sha256').update(reply.bytes).digest('hex')).toBe(hash);
  });

  it('answers 304 without a body when the caller has the file (the hash is the validator)', async () => {
    const s = await start();
    const hash = await stored(s, makePng(16));
    for (const header of [`"${hash}"`, `W/"${hash}"`, `"other", "${hash}"`, '*']) {
      const reply = await s.get(`/files/${hash}`, { headers: { 'if-none-match': header } });
      expect(reply.status, header).toBe(304);
      expect(reply.bytes.length).toBe(0);
      expect(reply.res.headers.get('etag')).toBe(`"${hash}"`);
    }
    const other = await s.get(`/files/${hash}`, { headers: { 'if-none-match': '"nope"' } });
    expect(other.status).toBe(200);
  });

  it('serves an SVG as an image with a policy that lets nothing in it run, and without its script', async () => {
    const s = await start();
    const hash = await stored(
      s,
      text(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="4" height="4"/></svg>',
      ),
    );
    const reply = await s.get(`/files/${hash}`);
    expect(reply.res.headers.get('content-type')).toBe('image/svg+xml');
    expect(reply.res.headers.get('content-security-policy')).toContain('sandbox');
    expect(reply.bytes.toString()).not.toMatch(/script|alert|onload/);
  });

  it('answers 404 for a hash nobody stored and 422 for one that is not a hash', async () => {
    const s = await start();
    expect((await s.get(`/files/${'0'.repeat(64)}`)).status).toBe(404);
    for (const bad of ['abc', 'A'.repeat(64), `${'0'.repeat(63)}g`, '..%2f..%2fetc%2fpasswd']) {
      expect((await s.get(`/files/${bad}`)).status, bad).toBe(422);
    }
  });

  it('does not depend on the caller: a signed-in user gets the same file', async () => {
    const s = await start();
    const hash = await stored(s, makePng(16));
    const user = await s.signedIn('plain');
    expect((await s.get(`/files/${hash}`, as(user))).status).toBe(200);
  });
});

describe('PUT and DELETE /account/avatar', () => {
  it('sets the caller’s own avatar, which then shows in the profile and is served', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const set = await s.call('PUT', '/account/avatar', { ...as(alice), body: makePng(24) });
    expect(set.status).toBe(200);
    const { avatarHash } = set.body as { avatarHash: string };
    expect(avatarHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await s.get('/account/profile', as(alice))).body).toMatchObject({ avatarHash });
    expect((await s.get(`/files/${avatarHash}`)).status).toBe(200);

    const removed = await s.call('DELETE', '/account/avatar', as(alice));
    expect(removed.body).toMatchObject({ avatarHash: null });
    expect((await s.kernel.pool.query('select 1 from blob_reference')).rows).toEqual([]);
  });

  it('has no user id: it changes the caller’s account and nobody else’s', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const bobby = await s.signedIn('bobby');
    await s.call('PUT', '/account/avatar', { ...as(bobby), body: makePng(30) });
    const before = (await s.get('/account/profile', as(bobby))).body;
    await s.call('PUT', '/account/avatar', { ...as(alice), body: makePng(31) });
    expect((await s.get('/account/profile', as(bobby))).body).toEqual(before);
    expect((await s.get('/account/profile', as(alice))).body).not.toEqual(before);
  });

  it('refuses a file that is not an image (422) and keeps the old avatar', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const first = await s.call('PUT', '/account/avatar', { ...as(alice), body: makePng(24) });
    const bad = await s.call('PUT', '/account/avatar', {
      ...as(alice),
      body: text('<script>alert(1)</script>'),
      headers: { 'content-type': 'image/png' },
    });
    expect(bad.status).toBe(422);
    expect((await s.get('/account/profile', as(alice))).body).toMatchObject({
      avatarHash: (first.body as { avatarHash: string }).avatarHash,
    });
  });

  it('is for sessions: an access token gets 403 even with the scope and an owner who may', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const made = await s.post('/tokens', {
      ...as(alice),
      body: { name: 'avatar', scopes: [...ALL_USER_SCOPES, 'core.blob.upload'].slice(0, 20) },
    });
    const { token } = made.body as { token: string };
    const bearer = { authorization: `Bearer ${token}` };
    expect(
      (await s.call('PUT', '/account/avatar', { headers: bearer, body: makePng(24) })).status,
    ).toBe(403);
    expect((await s.call('DELETE', '/account/avatar', { headers: bearer })).status).toBe(403);
    expect((await s.get('/account/profile', as(alice))).body).toMatchObject({ avatarHash: null });
    expect((await s.kernel.pool.query('select 1 from blob_blob')).rows).toEqual([]);
  });

  it('needs the CSRF token like every unsafe session route', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const reply = await s.call('PUT', '/account/avatar', {
      cookie: alice.cookie,
      body: makePng(24),
    });
    expect(reply.status).toBe(401); // a session without its CSRF token is not a session
    expect((await s.kernel.pool.query('select 1 from blob_blob')).rows).toEqual([]);
  });

  it('refuses a body above the upload ceiling (413)', async () => {
    const s = await start();
    const alice = await s.signedIn('alice');
    const reply = await s.call('PUT', '/account/avatar', {
      ...as(alice),
      body: new Uint8Array(8 * MiB + 1),
    });
    expect(reply.status).toBe(413);
  });
});
