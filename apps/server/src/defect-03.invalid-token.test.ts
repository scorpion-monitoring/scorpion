// Defect 3 (FEATURES §5): the old app answered a malformed API key with a 500. A token that is
// malformed, unknown, wrong, expired or revoked is a 401 problem+json, on every route that needs a
// caller, and never an error of ours. Never weaken this test.
import { makeToken, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { ALL_USER_SCOPES, PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();

const SECRET = 'A'.repeat(43);
// Every row is something a client could send as a key. None may end in a 500.
const MALFORMED: [string, string][] = [
  ['an empty key', ''],
  ['a space', ' '],
  ['plain text', 'garbage'],
  ['the mark only', 'scp_'],
  ['the mark and one separator', 'scp__'],
  ['no secret', 'scp_abcd1234_'],
  ['no separator after the prefix', `scp_abcd1234${SECRET}x`],
  ['no mark', `abcd1234_${SECRET}`],
  ['a wrong mark', `pat_abcd1234_${SECRET}`],
  ['an upper-case mark', `SCP_abcd1234_${SECRET}`],
  ['a short prefix', `scp_abcd123_${SECRET}x`],
  ['a long prefix', `scp_abcd12345_${SECRET.slice(1)}`],
  ['a short secret', `scp_abcd1234_${SECRET.slice(1)}`],
  ['a long secret', `scp_abcd1234_${SECRET}A`],
  ['a non-ASCII prefix', `scp_abcdé234_${SECRET}`],
  ['a non-ASCII secret', `scp_abcd1234_${'é'.repeat(43)}`],
  ['SQL in the prefix', "scp_' or 1=1_" + SECRET],
  ['a path-like key', '../../etc/passwd'],
  ['a key of 10 000 characters', 'A'.repeat(10_000)],
  ['a key of 10 000 token marks', 'scp_'.repeat(2_500)],
  ['a well-formed key nobody owns', `scp_abcd1234_${SECRET}`],
];

const HEADERS: [string, (key: string) => Record<string, string>][] = [
  ['Authorization: Bearer', (key) => ({ authorization: `Bearer ${key}` })],
  ['X-API-Key', (key) => ({ 'x-api-key': key })],
];

describe('defect 3: a bad key is a 401, never a 500', () => {
  for (const [header, headers] of HEADERS) {
    it.each(MALFORMED)(`${header}: %s`, async (_name, key) => {
      const { get, post } = await app.start();
      // A route that needs a caller, read and write; the permission is granted to everyone.
      for (const reply of [
        await get('/auth/me', { headers: headers(key) }),
        await post('/auth/logout', { headers: headers(key) }),
        await get('/tokens', { headers: headers(key) }),
      ]) {
        expect(reply.status).toBe(401);
        expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
        expect(reply.body).toMatchObject({ status: 401, title: 'Unauthorized' });
        // The answer repeats nothing the caller sent.
        if (key.trim().length >= 8)
          expect(JSON.stringify(reply.body)).not.toContain(key.slice(0, 20));
      }
    });

    it(`${header}: a bad key on a public route means "not signed in", not an error`, async () => {
      const { post } = await app.start();
      const reply = await post('/auth/register', {
        headers: headers('garbage'),
        body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
      });
      expect(reply.status).toBe(202);
    });
  }

  it('answers an unknown token, a wrong secret, an expired and a revoked token the same way', async () => {
    const { kernel, get, signedIn, post } = await app.start({ tokenCacheTtlMs: 0 });
    const { user, cookie, csrf } = await signedIn('alice');
    const made = await post('/tokens', {
      cookie,
      csrf,
      body: { name: 'ci', scopes: ALL_USER_SCOPES },
    });
    const { token } = made.body as { token: string };
    const prefix = token.slice(4, 12);

    const expired = await makeToken(kernel.pool, user, { expiresAt: new Date(Date.now() - 1000) });
    const revoked = await makeToken(kernel.pool, user, { revoked: true });
    const stranger = await makeUser(kernel.pool, { status: 'rejected' });
    const ofStranger = await makeToken(kernel.pool, stranger);
    const attempts = [
      `scp_${prefix}_${SECRET}`, // wrong secret, right prefix
      `scp_ZZZZZZZZ_${SECRET}`, // unknown prefix
      expired.token,
      revoked.token,
      ofStranger.token,
    ];
    const bodies = new Set<string>();
    for (const key of attempts) {
      const reply = await get('/auth/me', { headers: { authorization: `Bearer ${key}` } });
      expect(reply.status).toBe(401);
      const rest = { ...(reply.body as Record<string, unknown>), requestId: undefined };
      bodies.add(JSON.stringify(rest));
    }
    expect(bodies.size).toBe(1);
  });
});
