// An administrator ends sessions (ASVS 7.4.5): every session of one user, or of everybody but the
// caller's own. Both need `core.identity.session.manage-any`, which only Admin holds.
import { ANONYMOUS, Forbidden, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeRoleAssignment, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { failOutbox } from '../test/mail.ts';

const identity = useIdentity();

async function start() {
  const started = await identity.start({ sessionCacheTtlMs: 60_000 }); // a long cache on purpose
  const { kernel, identity: id } = started;
  const admin = await makeUser(kernel.pool, { username: 'root' });
  await makeRoleAssignment(kernel.pool, admin, 'admin');
  const alice = await makeMember(kernel.pool, { username: 'alice' });
  const bob = await makeMember(kernel.pool, { username: 'bobby' });
  const open = async (user: { id: string }) => {
    const created = await id.sessions.create(user.id);
    await id.sessions.resolve(created.id); // now in this process's cache
    return created;
  };
  const actorOf = (user: { id: string; username: string }, sessionId?: string): Actor => ({
    kind: 'user',
    userId: user.id,
    username: user.username,
    roles: [],
    via: 'session',
    sessionId,
  });
  const outbox = async () =>
    (await kernel.pool.query('select name, payload from kernel_outbox order by id')).rows as {
      name: string;
      payload: Record<string, unknown>;
    }[];
  return { ...started, admin, alice, bob, open, actorOf, outbox, admins: id.sessionAdmin };
}

describe('revokeUser', () => {
  it('ends every open session of that user at once (cache included), counts them, and spares everybody else', async () => {
    const { admin, alice, bob, open, actorOf, admins, identity: id, outbox } = await start();
    const a1 = await open(alice);
    const a2 = await open(alice);
    const b1 = await open(bob);

    expect(await admins.revokeUser(actorOf(admin), alice.id)).toBe(2);

    expect(await id.sessions.resolve(a1.id)).toBeUndefined();
    expect(await id.sessions.resolve(a2.id)).toBeUndefined();
    expect(await id.sessions.resolve(b1.id)).toBeDefined();
    expect(await outbox()).toEqual([
      {
        name: 'identity.sessions.revoked@1',
        payload: { userId: alice.id, username: 'alice', revokedBy: admin.id, count: 2 },
      },
    ]);
  });

  it('may end the sessions of another administrator, and says 0 when none are open', async () => {
    const { admin, alice, actorOf, admins } = await start();
    expect(await admins.revokeUser(actorOf(admin), alice.id)).toBe(0);
  });

  it('is a 404 for a user that does not exist, and for an id that is not one', async () => {
    const { admin, actorOf, admins } = await start();
    await expect(
      admins.revokeUser(actorOf(admin), '00000000-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(admins.revokeUser(actorOf(admin), 'nonsense')).rejects.toBeInstanceOf(NotFound);
  });

  it('refuses a plain User, a user without roles, an anonymous caller and a token (denied)', async () => {
    const { kernel, alice, bob, open, actorOf, admins, identity: id, outbox } = await start();
    const nobody = await makeUser(kernel.pool);
    const bobs = await open(bob);
    const token: Actor = {
      kind: 'user',
      userId: alice.id,
      username: alice.username,
      roles: [],
      via: 'token',
      scopes: ['core.identity.session.manage-any'], // a scope names it, but its owner does not hold it
    };
    await expect(admins.revokeUser(actorOf(alice), bob.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(admins.revokeUser(actorOf(alice), alice.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(admins.revokeUser(actorOf(nobody), bob.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(admins.revokeUser(token, bob.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(admins.revokeUser(ANONYMOUS, bob.id)).rejects.toBeInstanceOf(Unauthorized);
    expect(await id.sessions.resolve(bobs.id)).toBeDefined();
    expect(await outbox()).toEqual([]);
  });

  it('rolls back: when the event cannot be written every session stays open', async () => {
    const { kernel, admin, alice, open, actorOf, admins, identity: id } = await start();
    const a1 = await open(alice);
    await failOutbox(kernel);

    await expect(admins.revokeUser(actorOf(admin), alice.id)).rejects.toThrow();

    expect(
      await kernel.pool.query('select 1 from identity_session where revoked_at is not null'),
    ).toMatchObject({ rows: [] });
    expect(await id.sessions.resolve(a1.id)).toBeDefined();
  });
});

describe('revokeEverything', () => {
  it('ends every open session of every user except the caller’s own, and records the count', async () => {
    const { admin, alice, bob, open, actorOf, admins, identity: id, outbox } = await start();
    const mine = await open(admin);
    const otherOfMine = await open(admin);
    const a1 = await open(alice);
    const b1 = await open(bob);

    expect(await admins.revokeEverything(actorOf(admin, mine.sessionId))).toBe(3);

    expect(await id.sessions.resolve(mine.id)).toBeDefined(); // not locked out
    expect(await id.sessions.resolve(otherOfMine.id)).toBeUndefined();
    expect(await id.sessions.resolve(a1.id)).toBeUndefined();
    expect(await id.sessions.resolve(b1.id)).toBeUndefined();
    expect(await outbox()).toEqual([
      {
        name: 'identity.sessions.revokedAll@1',
        payload: { revokedBy: admin.id, count: 3 },
      },
    ]);
  });

  it('refuses a plain User, a user without roles, an anonymous caller and a token (denied)', async () => {
    const { kernel, alice, bob, open, actorOf, admins, identity: id, outbox } = await start();
    const nobody = await makeUser(kernel.pool);
    const bobs = await open(bob);
    const token: Actor = {
      kind: 'user',
      userId: alice.id,
      username: alice.username,
      roles: [],
      via: 'token',
      scopes: ['core.identity.session.manage-any'],
    };
    await expect(admins.revokeEverything(actorOf(alice))).rejects.toBeInstanceOf(Forbidden);
    await expect(admins.revokeEverything(actorOf(nobody))).rejects.toBeInstanceOf(Forbidden);
    await expect(admins.revokeEverything(token)).rejects.toBeInstanceOf(Forbidden);
    await expect(admins.revokeEverything(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    expect(await id.sessions.resolve(bobs.id)).toBeDefined();
    expect(await outbox()).toEqual([]);
  });

  it('rolls back: when the event cannot be written no session is ended', async () => {
    const { kernel, admin, alice, open, actorOf, admins, identity: id } = await start();
    const a1 = await open(alice);
    const mine = await open(admin);
    await failOutbox(kernel);

    await expect(admins.revokeEverything(actorOf(admin, mine.sessionId))).rejects.toThrow();

    expect(
      await kernel.pool.query('select 1 from identity_session where revoked_at is not null'),
    ).toMatchObject({ rows: [] });
    expect(await id.sessions.resolve(a1.id)).toBeDefined();
  });

  it('with an access token there is no session to spare: the administrator’s browser sessions end too', async () => {
    const { admin, alice, open, admins, identity: id } = await start();
    const browser = await open(admin);
    const a1 = await open(alice);
    const token: Actor = {
      kind: 'user',
      userId: admin.id,
      username: admin.username,
      roles: [],
      via: 'token',
      scopes: ['core.identity.session.manage-any'],
    };
    expect(await admins.revokeEverything(token)).toBe(2);
    expect(await id.sessions.resolve(browser.id)).toBeUndefined();
    expect(await id.sessions.resolve(a1.id)).toBeUndefined();
  });
});
