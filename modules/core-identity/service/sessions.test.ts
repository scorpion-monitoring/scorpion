import {
  ANONYMOUS,
  problemFor,
  ReauthenticationRequired,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { SESSION_LIFETIME_MS } from './sessions.ts';
import { settingsSchema, type IdentitySettings } from './settings.ts';
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
  it('stores only the SHA-256 of the id and a 7-day expiry [ASVS-7.2.3]', async () => {
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
      sessionId: expect.any(String) as unknown,
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

  it('refuses an expired session [ASVS-7.4.1]', async () => {
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
  ])('refuses a session whose user is %s [ASVS-7.4.2]', async (_name, overrides) => {
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
  it('revoke ends one session at once in this process, even with a long cache [ASVS-7.4.1]', async () => {
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

  it('is the staleness bound across processes: B accepts a session A revoked for at most the TTL [ASVS-7.2.1]', async () => {
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
      `insert into identity_session (id, user_id, secret_hash, expires_at, absolute_expires_at)
       values (gen_random_uuid(), $1, $2, now() + interval '1 day', now() + interval '2 days')`,
      [user.id, hashSessionId(ghost)],
    );
    expect(await id.sessions.resolve(ghost)).toBeDefined();
  });
});

// ADR 0025: the two ends of a session, the list, and recent authentication.
const DAY = 24 * 3600 * 1000;
const sessionSettings = (values: Record<string, unknown>): IdentitySettings => ({
  get: () => Promise.resolve(settingsSchema.parse({ sessions: values })),
});
const at = (start: Date, ms: number) => new Date(start.getTime() + ms);
const T0 = new Date('2026-01-01T08:00:00Z');

describe('the two ends of a session', () => {
  it.each([
    // [inactivity days, absolute days, when it is used, still live?]
    [7, 30, 6.9 * DAY, true],
    [7, 30, 7.1 * DAY, false],
    [1, 3, 0.5 * DAY, true],
    [1, 3, 1.5 * DAY, false],
    [3, 3, 2.9 * DAY, true],
    [3, 3, 3.1 * DAY, false],
  ])(
    'with %i days of inactivity and %i days in all, a session first used after %d ms is live: %s',
    async (inactivityDays, absoluteDays, after, live) => {
      const { kernel, identity: id } = await identity.start({
        sessionCacheTtlMs: 0,
        settings: sessionSettings({ inactivityDays, absoluteDays }),
      });
      const user = await makeUser(kernel.pool);
      const created = await id.sessions.create(user.id, undefined, T0);
      expect(created.expiresAt).toEqual(at(T0, inactivityDays * DAY));
      const found = await id.sessions.resolve(created.id, at(T0, after));
      expect(found !== undefined).toBe(live);
    },
  );

  it('a session that is not used for the inactivity period is over, however far from its absolute end [ASVS-7.3.1]', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id, undefined, T0);
    expect(await id.sessions.resolve(created.id, at(T0, 7 * DAY - 60_000))).toBeDefined();
    // Used a minute short of 7 days, it slides; left alone for the 7 days after that, it is over.
    expect(await id.sessions.resolve(created.id, at(T0, 14 * DAY + 60_000))).toBeUndefined();
  });

  it('stores the absolute end, and the authentication time, when the session is created', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    await id.sessions.create(user.id, undefined, T0);
    const [row] = await rows(kernel);
    expect(row!.absolute_expires_at).toEqual(at(T0, 30 * DAY));
    expect(row!.expires_at).toEqual(at(T0, 7 * DAY));
    expect(row!.authenticated_at).toEqual(T0);
  });

  it('never slides the inactivity end past the absolute one', async () => {
    const { kernel, identity: id } = await identity.start({
      sessionCacheTtlMs: 0,
      settings: sessionSettings({ inactivityDays: 7, absoluteDays: 10 }),
    });
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id, undefined, T0);

    const resolved = await id.sessions.resolve(created.id, at(T0, 6 * DAY));

    expect(resolved).toMatchObject({ renewed: true, expiresAt: at(T0, 10 * DAY) });
    const [row] = await rows(kernel);
    expect(row!.expires_at).toEqual(at(T0, 10 * DAY));
    expect(row!.absolute_expires_at).toEqual(at(T0, 10 * DAY)); // unchanged by the slide
  });

  it('a session used every day still dies at the absolute limit [ASVS-7.3.2]', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id, undefined, T0);
    const absolute = at(T0, 30 * DAY);

    for (let day = 1; day <= 29; day++) {
      const found = await id.sessions.resolve(created.id, at(T0, day * DAY));
      expect(found, `used on day ${day}`).toBeDefined();
      const [row] = await rows(kernel);
      expect((row!.expires_at as Date).getTime(), `day ${day}`).toBeLessThanOrEqual(
        absolute.getTime(),
      );
      expect(row!.absolute_expires_at).toEqual(absolute);
    }
    // Used the day before it ends it is still good; a minute past the limit it is not, and neither
    // is any later use.
    expect(await id.sessions.resolve(created.id, at(absolute, -60_000))).toBeDefined();
    expect(await id.sessions.resolve(created.id, at(absolute, 60_000))).toBeUndefined();
    expect(await id.sessions.resolve(created.id, at(absolute, 2 * DAY))).toBeUndefined();
  });

  it('keeps the end a session was created with: a changed setting applies to new sessions', async () => {
    let values: Record<string, unknown> = { inactivityDays: 7, absoluteDays: 30 };
    const { kernel, identity: id } = await identity.start({
      sessionCacheTtlMs: 0,
      settings: { get: () => Promise.resolve(settingsSchema.parse({ sessions: values })) },
    });
    const user = await makeUser(kernel.pool);
    const before = await id.sessions.create(user.id, undefined, T0);
    values = { inactivityDays: 2, absoluteDays: 5 };
    const after = await id.sessions.create(user.id, undefined, T0);

    const rowsNow = await rows(kernel);
    expect(rowsNow.map((r) => (r.absolute_expires_at as Date).getTime()).sort()).toEqual([
      at(T0, 5 * DAY).getTime(),
      at(T0, 30 * DAY).getTime(),
    ]);
    // The old session is still good on day 6 (its absolute end is day 30) and slides by today's 2 days.
    expect(await id.sessions.resolve(before.id, at(T0, 6 * DAY))).toMatchObject({
      renewed: true,
      expiresAt: at(T0, 8 * DAY),
    });
    // The new one ended on day 5.
    expect(await id.sessions.resolve(after.id, at(T0, 6 * DAY))).toBeUndefined();
  });

  it('refuses an absolute end below the inactivity period in the settings', () => {
    expect(() =>
      settingsSchema.parse({ sessions: { inactivityDays: 7, absoluteDays: 3 } }),
    ).toThrow();
    expect(() => settingsSchema.parse({ sessions: { inactivityDays: 0 } })).toThrow();
    expect(() => settingsSchema.parse({ sessions: { recentAuthSeconds: 5 } })).toThrow();
    expect(settingsSchema.parse({}).sessions).toEqual({
      inactivityDays: 7,
      absoluteDays: 30,
      recentAuthSeconds: 300,
    });
  });
});

describe('list', () => {
  it('lists the live sessions of one user, newest first, and marks the current one', async () => {
    const { kernel, identity: id } = await identity.start();
    const alice = await makeUser(kernel.pool);
    const bob = await makeUser(kernel.pool);
    const now = new Date();
    const old = await id.sessions.create(alice.id, undefined, at(now, -3 * 3600_000));
    const current = await id.sessions.create(alice.id, undefined, at(now, -1000));
    await id.sessions.create(bob.id);
    const revoked = await id.sessions.create(alice.id);
    await id.sessions.revoke(revoked.id);
    await id.sessions.create(alice.id, undefined, at(now, -40 * DAY)); // over: past its absolute end

    const listed = await id.sessions.list(alice.id, { page: 0, pageSize: 10 }, current.sessionId);

    expect(listed.total).toBe(2);
    expect(listed.sessions.map((s) => [s.id, s.current])).toEqual([
      [current.sessionId, true],
      [old.sessionId, false],
    ]);
    expect(Object.keys(listed.sessions[0]!).sort()).toEqual([
      'createdAt',
      'current',
      'id',
      'lastSeenAt',
    ]);
    const paged = await id.sessions.list(alice.id, { page: 1, pageSize: 1 }, current.sessionId);
    expect(paged.sessions.map((s) => s.id)).toEqual([old.sessionId]);
    expect(paged.total).toBe(2);
  });
});

describe('revokeOwn', () => {
  it('ends one live session of the user at once, even with a long cache, and no other', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    const alice = await makeUser(kernel.pool);
    const one = await id.sessions.create(alice.id);
    const two = await id.sessions.create(alice.id);
    await id.sessions.resolve(one.id); // cached
    await id.sessions.resolve(two.id);

    expect(await id.sessions.revokeOwn(alice.id, one.sessionId)).toBe(true);

    expect(await id.sessions.resolve(one.id)).toBeUndefined();
    expect(await id.sessions.resolve(two.id)).toBeDefined();
    expect(await id.sessions.revokeOwn(alice.id, one.sessionId)).toBe(false); // already over
  });

  it('answers the same for somebody else’s session and for an unknown one, and changes nothing', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const alice = await makeUser(kernel.pool);
    const bob = await makeUser(kernel.pool);
    const bobs = await id.sessions.create(bob.id);

    expect(await id.sessions.revokeOwn(alice.id, bobs.sessionId)).toBe(false);
    expect(await id.sessions.revokeOwn(alice.id, '00000000-0000-7000-8000-000000000000')).toBe(
      false,
    );
    expect(await id.sessions.resolve(bobs.id)).toBeDefined();
  });
});

describe('revokeEverything', () => {
  it('ends every open session of every user except the one it is told to spare', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 60_000 });
    const alice = await makeUser(kernel.pool);
    const bob = await makeUser(kernel.pool);
    const mine = await id.sessions.create(alice.id);
    const other = await id.sessions.create(alice.id);
    const bobs = await id.sessions.create(bob.id);
    for (const s of [mine, other, bobs]) await id.sessions.resolve(s.id); // all cached

    expect(await id.sessions.revokeEveryone(mine.sessionId)).toBe(2);

    expect(await id.sessions.resolve(mine.id)).toBeDefined();
    expect(await id.sessions.resolve(other.id)).toBeUndefined();
    expect(await id.sessions.resolve(bobs.id)).toBeUndefined();
    expect(await id.sessions.revokeEveryone(mine.sessionId)).toBe(0);
  });

  it('ends all of them when nothing is spared', async () => {
    const { kernel, identity: id } = await identity.start({ sessionCacheTtlMs: 0 });
    const alice = await makeUser(kernel.pool);
    const one = await id.sessions.create(alice.id);
    expect(await id.sessions.revokeEveryone()).toBe(1);
    expect(await id.sessions.resolve(one.id)).toBeUndefined();
  });
});

describe('recent authentication', () => {
  const sessionActor = (
    user: { id: string; username: string },
    sessionId: string | undefined,
  ): Actor => ({
    kind: 'user',
    userId: user.id,
    username: user.username,
    roles: [],
    via: 'session',
    sessionId,
  });

  it.each([
    ['one second inside the default window', 299_000, undefined, true],
    ['exactly the window', 300_000, undefined, true],
    ['one second outside the default window', 301_000, undefined, false],
    ['inside a window the caller names', 50_000, 60, true],
    ['outside a window the caller names', 61_000, 60, false],
  ])('a session authenticated %s', async (_name, ago, maxAgeSeconds, passes) => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id, undefined, T0);
    const actor = sessionActor(user, created.sessionId);

    const outcome = id.sessions.requireRecentAuth(actor, maxAgeSeconds, at(T0, ago));

    if (passes) await expect(outcome).resolves.toBeUndefined();
    else await expect(outcome).rejects.toBeInstanceOf(ReauthenticationRequired);
  });

  it('is a 401 with the stable problem type reauthentication-required', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id, undefined, T0);
    const error = await id.sessions
      .requireRecentAuth(sessionActor(user, created.sessionId), undefined, at(T0, DAY))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReauthenticationRequired);
    expect(error).toMatchObject({ status: 401, type: 'reauthentication-required' });
    expect(problemFor(error as ReauthenticationRequired)).toMatchObject({
      type: 'reauthentication-required',
      status: 401,
    });
  });

  it('takes the window from the setting recentAuthSeconds', async () => {
    const { kernel, identity: id } = await identity.start({
      settings: sessionSettings({ recentAuthSeconds: 60 }),
    });
    const user = await makeUser(kernel.pool);
    const created = await id.sessions.create(user.id, undefined, T0);
    const actor = sessionActor(user, created.sessionId);
    await expect(id.sessions.requireRecentAuth(actor, undefined, at(T0, 59_000))).resolves.toBe(
      undefined,
    );
    await expect(
      id.sessions.requireRecentAuth(actor, undefined, at(T0, 61_000)),
    ).rejects.toBeInstanceOf(ReauthenticationRequired);
  });

  it('is satisfied again by markAuthenticated, and only for a live session of that user', async () => {
    const { kernel, identity: id } = await identity.start();
    const alice = await makeUser(kernel.pool);
    const bob = await makeUser(kernel.pool);
    const created = await id.sessions.create(alice.id, undefined, T0);
    const actor = sessionActor(alice, created.sessionId);
    const later = at(T0, DAY);
    await expect(id.sessions.requireRecentAuth(actor, undefined, later)).rejects.toBeInstanceOf(
      ReauthenticationRequired,
    );

    expect(await id.sessions.markAuthenticated(bob.id, created.sessionId, undefined, later)).toBe(
      false,
    ); // not bob's session
    await expect(id.sessions.requireRecentAuth(actor, undefined, later)).rejects.toBeInstanceOf(
      ReauthenticationRequired,
    );
    expect(await id.sessions.markAuthenticated(alice.id, created.sessionId, undefined, later)).toBe(
      true,
    );
    await expect(id.sessions.requireRecentAuth(actor, undefined, later)).resolves.toBeUndefined();
  });

  it('refuses a session that is gone, one that is somebody else’s, and an actor with no session id (fails closed)', async () => {
    const { kernel, identity: id } = await identity.start();
    const alice = await makeUser(kernel.pool);
    const bob = await makeUser(kernel.pool);
    const created = await id.sessions.create(alice.id);
    await expect(
      id.sessions.requireRecentAuth(sessionActor(bob, created.sessionId)),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      id.sessions.requireRecentAuth(sessionActor(alice, undefined)),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(id.sessions.requireRecentAuth(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    await id.sessions.revoke(created.id);
    await expect(
      id.sessions.requireRecentAuth(sessionActor(alice, created.sessionId)),
    ).rejects.toBeInstanceOf(Unauthorized);
  });

  it('does not ask a personal access token, which is a credential its owner made on purpose', async () => {
    const { kernel, identity: id } = await identity.start();
    const user = await makeUser(kernel.pool);
    const token: Actor = {
      kind: 'user',
      userId: user.id,
      username: user.username,
      roles: [],
      via: 'token',
      scopes: [],
    };
    await expect(id.sessions.requireRecentAuth(token)).resolves.toBeUndefined();
  });
});
