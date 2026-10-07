// Defect 4 (FEATURES §5): the old app issued JWT sessions that ignored the session table, so a
// copied cookie kept working after logout. Sessions are opaque ids checked against the database.
// Never weaken this test.
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();

describe('defect 4: a copied session cookie stops working', () => {
  // A long cache on purpose: the revocation must not wait for it to run out in this process.
  const options = { sessionCacheTtlMs: 60_000 };

  it('after logout [ASVS-7.4.1]', async () => {
    const { get, post, signedIn } = await app.start(options);
    const { cookie, csrf } = await signedIn('alice');
    const copy = cookie; // what an attacker who read the cookie holds

    expect((await get('/auth/me', { cookie: copy })).status).toBe(200);
    expect((await post('/auth/logout', { cookie, csrf })).status).toBe(204);

    const replay = await get('/auth/me', { cookie: copy });
    expect(replay.status).toBe(401);
    expect(
      (replay.res.headers.get('content-type') ?? '').startsWith('application/problem+json'),
    ).toBe(true);
  });

  it('after logout even when the cookie is replayed on a state-changing request', async () => {
    const { post, signedIn } = await app.start(options);
    const { cookie, csrf } = await signedIn('alice');
    await post('/auth/logout', { cookie, csrf });
    expect((await post('/auth/logout-all', { cookie, csrf })).status).toBe(401);
  });

  it('after "log out everywhere", for every session of the user and only theirs [ASVS-7.4.1]', async () => {
    const { get, post, signedIn } = await app.start(options);
    const laptop = await signedIn('alice');
    const phone = await post('/auth/login', { body: { username: 'alice', password: PASSWORD } });
    const phoneCookie = phone.cookie!;
    const bob = await signedIn('bobby');
    expect((await get('/auth/me', { cookie: laptop.cookie })).status).toBe(200);
    expect((await get('/auth/me', { cookie: phoneCookie })).status).toBe(200);

    const out = await post('/auth/logout-all', { cookie: laptop.cookie, csrf: laptop.csrf });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ revoked: 2 });

    expect((await get('/auth/me', { cookie: laptop.cookie })).status).toBe(401);
    expect((await get('/auth/me', { cookie: phoneCookie })).status).toBe(401);
    expect((await get('/auth/me', { cookie: bob.cookie })).status).toBe(200);
  });

  it('is decided by the database: a session revoked in the table is refused once the cache has run out [ASVS-7.2.1]', async () => {
    const { get, kernel, signedIn } = await app.start({ sessionCacheTtlMs: 0 });
    const { cookie } = await signedIn('alice');
    expect((await get('/auth/me', { cookie })).status).toBe(200);
    await kernel.pool.query('update identity_session set revoked_at = now()');
    expect((await get('/auth/me', { cookie })).status).toBe(401);
  });

  it('is refused when the user is deleted, even though the session row is untouched [ASVS-7.4.2]', async () => {
    const { get, kernel, signedIn } = await app.start({ sessionCacheTtlMs: 0 });
    const { cookie } = await signedIn('alice');
    await kernel.pool.query('update identity_user set deleted_at = now()');
    expect((await get('/auth/me', { cookie })).status).toBe(401);
  });

  it('does not accept a cookie that was never issued, or a made-up one of the right length', async () => {
    const { get } = await app.start(options);
    for (const cookie of ['', 'x', 'A'.repeat(43), '../../etc/passwd']) {
      expect((await get('/auth/me', { cookie })).status).toBe(401);
    }
  });
});
