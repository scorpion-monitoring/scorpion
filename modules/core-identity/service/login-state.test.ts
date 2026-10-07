import { createHash } from 'node:crypto';
import { makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { challengeOf, constantTimeEqual, isVerifierFormat } from './login-state.ts';

const identity = useIdentity();
const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

describe('create', () => {
  it('hands out three different random values and stores only hashes of them [ASVS-10.1.2]', async () => {
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

describe('purpose', () => {
  it('is login without a user, link with one, and reauth with a user and a session', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    const session = await id.sessions.create(user.id);
    await id.loginStates.create('corp');
    await id.loginStates.create('corp', user.id);
    await id.loginStates.create('corp', user.id, session.sessionId);
    expect(
      (
        await kernel.pool.query(
          'select purpose, link_user_id is not null as has_user, reauth_session_id is not null as has_session from identity_login_state order by purpose',
        )
      ).rows,
    ).toEqual([
      { purpose: 'link', has_user: true, has_session: false },
      { purpose: 'login', has_user: false, has_session: false },
      { purpose: 'reauth', has_user: true, has_session: true },
    ]);
  });

  it('is handed back by consume, with the session and the moment the flow began', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    const session = await id.sessions.create(user.id);
    const began = new Date('2026-10-06T09:00:00Z');
    const fresh = await id.loginStates.create('corp', user.id, session.sessionId, began);
    // Consumed within its life, so the clock of the database decides: keep the row alive.
    await kernel.pool.query(
      "update identity_login_state set expires_at = now() + interval '5 minutes'",
    );
    expect(await id.loginStates.consume(fresh.state)).toMatchObject({
      purpose: 'reauth',
      linkUserId: user.id,
      reauthSessionId: session.sessionId,
      createdAt: began,
    });
  });

  it('cannot be stored in a combination the callback would misread (a constraint)', async () => {
    const { kernel } = await identity.start();
    const insert = (purpose: string, withUser: boolean) =>
      kernel.pool.query(
        `insert into identity_login_state (id, provider_id, state_hash, nonce_hash, binding_hash, purpose, link_user_id, expires_at)
         values (gen_random_uuid(), 'idp', gen_random_uuid()::text, 'n', 'b', $1,
                 ${withUser ? '(select id from identity_user limit 1)' : 'null'}, now() + interval '5 minutes')`,
        [purpose],
      );
    await makeUser(kernel.pool);
    await expect(insert('reauth', true)).rejects.toThrow(/purpose_fields/); // no session
    await expect(insert('link', false)).rejects.toThrow(/purpose_fields/); // no user
    await expect(insert('login', true)).rejects.toThrow(/purpose_fields/); // a user, but a plain login
    await expect(insert('sudo', false)).rejects.toThrow(/purpose_(known|fields)/);
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
      purpose: 'login',
      linkUserId: null,
      reauthSessionId: null,
      createdAt: expect.any(Date) as unknown,
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
