// The administrator's view of accounts on real Postgres, with the real core.authz: the list with its
// filters, search and stable sort, one account, and deactivation (sessions end in the same
// transaction, ASVS 7.4.2). Every method is refused to a plain user and to an anonymous caller.
import { ANONYMOUS, Conflict, Forbidden, NotFound, Unauthorized } from '@scorpion/contracts';
import { makeRole, makeRoleAssignment, makeSession, makeUser } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { escapeLike } from './user-admin.ts';

const identity = useIdentity();
type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];

async function start() {
  const started = await identity.start();
  const admin = await makeUser(started.kernel.pool, { username: 'root' });
  const adminActor = await started.actorOf(admin, 'admin');
  return { ...started, admin, adminActor, users: started.identity.userAdmin };
}

describe('list', () => {
  it('lists accounts by username with the total, and never the rejected ones unless asked', async () => {
    const { kernel, users, adminActor } = await start();
    await makeMember(kernel.pool, { username: 'bob' });
    await makeMember(kernel.pool, { username: 'alice' });
    await makeUser(kernel.pool, { username: 'carol', status: 'pending' });
    await makeUser(kernel.pool, { username: 'dave', status: 'rejected', deleted: true });
    await makeUser(kernel.pool, { username: 'erin', status: 'deactivated' });

    const all = await users.list(adminActor, { page: 0, pageSize: 20 });
    expect(all.users.map((u) => u.username)).toEqual(['alice', 'bob', 'carol', 'erin', 'root']);
    expect(all.total).toBe(5);
    const rejected = await users.list(adminActor, { page: 0, pageSize: 20, status: 'rejected' });
    expect(rejected.users.map((u) => u.username)).toEqual(['dave']);
    const pending = await users.list(adminActor, { page: 0, pageSize: 20, status: 'pending' });
    expect(pending.users.map((u) => u.username)).toEqual(['carol']);
  });

  it('carries only the fields of the field table: no hash, no bio, no avatar', async () => {
    const { users, adminActor } = await start();
    const [first] = (await users.list(adminActor, { page: 0, pageSize: 1 })).users;
    expect(Object.keys(first!).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'emailVerified',
      'id',
      'status',
      'username',
    ]);
  });

  it('pages and sorts stably: by the column, then by id, in either direction, with no repeat or gap', async () => {
    const { kernel, users, adminActor } = await start();
    // The same status on all of them, so the sort has to fall back to the id.
    for (let n = 0; n < 7; n += 1) await makeMember(kernel.pool, { username: `member${n}` });
    const seen: string[] = [];
    for (let page = 0; page < 4; page += 1) {
      const result = await users.list(adminActor, {
        page,
        pageSize: 2,
        sort: 'status',
        direction: 'desc',
      });
      expect(result.total).toBe(8);
      seen.push(...result.users.map((u) => u.id));
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    const ascending = await users.list(adminActor, { page: 0, pageSize: 20, sort: 'status' });
    const descending = await users.list(adminActor, {
      page: 0,
      pageSize: 20,
      sort: 'status',
      direction: 'desc',
    });
    expect(descending.users.map((u) => u.id)).toEqual(ascending.users.map((u) => u.id).reverse());
  });

  it('searches the start of the username or the address, and treats % and _ as letters', async () => {
    const { kernel, users, adminActor } = await start();
    await makeMember(kernel.pool, { username: 'anna', email: 'zed@example.org' });
    await makeMember(kernel.pool, { username: 'bert', email: 'anna.b@example.org' });
    await makeMember(kernel.pool, { username: 'carl', email: 'c@example.org' });
    const found = async (q: string) =>
      (await users.list(adminActor, { page: 0, pageSize: 20, q })).users.map((u) => u.username);
    expect(await found('ann')).toEqual(['anna', 'bert']);
    expect(await found('ANNA')).toEqual(['anna', 'bert']);
    expect(await found('%')).toEqual([]);
    expect(await found('_')).toEqual([]);
    expect(await found('nna')).toEqual([]); // a prefix, not "contains"
  });

  it('is denied to a plain user, a user without roles and an anonymous caller', async () => {
    const { kernel, users } = await start();
    const plain = await makeMember(kernel.pool);
    const roleless = await makeUser(kernel.pool);
    for (const person of [plain, roleless]) {
      const actor = {
        kind: 'user',
        userId: person.id,
        username: person.username,
        roles: [],
        via: 'session',
      } as const;
      await expect(users.list(actor, { page: 0, pageSize: 5 })).rejects.toBeInstanceOf(Forbidden);
      await expect(users.get(actor, person.id)).rejects.toBeInstanceOf(Forbidden);
    }
    await expect(users.list(ANONYMOUS, { page: 0, pageSize: 5 })).rejects.toBeInstanceOf(
      Unauthorized,
    );
  });
});

describe('get', () => {
  it('returns one account and says 404 for an unknown or malformed id', async () => {
    const { kernel, users, adminActor } = await start();
    const target = await makeMember(kernel.pool, { username: 'target' });
    expect((await users.get(adminActor, target.id)).username).toBe('target');
    await expect(users.get(adminActor, randomUUID())).rejects.toBeInstanceOf(NotFound);
    await expect(users.get(adminActor, 'not-a-uuid')).rejects.toBeInstanceOf(NotFound);
  });
});

describe('deactivate', () => {
  it('closes an active account, ends all its sessions in the same transaction and emits the event [ASVS-7.4.2]', async () => {
    const { kernel, users, adminActor } = await start();
    const target = await makeMember(kernel.pool, { username: 'target' });
    await makeSession(kernel.pool, target);
    await makeSession(kernel.pool, target);
    await makeSession(kernel.pool, target, { revoked: true });

    const result = await users.deactivate(adminActor, target.id);

    expect(result).toMatchObject({ id: target.id, status: 'deactivated' });
    expect(
      await rows(
        kernel,
        'select 1 from identity_session where user_id = $1 and revoked_at is null',
        [target.id],
      ),
    ).toEqual([]);
    const events = await rows(
      kernel,
      "select payload from kernel_outbox where name = 'identity.user.deactivated@1'",
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      userId: target.id,
      deactivatedBy: adminActor.userId,
      count: 2,
    });
    // Not a soft delete: the purge job leaves it alone.
    expect(
      await rows(kernel, 'select deleted_at from identity_user where id = $1', [target.id]),
    ).toEqual([{ deleted_at: null }]);
  });

  it('undoes the status change and the ended sessions when the event cannot be written', async () => {
    const { kernel, users, adminActor } = await start();
    const target = await makeMember(kernel.pool, { username: 'target' });
    await makeSession(kernel.pool, target);
    // Break the outbox for the length of the call: the status change and the sessions must undo.
    await kernel.pool.query('alter table kernel_outbox rename to kernel_outbox_away');
    try {
      await expect(users.deactivate(adminActor, target.id)).rejects.toThrow();
    } finally {
      await kernel.pool.query('alter table kernel_outbox_away rename to kernel_outbox');
    }
    expect(
      await rows(kernel, 'select status from identity_user where id = $1', [target.id]),
    ).toEqual([{ status: 'active' }]);
    expect(
      await rows(
        kernel,
        'select 1 from identity_session where user_id = $1 and revoked_at is null',
        [target.id],
      ),
    ).toHaveLength(1);
  });

  it('refuses your own account, an account that is not active, and an unknown one', async () => {
    const { kernel, users, adminActor, admin } = await start();
    await expect(users.deactivate(adminActor, admin.id)).rejects.toBeInstanceOf(Forbidden);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await expect(users.deactivate(adminActor, pending.id)).rejects.toBeInstanceOf(Conflict);
    const done = await makeUser(kernel.pool, { status: 'deactivated' });
    await expect(users.deactivate(adminActor, done.id)).rejects.toBeInstanceOf(Conflict);
    await expect(users.deactivate(adminActor, randomUUID())).rejects.toBeInstanceOf(NotFound);
    await expect(users.deactivate(adminActor, 'nope')).rejects.toBeInstanceOf(NotFound);
    expect(
      await rows(kernel, "select 1 from kernel_outbox where name = 'identity.user.deactivated@1'"),
    ).toEqual([]);
  });

  it('keeps the last Admin who can sign in: a deactivated Admin does not count', async () => {
    const { kernel, users, adminActor, actorOf } = await start();
    const role = await makeRole(kernel.pool, { permissions: ['core.identity.user.deactivate'] });
    const manager = await makeUser(kernel.pool, { username: 'manager' });
    const managerActor = await actorOf(manager, role.key);

    // Two Admins who can sign in: one of them may be deactivated.
    const second = await makeUser(kernel.pool, { username: 'second' });
    await makeRoleAssignment(kernel.pool, second, 'admin');
    await expect(users.deactivate(managerActor, adminActor.userId)).resolves.toMatchObject({
      status: 'deactivated',
    });
    // `second` is now the only Admin who can sign in. It is refused, though two accounts hold the role.
    await expect(users.deactivate(managerActor, second.id)).rejects.toBeInstanceOf(Conflict);
    expect(
      await rows(kernel, 'select status from identity_user where id = $1', [second.id]),
    ).toEqual([{ status: 'active' }]);
  });

  it('is denied to a plain user, a reader and an anonymous caller, and changes nothing', async () => {
    const { kernel, users, actorOf } = await start();
    const target = await makeMember(kernel.pool, { username: 'target' });
    const plain = await makeMember(kernel.pool);
    const actor = {
      kind: 'user',
      userId: plain.id,
      username: plain.username,
      roles: [],
      via: 'session',
    } as const;
    await expect(users.deactivate(actor, target.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(users.deactivate(ANONYMOUS, target.id)).rejects.toBeInstanceOf(Unauthorized);
    const role = await makeRole(kernel.pool, { permissions: ['core.identity.user.read'] });
    const reader = await makeUser(kernel.pool);
    await expect(
      users.deactivate(await actorOf(reader, role.key), target.id),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(
      await rows(kernel, 'select status from identity_user where id = $1', [target.id]),
    ).toEqual([{ status: 'active' }]);
  });
});

describe('escapeLike', () => {
  it.each([
    ['plain', 'plain'],
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['back\\slash', 'back\\\\slash'],
  ])('escapes %s as %s', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});
