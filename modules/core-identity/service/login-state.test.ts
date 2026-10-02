import { createHash } from 'node:crypto';
import { makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { challengeOf, constantTimeEqual, isVerifierFormat } from './login-state.ts';

const identity = useIdentity();
const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

describe('create', () => {
  it('hands out three different random values and stores only hashes of them', async () => {
    const { kernel, identity: id } = await identity.start();
    const fresh = await id.loginStates.create('corp');
    expect(new Set([fresh.state, fresh.nonce, fresh.verifier]).size).toBe(3);
    for (const value of [fresh.state, fresh.nonce, fresh.verifier]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    const { rows } = await kernel.pool.query('select * from identity_login_state');
    expect(rows).toEqual([
      expect.objectContaining({
        provider_id: 'corp',
        state_hash: sha256(fresh.state),
        nonce_hash: sha256(fresh.nonce),
        binding_hash: sha256(fresh.verifier), // the PKCE S256 challenge
        link_user_id: null,
      }) as unknown,
    ]);
    expect(JSON.stringify(rows)).not.toMatch(
      new RegExp([fresh.state, fresh.nonce, fresh.verifier].join('|')),
    );
    const row = rows[0] as { created_at: Date; expires_at: Date };
    expect(Math.abs(row.expires_at.getTime() - row.created_at.getTime() - 600_000)).toBeLessThan(
      5_000,
    );
  });

  it('remembers the user a link is for, and forgets the state with the user', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    await id.loginStates.create('corp', user.id);
    expect((await kernel.pool.query('select link_user_id from identity_login_state')).rows).toEqual(
      [{ link_user_id: user.id }],
    );
    await kernel.pool.query('delete from identity_user where id = $1', [user.id]);
    expect((await kernel.pool.query('select 1 from identity_login_state')).rows).toEqual([]);
  });
});

describe('consume', () => {
  it('returns what the callback needs and deletes the row, so a second try finds nothing', async () => {
    const { kernel, identity: id } = await identity.start();
    const fresh = await id.loginStates.create('corp');
    expect(await id.loginStates.consume(fresh.state)).toEqual({
      providerId: 'corp',
      nonceHash: sha256(fresh.nonce),
      bindingHash: challengeOf(fresh.verifier),
      linkUserId: null,
    });
    expect(await id.loginStates.consume(fresh.state)).toBeUndefined();
    expect((await kernel.pool.query('select 1 from identity_login_state')).rows).toEqual([]);
  });

  it('gives one of many parallel callers the state', async () => {
    const { identity: id } = await identity.start();
    const fresh = await id.loginStates.create('corp');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => id.loginStates.consume(fresh.state)),
    );
    expect(results.filter((r) => r !== undefined)).toHaveLength(1);
  });

  it('finds nothing for an expired state, and leaves a different state alone', async () => {
    const { kernel, identity: id } = await identity.start();
    const expired = await id.loginStates.create('corp');
    await kernel.pool.query(
      "update identity_login_state set expires_at = now() - interval '1 second'",
    );
    const live = await id.loginStates.create('corp');
    expect(await id.loginStates.consume(expired.state)).toBeUndefined();
    expect(await id.loginStates.consume(live.state)).toBeDefined();
  });

  it.each(['', 'nope', 'x'.repeat(100_000), "'; delete from identity_user; --", '\u0000'])(
    'finds nothing for a state that is %j',
    async (state) => {
      const { identity: id } = await identity.start();
      await id.loginStates.create('corp');
      expect(await id.loginStates.consume(state)).toBeUndefined();
    },
  );
});

describe('the helpers', () => {
  it('compare hashes in constant time and know the verifier format', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(isVerifierFormat('A'.repeat(43))).toBe(true);
    for (const bad of [
      '',
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}=`,
      `${'A'.repeat(42)} `,
    ]) {
      expect(isVerifierFormat(bad)).toBe(false);
    }
  });
});
