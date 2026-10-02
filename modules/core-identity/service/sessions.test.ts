import { makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { SESSION_LIFETIME_MS } from './sessions.ts';
import { hashSessionId, newSessionId } from './session-id.ts';

const identity = useIdentity();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function rows(kernel: { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } }) {
  return (await kernel.pool.query('select * from identity_session')).rows as Record<
    string,
    unknown
  >[];
}

describe('create', () => {
  it('stores only the SHA-256 of the id and a 7-day expiry', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    const now = new Date('2026-10-02T10:00:00Z');

    const created = await id.sessions.create(user.id, undefined, now);

    expect(created.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt).toEqual(new Date(now.getTime() + SESSION_LIFETIME_MS));
    const [row] = await rows(kernel);
    expect(row).toMatchObject({
      user_id: user.id,
      secret_hash: hashSessionId(created.id),
      revoked_at: null,
    });
    expect(JSON.stringify(row)).not.toContain(created.id);
  });

  it('is part of the caller’s transaction: a rollback leaves no session', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    await expect(
      kernel.db.tx(async (tx) => {
        await id.sessions.create(user.id, tx);
        throw new Error('changed my mind');
      }),
    ).rejects.toThrow('changed my mind');
    expect(await rows(kernel)).toEqual([]);
  });
});

describe('resolve', () => {
  it('finds the user behind a live session', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool, { username: 'alice' });
    const { id: sessionId } = await id.sessions.create(user.id);
    expect(await id.sessions.resolve(sessionId)).toEqual({
      userId: user.id,
      username: 'alice',
      renewed: false,
    });
  });

  it.each([
    ['an unknown id', () => newSessionId()],
    ['an empty string', () => ''],
    ['a malformed id', () => "'; drop table identity_session; --"],
    ['an id with the right length and the wrong alphabet', () => '!'.repeat(43)],
  ])('refuses %s', async (_name, make) => {
    const { identity: id } = await identity.start();
    expect(await id.sessions.resolve(make())).toBeUndefined();
  });

  it('refuses an expired session', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id);
    const later = new Date(created.expiresAt.getTime() + 1000);
    expect(await id.sessions.resolve(created.id, later)).toBeUndefined();
  });

  it.each([
    ['pending', { status: 'pending' as const }],
    ['rejected', { status: 'rejected' as const }],
    ['soft-deleted', { deleted: true }],
  ])('refuses a session whose user is %s', async (_name, overrides) => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const user = await makeUser(kernel.pool, overrides);
    const { id: sessionId } = await id.sessions.create(user.id);
    expect(await id.sessions.resolve(sessionId)).toBeUndefined();
  });

  it('slides the expiry forward, but not on every request', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id);

    // Used a moment after creation: nothing is written.
    expect((await id.sessions.resolve(created.id))?.renewed).toBe(false);
    const [before] = await rows(kernel);

    // Used three days later: the expiry moves to seven days from then.
    const later = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    expect((await id.sessions.resolve(created.id, later))?.renewed).toBe(true);
    const [after] = await rows(kernel);
    expect((after!.expires_at as Date).getTime()).toBe(later.getTime() + SESSION_LIFETIME_MS);
    expect((after!.expires_at as Date).getTime()).toBeGreaterThan(
      (before!.expires_at as Date).getTime(),
    );
  });

  it('does not slide a session that is revoked', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id);
    await id.sessions.revoke(created.id);
    const later = new Date(Date.now() + 3600 * 1000);
    expect(await id.sessions.resolve(created.id, later)).toBeUndefined();
    expect((await rows(kernel))[0]!.revoked_at).not.toBeNull();
  });
});

describe('revoking (defect 4)', () => {
  it('revoke ends one session at once in this process, even with a long cache', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    const user = await makeUser(kernel.pool);
    const one = await id.sessions.create(user.id);
    const two = await id.sessions.create(user.id);
    expect(await id.sessions.resolve(one.id)).toBeDefined(); // now cached

    await id.sessions.revoke(one.id);

    expect(await id.sessions.resolve(one.id)).toBeUndefined();
    expect(await id.sessions.resolve(two.id)).toBeDefined();
  });

  it('revokeAll ends every session of the user and only theirs, and counts them', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    const alice = await makeUser(kernel.pool);
    const bob = await makeUser(kernel.pool);
    const a1 = await id.sessions.create(alice.id);
    const a2 = await id.sessions.create(alice.id);
    const b1 = await id.sessions.create(bob.id);
    for (const s of [a1, a2, b1]) await id.sessions.resolve(s.id); // all cached

    expect(await id.sessions.revokeAll(alice.id)).toBe(2);

    expect(await id.sessions.resolve(a1.id)).toBeUndefined();
    expect(await id.sessions.resolve(a2.id)).toBeUndefined();
    expect(await id.sessions.resolve(b1.id)).toBeDefined();
    expect(await id.sessions.revokeAll(alice.id)).toBe(0); // nothing left to revoke
  });

  it('ignores an id it cannot parse and one it does not know', async () => {
    const { identity: id } = await identity.start();
    await expect(id.sessions.revoke('nonsense')).resolves.toBeUndefined();
    await expect(id.sessions.revoke(newSessionId())).resolves.toBeUndefined();
  });
});

describe('the cache', () => {
  it('answers from memory within the TTL and asks the database after it', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 150 });
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id);
    expect(await id.sessions.resolve(created.id)).toBeDefined();

    // Revoked behind this process's back (as another process would do).
    await kernel.pool.query('update identity_session set revoked_at = now()');
    expect(await id.sessions.resolve(created.id)).toBeDefined(); // the bounded staleness

    await sleep(200);
    expect(await id.sessions.resolve(created.id)).toBeUndefined(); // the database is asked again
  });

  it('is the staleness bound across processes: B accepts a session A revoked for at most the TTL', async () => {
    const url = await identity.server().createDatabase();
    const a = await identity.start({ databaseUrl: url, sessionCacheTtlMs: 150 });
    const b = await identity.start({ databaseUrl: url, sessionCacheTtlMs: 150 });
    const user = await makeUser(a.kernel.pool);
    const created = await a.identity.sessions.create(user.id);
    expect(await b.identity.sessions.resolve(created.id)).toBeDefined(); // B caches it

    await a.identity.sessions.revoke(created.id);

    expect(await a.identity.sessions.resolve(created.id)).toBeUndefined(); // at once where it happened
    await sleep(200);
    expect(await b.identity.sessions.resolve(created.id)).toBeUndefined(); // after the TTL elsewhere
  });

  it('does not keep what it never verified: unknown ids always reach the database', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    const user = await makeUser(kernel.pool);
    const ghost = newSessionId();
    expect(await id.sessions.resolve(ghost)).toBeUndefined();
    // A session with this very id appearing later is found at once (no negative cache).
    await kernel.pool.query(
      `insert into identity_session (id, user_id, secret_hash, expires_at)
       values (gen_random_uuid(), $1, $2, now() + interval '1 day')`,
      [user.id, hashSessionId(ghost)],
    );
    expect(await id.sessions.resolve(ghost)).toBeDefined();
  });
});
