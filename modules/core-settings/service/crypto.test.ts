import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decrypt,
  encrypt,
  keyId,
  loadKeyRing,
  NONCE_BYTES,
  parseKey,
  SecretDecryptError,
  TAG_BYTES,
} from './crypto.ts';

const newKey = () => randomBytes(32).toString('base64');
const key = (text = newKey()) => parseKey(text)!;

describe('parseKey', () => {
  const good = newKey();
  it.each([
    ['32 random bytes', good, true],
    ['with surrounding whitespace', ` ${good}\n`, true],
    ['undefined', undefined, false],
    ['empty', '', false],
    ['31 bytes', randomBytes(31).toString('base64'), false],
    ['33 bytes', randomBytes(33).toString('base64'), false],
    ['hex', randomBytes(32).toString('hex'), false],
    ['base64url characters', randomBytes(32).toString('base64url') + 'x', false],
    ['text', 'not a key at all', false],
    ['padding stripped', good.replace(/=+$/, ''), false],
  ])('%s', (_name, text, valid) => {
    expect(parseKey(text) !== undefined).toBe(valid);
  });

  it('gives a key the same id every time, and different keys different ids', () => {
    const text = newKey();
    expect(key(text).id).toBe(key(text).id);
    expect(key().id).not.toBe(key().id);
    expect(key(text).id).toMatch(/^[0-9a-f]{16}$/);
    expect(keyId(key(text).bytes)).toBe(key(text).id);
  });
});

describe('encrypt and decrypt', () => {
  it.each([
    ['a short value', 's3cret'],
    ['an empty-looking value', ' '],
    ['unicode', 'pässwörd-日本語-🔑'],
    ['a long value', 'x'.repeat(4096)],
  ])('round-trips %s', (_name, value) => {
    const k = key();
    const sealed = encrypt(k, 'oidc.keycloak', value);
    expect(sealed.nonce).toHaveLength(NONCE_BYTES);
    expect(sealed.keyId).toBe(k.id);
    expect(sealed.ciphertext.length).toBe(Buffer.byteLength(value) + TAG_BYTES);
    if (value.length >= 4) expect(sealed.ciphertext.includes(Buffer.from(value))).toBe(false);
    expect(decrypt(k, 'oidc.keycloak', sealed)).toBe(value);
  });

  it('uses a new nonce every time, so equal values give different ciphertexts', () => {
    const k = key();
    const nonces = new Set<string>();
    const ciphertexts = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const sealed = encrypt(k, 'a', 'same');
      nonces.add(sealed.nonce.toString('hex'));
      ciphertexts.add(sealed.ciphertext.toString('hex'));
    }
    expect(nonces.size).toBe(50);
    expect(ciphertexts.size).toBe(50);
  });

  it.each([
    ['another key', (s: ReturnType<typeof encrypt>) => ({ ...s }), key(), 'a'],
    ['another name', (s: ReturnType<typeof encrypt>) => ({ ...s }), undefined, 'b'],
    [
      'a changed byte',
      (s: ReturnType<typeof encrypt>) => ({
        ...s,
        ciphertext: Buffer.concat([Buffer.from([s.ciphertext[0]! ^ 1]), s.ciphertext.subarray(1)]),
      }),
      undefined,
      'a',
    ],
    [
      'a changed tag',
      (s: ReturnType<typeof encrypt>) => ({
        ...s,
        ciphertext: Buffer.concat([
          s.ciphertext.subarray(0, -1),
          Buffer.from([s.ciphertext.at(-1)! ^ 1]),
        ]),
      }),
      undefined,
      'a',
    ],
    [
      'a short nonce',
      (s: ReturnType<typeof encrypt>) => ({ ...s, nonce: s.nonce.subarray(1) }),
      undefined,
      'a',
    ],
    [
      'a truncated ciphertext',
      (s: ReturnType<typeof encrypt>) => ({ ...s, ciphertext: Buffer.alloc(3) }),
      undefined,
      'a',
    ],
  ])('refuses %s with a fixed message that holds no material', (_name, tamper, other, name) => {
    const k = key();
    const sealed = encrypt(k, 'a', 'the-value');
    let failure: unknown;
    try {
      decrypt(other ?? k, name, tamper(sealed));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SecretDecryptError);
    const text = String((failure as Error).message) + String((failure as Error).stack);
    expect(text).not.toContain('the-value');
    expect(text).not.toContain(k.bytes.toString('base64'));
  });
});

describe('loadKeyRing', () => {
  const a = newKey();
  const b = newKey();

  it('holds one key and writes with it', () => {
    const { ring, problems } = loadKeyRing({ SECRETS_KEY: a });
    expect(problems).toEqual([]);
    expect(ring!.writeKey.id).toBe(key(a).id);
    expect(ring!.nextKey).toBeUndefined();
    expect(ring!.find(key(a).id)).toBeDefined();
    expect(ring!.find(key(b).id)).toBeUndefined();
  });

  it('holds both keys during a rotation and writes with the next one', () => {
    const { ring } = loadKeyRing({ SECRETS_KEY: a, SECRETS_KEY_NEXT: b });
    expect(ring!.writeKey.id).toBe(key(b).id);
    expect(ring!.nextKey!.id).toBe(key(b).id);
    expect(ring!.find(key(a).id)).toBeDefined();
    expect(ring!.find(key(b).id)).toBeDefined();
  });

  it.each([
    ['a missing key', {}, /SECRETS_KEY is not set.*openssl rand -base64 32/],
    ['an empty key', { SECRETS_KEY: '' }, /SECRETS_KEY is not set/],
    [
      'an invalid key',
      { SECRETS_KEY: 'short' },
      /SECRETS_KEY is not valid.*openssl rand -base64 32/,
    ],
    [
      'an invalid next key',
      { SECRETS_KEY: a, SECRETS_KEY_NEXT: 'short' },
      /SECRETS_KEY_NEXT is not valid/,
    ],
    ['the same key twice', { SECRETS_KEY: a, SECRETS_KEY_NEXT: a }, /same key/],
  ])('reports %s without echoing a value', (_name, env, message) => {
    const { ring, problems } = loadKeyRing(env);
    expect(ring).toBeUndefined();
    expect(problems.join('\n')).toMatch(message);
    expect(problems.join('\n')).not.toContain(a);
  });
});
