// The `default` rate limit by session, through the whole pipeline with the real authenticator (M12a sprint 5): two people behind one address no
// longer share a budget, the address stays a ceiling, a token and a forged cookie are charged as before, and the 429 still says when to
// come back. The pure parts (the bucket keys) are in pipeline/rate-limit.test.ts.
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const ADDRESS = '198.51.100.20';
const LIMITS = {
  default: { capacity: 5, refillPerSecond: 0.001 },
  strict: { capacity: 1000, refillPerSecond: 100 },
};

describe('[ASVS-6.1.1] the default bucket of a signed-in caller is their session', () => {
  it('refuses the busy person with Retry-After and leaves the other person on the same address alone', async () => {
    const s = await app.start({ rateLimits: LIMITS });
    // Signing in is on the strict route and costs nothing here; the sessions are real rows.
    const ann = await s.signedIn('ann-limits');
    const bob = await s.signedIn('bob-limits');
    const read = (who: { cookie: string }) =>
      s.get('/auth/me', { cookie: who.cookie, peer: ADDRESS });

    const annStatuses: number[] = [];
    for (let i = 0; i < 8; i++) annStatuses.push((await read(ann)).status);
    expect(annStatuses.filter((status) => status === 200)).toHaveLength(5);
    const refused = await read(ann);
    expect(refused.status).toBe(429);
    expect(Number(refused.res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(refused.res.headers.get('content-type')).toContain('application/problem+json');

    // Bob, from the same address, has a budget of his own.
    for (let i = 0; i < 5; i++) expect((await read(bob)).status).toBe(200);
    expect((await read(bob)).status).toBe(429);
  });

  it('keeps the bucket of a session across addresses, and names the session by a hash only', async () => {
    const s = await app.start({ rateLimits: LIMITS });
    const ann = await s.signedIn('ann-roaming');
    for (let i = 0; i < 5; i++)
      expect(
        (await s.get('/auth/me', { cookie: ann.cookie, peer: `192.0.2.${i + 1}` })).status,
      ).toBe(200);
    expect((await s.get('/auth/me', { cookie: ann.cookie, peer: '192.0.2.99' })).status).toBe(429);

    const { rows } = await s.kernel.pool.query<{ key: string }>(
      'select key from kernel_rate_bucket order by key',
    );
    const keys = rows.map((row) => row.key).join('\n');
    expect(keys).toContain('session:default:');
    expect(keys).not.toContain(ann.cookie.split('=')[1]!);
    const sessionRows = await s.kernel.pool.query<{ id: string }>(
      'select id from identity_session',
    );
    for (const { id } of sessionRows.rows) expect(keys).not.toContain(id);
  });

  it('charges a stale or forged cookie to the address, never to a bucket of its own', async () => {
    const s = await app.start({ rateLimits: LIMITS });
    const forged = '__Host-session=' + 'A'.repeat(43);
    for (let i = 0; i < 20; i++) {
      const reply = await s.get('/auth/me', { cookie: forged, peer: ADDRESS });
      expect(reply.status).toBe(401);
    }
    const { rows } = await s.kernel.pool.query<{ key: string }>(
      'select key from kernel_rate_bucket',
    );
    expect(rows.map((row) => row.key.split(':')[0])).toEqual(['ip-session']);
  });

  it('leaves an anonymous caller on the address bucket', async () => {
    const s = await app.start({ rateLimits: LIMITS });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await s.get('/auth/me', { peer: ADDRESS })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
  });
});
