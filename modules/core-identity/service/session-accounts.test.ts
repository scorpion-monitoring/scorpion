// The caller's own sessions (ADR 0025): the list, ending one, "log out everywhere" and
// re-authenticating with the password. Every one of them is a session-only action of the caller;
// ending a session and logging out everywhere need a recent authentication.
import {
  ANONYMOUS,
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  ReauthenticationRequired,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { failOutbox } from '../test/mail.ts';
import { hashPassword } from './password.ts';

const identity = useIdentity();
const PASSWORD = 'correct horse battery';
const HOUR = 3600_000;

const rows = async (
  kernel: { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } },
  sql: string,
) => (await kernel.pool.query(sql)).rows as Record<string, unknown>[];

async function start() {
  const started = await identity.start({ sessionCacheTtlMs: 0 });
  const alice = await makeMember(started.kernel.pool, { username: 'alice' });
  await makeAuthMethod(started.kernel.pool, alice, { passwordHash: await hashPassword(PASSWORD) });
  /** A session actor of `user` whose session began `agoMs` ago and was authenticated then. */
  const sessionOf = async (user: { id: string; username: string }, agoMs = 0) => {
    const created = await started.identity.sessions.create(
      user.id,
      undefined,
      new Date(Date.now() - agoMs),
    );
    const actor: Actor = {
      kind: 'user',
      userId: user.id,
      username: user.username,
      roles: [],
      via: 'session',
      sessionId: created.sessionId,
    };
    return { actor, ...created };
  };
  const authenticatedAt = async (sessionId: string) =>
    (
      await started.kernel.pool.query<{ authenticated_at: Date }>(
        'select authenticated_at from identity_session where id = $1',
        [sessionId],
      )
    ).rows[0]!.authenticated_at;
  return { ...started, alice, sessionOf, authenticatedAt, accounts: started.identity.accounts };
}

describe('listSessions', () => {
  it('lists the caller’s own live sessions and nobody else’s, with the current one marked', async () => {
    const { alice, kernel, sessionOf, accounts } = await start();
    const bob = await makeMember(kernel.pool, { username: 'bobby' });
    const phone = await sessionOf(alice, 2 * HOUR);
    const laptop = await sessionOf(alice);
    await sessionOf(bob);

    const { sessions, total } = await accounts.listSessions(laptop.actor, {
      page: 0,
      pageSize: 20,
    });

    expect(total).toBe(2);
    expect(sessions.map((s) => [s.id, s.current])).toEqual([
      [laptop.sessionId, true],
      [phone.sessionId, false],
    ]);
  });

  it('refuses an anonymous caller, a user without the permission, and a token (denied)', async () => {
    const { kernel, sessionOf, accounts } = await start();
    const nobody = await makeUser(kernel.pool); // no role: holds no permission
    const nobodys = await sessionOf(nobody);
    const member = await makeMember(kernel.pool, { username: 'carol' });
    const token: Actor = {
      kind: 'user',
      userId: member.id,
      username: member.username,
      roles: [],
      via: 'token',
      scopes: ['core.identity.session.manage'],
    };
    const page = { page: 0, pageSize: 20 };
    await expect(accounts.listSessions(ANONYMOUS, page)).rejects.toBeInstanceOf(Unauthorized);
    await expect(accounts.listSessions(nobodys.actor, page)).rejects.toBeInstanceOf(Forbidden);
    await expect(accounts.listSessions(token, page)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('endSession', () => {
  it('lets a user list and end their own sessions after authenticating again [ASVS-7.5.2]', async () => {
    const { alice, sessionOf, accounts, identity: id } = await start();
    const phone = await sessionOf(alice, 2 * HOUR); // another session of alice
    const laptop = await sessionOf(alice, 2 * HOUR); // the one she is using: authenticated 2 hours ago

    const listed = await accounts.listSessions(laptop.actor, { page: 0, pageSize: 20 });
    expect(listed.sessions.map((s) => s.id).sort()).toEqual(
      [laptop.sessionId, phone.sessionId].sort(),
    );

    // Ending a session asks for a recent authentication first, and nothing is ended.
    await expect(accounts.endSession(laptop.actor, phone.sessionId)).rejects.toBeInstanceOf(
      ReauthenticationRequired,
    );
    expect(await id.sessions.resolve(phone.id)).toBeDefined();

    await accounts.reauthenticate(laptop.actor, { password: PASSWORD });

    expect(await accounts.endSession(laptop.actor, phone.sessionId)).toEqual({ current: false });
    expect(await id.sessions.resolve(phone.id)).toBeUndefined();
    expect(await id.sessions.resolve(laptop.id)).toBeDefined();
    expect(await accounts.endSession(laptop.actor, laptop.sessionId)).toEqual({ current: true });
    expect(await id.sessions.resolve(laptop.id)).toBeUndefined();
  });

  it('answers another user’s session exactly like an unknown one, and ends nothing', async () => {
    const { alice, kernel, sessionOf, accounts, identity: id } = await start();
    const bob = await makeMember(kernel.pool, { username: 'bobby' });
    const mine = await sessionOf(alice);
    const theirs = await sessionOf(bob);

    const foreign = await accounts
      .endSession(mine.actor, theirs.sessionId)
      .catch((e: unknown) => e);
    const unknown = await accounts
      .endSession(mine.actor, '00000000-0000-7000-8000-000000000000')
      .catch((e: unknown) => e);

    expect(foreign).toBeInstanceOf(NotFound);
    expect(unknown).toBeInstanceOf(NotFound);
    expect((foreign as Error).message).toBe((unknown as Error).message);
    expect(await id.sessions.resolve(theirs.id)).toBeDefined();
  });

  it('answers a stale caller the same way whose session it is, so the 401 reveals nothing', async () => {
    const { alice, kernel, sessionOf, accounts } = await start();
    const bob = await makeMember(kernel.pool, { username: 'bobby' });
    const stale = await sessionOf(alice, 2 * HOUR);
    const theirs = await sessionOf(bob);
    await expect(accounts.endSession(stale.actor, theirs.sessionId)).rejects.toBeInstanceOf(
      ReauthenticationRequired,
    );
    await expect(
      accounts.endSession(stale.actor, '00000000-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(ReauthenticationRequired);
  });

  it('refuses an anonymous caller, a user without the permission, and a token (denied)', async () => {
    const { kernel, alice, sessionOf, accounts } = await start();
    const nobody = await makeUser(kernel.pool);
    const nobodys = await sessionOf(nobody);
    const mine = await sessionOf(alice);
    const token: Actor = {
      kind: 'user',
      userId: alice.id,
      username: alice.username,
      roles: [],
      via: 'token',
      scopes: ['core.identity.session.manage'],
    };
    await expect(accounts.endSession(ANONYMOUS, mine.sessionId)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(accounts.endSession(nobodys.actor, mine.sessionId)).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(accounts.endSession(token, mine.sessionId)).rejects.toBeInstanceOf(Forbidden);
    expect(
      await kernel.pool.query('select 1 from identity_session where revoked_at is not null'),
    ).toMatchObject({
      rows: [],
    });
  });
});

describe('logoutAll needs a recent authentication', () => {
  it('refuses a stale session and ends nothing, then ends everything after re-authenticating', async () => {
    const { alice, sessionOf, accounts, identity: id } = await start();
    const phone = await sessionOf(alice);
    const laptop = await sessionOf(alice, 2 * HOUR);

    await expect(accounts.logoutAll(laptop.actor)).rejects.toBeInstanceOf(ReauthenticationRequired);
    expect(await id.sessions.resolve(phone.id)).toBeDefined();
    expect(await id.sessions.resolve(laptop.id)).toBeDefined();

    await accounts.reauthenticate(laptop.actor, { password: PASSWORD });
    expect(await accounts.logoutAll(laptop.actor)).toBe(2);
    expect(await id.sessions.resolve(phone.id)).toBeUndefined();
  });
});

describe('reauthenticate', () => {
  it('sets the authentication time of the caller’s session to now, and of no other session', async () => {
    const { alice, sessionOf, authenticatedAt, accounts, kernel } = await start();
    const laptop = await sessionOf(alice, 2 * HOUR);
    const phone = await sessionOf(alice, 2 * HOUR);
    const before = Date.now();

    await accounts.reauthenticate(laptop.actor, { password: PASSWORD });

    expect((await authenticatedAt(laptop.sessionId)).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(Date.now() - (await authenticatedAt(phone.sessionId)).getTime()).toBeGreaterThan(HOUR);
    expect(
      (await rows(kernel, 'select name, payload from kernel_outbox')).map((r) => r.name),
    ).toEqual(['identity.session.reauthenticated@1']);
    expect((await rows(kernel, 'select payload from kernel_outbox'))[0]!.payload).toEqual({
      userId: alice.id,
      username: 'alice',
      method: 'password',
    });
  });

  it('refuses a wrong password with 422 and changes nothing, not even an event', async () => {
    const { alice, sessionOf, authenticatedAt, accounts, kernel } = await start();
    const laptop = await sessionOf(alice, 2 * HOUR);
    const was = await authenticatedAt(laptop.sessionId);

    await expect(
      accounts.reauthenticate(laptop.actor, { password: 'not the password' }),
    ).rejects.toBeInstanceOf(Invalid);

    expect(await authenticatedAt(laptop.sessionId)).toEqual(was);
    expect(await rows(kernel, 'select 1 from kernel_outbox')).toEqual([]);
  });

  it('is a 409 for an account that has no password: it re-authenticates at its provider', async () => {
    const { kernel, sessionOf, accounts } = await start();
    const oidcOnly = await makeMember(kernel.pool, { username: 'olga' });
    const session = await sessionOf(oidcOnly);
    await expect(
      accounts.reauthenticate(session.actor, { password: PASSWORD }),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('validates the input: no password, an empty one and another field are all 422', async () => {
    const { alice, sessionOf, accounts } = await start();
    const { actor } = await sessionOf(alice);
    for (const input of [{}, { password: '' }, { password: PASSWORD, extra: 1 }, 'x', null]) {
      await expect(accounts.reauthenticate(actor, input)).rejects.toBeInstanceOf(Invalid);
    }
  });

  it('refuses an anonymous caller, a user without the permission, and a token (denied)', async () => {
    const { kernel, alice, sessionOf, accounts } = await start();
    const nobody = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, nobody, { passwordHash: await hashPassword(PASSWORD) });
    const nobodys = await sessionOf(nobody);
    const token: Actor = {
      kind: 'user',
      userId: alice.id,
      username: alice.username,
      roles: [],
      via: 'token',
      scopes: ['core.identity.session.manage'],
    };
    const input = { password: PASSWORD };
    await expect(accounts.reauthenticate(ANONYMOUS, input)).rejects.toBeInstanceOf(Unauthorized);
    await expect(accounts.reauthenticate(nobodys.actor, input)).rejects.toBeInstanceOf(Forbidden);
    await expect(accounts.reauthenticate(token, input)).rejects.toBeInstanceOf(Forbidden);
  });

  it('rolls back: when the event cannot be written the authentication time is not set', async () => {
    const { alice, sessionOf, authenticatedAt, accounts, kernel } = await start();
    const laptop = await sessionOf(alice, 2 * HOUR);
    const was = await authenticatedAt(laptop.sessionId);
    await failOutbox(kernel);

    await expect(accounts.reauthenticate(laptop.actor, { password: PASSWORD })).rejects.toThrow();

    expect(await authenticatedAt(laptop.sessionId)).toEqual(was);
  });

  it('refuses a session that was ended in the meantime', async () => {
    const { alice, sessionOf, accounts, identity: id } = await start();
    const laptop = await sessionOf(alice);
    await id.sessions.revokeOwn(alice.id, laptop.sessionId);
    await expect(
      accounts.reauthenticate(laptop.actor, { password: PASSWORD }),
    ).rejects.toBeInstanceOf(Unauthorized);
  });
});
