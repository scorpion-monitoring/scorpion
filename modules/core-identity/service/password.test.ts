import { hash, parseOptions } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  passwordHashParams,
  PRODUCTION_PARAMS,
  TEST_PARAMS,
  verifyPassword,
} from './password.ts';

describe('password hashing parameters', () => {
  it('pins the production parameters: argon2id, 64 MiB, 3 passes, 1 lane, 32 bytes', () => {
    expect(PRODUCTION_PARAMS).toEqual({
      algorithm: 2, // Argon2id
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
    });
    expect(Object.isFrozen(PRODUCTION_PARAMS)).toBe(true);
  });

  it.each([undefined, 'production', 'development', 'staging', 'Test', ''])(
    'uses the production parameters when NODE_ENV is %j',
    (nodeEnv) => {
      expect(passwordHashParams(nodeEnv)).toBe(PRODUCTION_PARAMS);
    },
  );

  it('uses cheap parameters only when NODE_ENV is "test"', () => {
    expect(passwordHashParams('test')).toBe(TEST_PARAMS);
    expect(TEST_PARAMS.memoryCost).toBeLessThan(PRODUCTION_PARAMS.memoryCost);
    expect(TEST_PARAMS.algorithm).toBe(PRODUCTION_PARAMS.algorithm);
  });

  it('writes the production parameters into the hash it makes', async () => {
    const phc = await hash('some password', PRODUCTION_PARAMS);
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(parseOptions(phc)).toMatchObject({ memoryCost: 65_536, timeCost: 3, parallelism: 1 });
  }, 20_000);
});

describe('hashing and verifying', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery stapl')).toBe(false);
    expect(await verifyPassword(stored, 'Correct horse battery staple')).toBe(false);
    expect(await verifyPassword(stored, '')).toBe(false);
  });

  it('salts: the same password gives two different hashes, and both verify', async () => {
    const [one, two] = await Promise.all([
      hashPassword('same password'),
      hashPassword('same password'),
    ]);
    expect(one).not.toBe(two);
    expect(await verifyPassword(one, 'same password')).toBe(true);
    expect(await verifyPassword(two, 'same password')).toBe(true);
  });

  it('does not put the password in the hash', async () => {
    expect(await hashPassword('plain-text-marker')).not.toContain('plain-text-marker');
  });

  it('verifies a hash made with other parameters (an old hash after the cost was raised)', async () => {
    const old = await hash('migrated', { ...TEST_PARAMS, memoryCost: 2_048, timeCost: 2 });
    expect(await verifyPassword(old, 'migrated')).toBe(true);
  });

  it.each([
    '',
    'not a hash',
    '$argon2id$',
    '$argon2id$v=19$m=1,t=1,p=1$bad$bad',
    '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
  ])('is a failed check, not an exception, for the stored value %j', async (stored) => {
    expect(await verifyPassword(stored, 'anything')).toBe(false);
  });
});
