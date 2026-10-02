// The id_token checks (defect 5), table-driven: each row breaks exactly one thing.
import { createHash } from 'node:crypto';
import { SignJWT, exportJWK, exportSPKI, generateKeyPair, type JSONWebKeySet } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { InvalidIdToken, type IdTokenFailure } from './oidc-errors.ts';
import { verifyIdToken } from './oidc-token.ts';

const ISSUER = 'https://idp.example.org/realms/test';
const CLIENT = 'scorpion';
const NONCE = 'a-nonce-value';
const NOW = new Date('2026-10-02T12:00:00Z');
const now = Math.floor(NOW.getTime() / 1000);
const nonceHash = createHash('sha256').update(NONCE).digest('base64url');
const expected = { issuer: ISSUER, clientId: CLIENT, nonceHash, now: NOW };

let good: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
let keys: JSONWebKeySet;

beforeAll(async () => {
  good = await generateKeyPair('RS256', { extractable: true });
  other = await generateKeyPair('RS256', { extractable: true });
  keys = { keys: [{ ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
});

const without = (name: string): Record<string, unknown> => {
  const claims = baseClaims();
  delete claims[name];
  return claims;
};
const baseClaims = (): Record<string, unknown> => ({
  iss: ISSUER,
  aud: CLIENT,
  sub: 'user-1',
  iat: now - 5,
  exp: now + 300,
  nonce: NONCE,
  email: 'a@example.org',
  email_verified: true,
  preferred_username: 'alice',
});

async function sign(claims: Record<string, unknown>, key = good.privateKey, kid = 'k1') {
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid }).sign(key);
}
const b64 = (v: string) => Buffer.from(v).toString('base64url');

describe('verifyIdToken', () => {
  it('accepts a good token and returns only the claims we use', async () => {
    const claims = await verifyIdToken(await sign(baseClaims()), keys, expected);
    expect(claims).toEqual({
      subject: 'user-1',
      email: 'a@example.org',
      emailVerified: true,
      preferredUsername: 'alice',
    });
  });

  it('accepts several audiences when azp is us, and an azp that is us with one audience', async () => {
    await verifyIdToken(
      await sign({ ...baseClaims(), aud: [CLIENT, 'other'], azp: CLIENT }),
      keys,
      expected,
    );
    await verifyIdToken(await sign({ ...baseClaims(), azp: CLIENT }), keys, expected);
  });

  it('accepts clock differences within the skew', async () => {
    await verifyIdToken(await sign({ ...baseClaims(), exp: now - 30 }), keys, expected);
    await verifyIdToken(
      await sign({ ...baseClaims(), iat: now + 30, nbf: now + 30 }),
      keys,
      expected,
    );
  });

  const cases: [string, () => Promise<string>, IdTokenFailure][] = [
    ['an expired token', () => sign({ ...baseClaims(), exp: now - 120 }), 'expired'],
    [
      'a token that is not valid yet',
      () => sign({ ...baseClaims(), nbf: now + 600 }),
      'not-yet-valid',
    ],
    [
      'a token issued in the future',
      () => sign({ ...baseClaims(), iat: now + 600, exp: now + 900 }),
      'iat',
    ],
    ['no exp', () => sign(without('exp')), 'claims'],
    ['no iat', () => sign(without('iat')), 'claims'],
    ['no sub', () => sign(without('sub')), 'claims'],
    ['an empty sub', () => sign({ ...baseClaims(), sub: '' }), 'claims'],
    ['a number for sub', () => sign({ ...baseClaims(), sub: 7 }), 'claims'],
    ['a sub that is too long', () => sign({ ...baseClaims(), sub: 'x'.repeat(256) }), 'claims'],
    [
      'the wrong issuer',
      () => sign({ ...baseClaims(), iss: 'https://evil.example.org' }),
      'issuer',
    ],
    [
      'the issuer with a trailing slash',
      () => sign({ ...baseClaims(), iss: `${ISSUER}/` }),
      'issuer',
    ],
    ['the wrong audience', () => sign({ ...baseClaims(), aud: 'someone-else' }), 'audience'],
    ['an audience list without us', () => sign({ ...baseClaims(), aud: ['a', 'b'] }), 'audience'],
    [
      'several audiences and no azp',
      () => sign({ ...baseClaims(), aud: [CLIENT, 'other'] }),
      'azp',
    ],
    [
      'several audiences and another azp',
      () => sign({ ...baseClaims(), aud: [CLIENT, 'other'], azp: 'other' }),
      'azp',
    ],
    ['an azp that is not us', () => sign({ ...baseClaims(), azp: 'other' }), 'azp'],
    ['a different nonce', () => sign({ ...baseClaims(), nonce: 'tampered' }), 'nonce'],
    ['no nonce', () => sign(without('nonce')), 'nonce'],
    ['a nonce that is not text', () => sign({ ...baseClaims(), nonce: 5 }), 'nonce'],
    ['a signature by another key', () => sign(baseClaims(), other.privateKey), 'signature'],
    [
      'a kid that is not in the key set',
      () => sign(baseClaims(), good.privateKey, 'unknown'),
      'unknown-key',
    ],
    [
      'alg none',
      () => Promise.resolve(`${b64('{"alg":"none"}')}.${b64(JSON.stringify(baseClaims()))}.`),
      'algorithm',
    ],
    [
      'alg none with a kid',
      () =>
        Promise.resolve(
          `${b64('{"alg":"none","kid":"k1"}')}.${b64(JSON.stringify(baseClaims()))}.`,
        ),
      'algorithm',
    ],
    [
      'HS256 keyed with the public key (algorithm confusion)',
      async () =>
        new SignJWT(baseClaims())
          .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
          .sign(new TextEncoder().encode(await exportSPKI(good.publicKey))),
      'algorithm',
    ],
    ['a token that is not a JWT', () => Promise.resolve('not.a.jwt'), 'malformed'],
    ['an empty token', () => Promise.resolve(''), 'malformed'],
    ['a token with two parts', () => Promise.resolve('aaa.bbb'), 'malformed'],
    [
      'a payload that is not JSON (the signature fails first)',
      () => Promise.resolve(`${b64('{"alg":"RS256"}')}.${b64('nope')}.c2ln`),
      'signature',
    ],
  ];

  it.each(cases)('refuses %s', async (_name, make, reason) => {
    const error = await verifyIdToken(await make(), keys, expected).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidIdToken);
    expect((error as InvalidIdToken).reason).toBe(reason);
    expect((error as InvalidIdToken).status).toBe(401);
  });

  it('refuses a token whose signature bytes were changed', async () => {
    const token = await sign(baseClaims());
    const [h, p, s] = token.split('.');
    const flipped = `${s!.slice(0, -4)}${s!.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    await expect(verifyIdToken(`${h}.${p}.${flipped}`, keys, expected)).rejects.toBeInstanceOf(
      InvalidIdToken,
    );
  });

  it('refuses a token whose payload was swapped under the old signature', async () => {
    const [h, , s] = (await sign(baseClaims())).split('.');
    const forged = b64(JSON.stringify({ ...baseClaims(), sub: 'admin' }));
    await expect(verifyIdToken(`${h}.${forged}.${s}`, keys, expected)).rejects.toMatchObject({
      reason: 'signature',
    });
  });

  it('counts email_verified only when it is the boolean true', async () => {
    for (const value of ['true', 1, 'yes', null, undefined]) {
      const claims = await verifyIdToken(
        await sign({ ...baseClaims(), email_verified: value }),
        keys,
        expected,
      );
      expect(claims.emailVerified).toBe(false);
    }
  });

  it('ignores claims that are not text or too long', async () => {
    const claims = await verifyIdToken(
      await sign({ ...baseClaims(), email: 42, preferred_username: 'x'.repeat(300) }),
      keys,
      expected,
    );
    expect(claims.email).toBeUndefined();
    expect(claims.preferredUsername).toBeUndefined();
  });

  it('refuses every key in a key set it cannot use, without throwing anything else', async () => {
    const broken: JSONWebKeySet = { keys: [{ kty: 'RSA', kid: 'k1', alg: 'RS256' }] };
    const error = await verifyIdToken(await sign(baseClaims()), broken, expected).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(InvalidIdToken);
  });
});
