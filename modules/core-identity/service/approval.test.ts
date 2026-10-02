import {
  ANONYMOUS,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { makeRole, makeRoleAssignment, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';

const identity = useIdentity();

/** An administrator: holds the Admin role, so every permission and `core.authz.role.assign`. */
const makeAdmin = async (
  pool: Parameters<typeof makeUser>[0],
  overrides?: Parameters<typeof makeUser>[1],
) => {
  const made = await makeUser(pool, overrides);
  await makeRoleAssignment(pool, made, 'admin');
  return made;
};
const rolesOf = async (
  kernel: { pool: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> } },
  id: string,
) =>
  (
    await kernel.pool.query(
      `select r.key, a.assigned_by from authz_role_assignment a join authz_role r on r.id = a.role_id
       where a.user_id = $1 order by r.key`,
      [id],
    )
  ).rows as { key: string; assigned_by: string | null }[];

const actorOf = (user: { id: string; username: string }): Actor => ({
  kind: 'user',
  userId: user.id,
  username: user.username,
  roles: [],
  via: 'session',
});
const rowOf = async (
  kernel: { pool: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> } },
  id: string,
) =>
  (await kernel.pool.query('select status, deleted_at from identity_user where id = $1', [id]))
    .rows[0] as { status: string; deleted_at: Date | null };
const all = async (
  kernel: { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } },
  table: string,
) => (await kernel.pool.query(`select * from ${table}`)).rows as Record<string, unknown>[];

describe('approve', () => {
  it('turns a pending account active and emits identity.user.approved@1 with it', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });

    expect(await id.approval.approve(actorOf(admin), pending.id)).toBe('active');

    const row = await rowOf(kernel, pending.id);
    expect(row).toMatchObject({ status: 'active', deleted_at: null });
    // The role is given in the same transaction: `user` unless the approver names another.
    expect(await rolesOf(kernel, pending.id)).toEqual([{ key: 'user', assigned_by: admin.id }]);
    expect(await all(kernel, 'kernel_outbox')).toEqual([
      expect.objectContaining({
        name: 'authz.role.assigned@1',
        payload: { userId: pending.id, roleKey: 'user', actorId: admin.id },
      }),
      expect.objectContaining({
        name: 'identity.user.approved@1',
        payload: {
          userId: pending.id,
          username: pending.username,
          approvedBy: admin.id,
          role: 'user',
        },
      }),
    ]);
  });

  it('refuses to approve your own account, and changes nothing (self-approval)', async () => {
    const { kernel, identity: id } = await identity.start();
    const me = await makeAdmin(kernel.pool, { status: 'pending' });
    await expect(id.approval.approve(actorOf(me), me.id)).rejects.toBeInstanceOf(Forbidden);
    const row = await rowOf(kernel, me.id);
    expect(row.status).toBe('pending');
    expect(await all(kernel, 'kernel_outbox')).toEqual([]);
  });

  it('refuses an anonymous caller (denied)', async () => {
    const { kernel, identity: id } = await identity.start();
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await expect(id.approval.approve(ANONYMOUS, pending.id)).rejects.toBeInstanceOf(Unauthorized);
    const row = await rowOf(kernel, pending.id);
    expect(row.status).toBe('pending');
  });

  it.each([
    ['an active account', { status: 'active' as const }],
    ['a rejected account', { status: 'rejected' as const, deleted: true }],
  ])('answers 409 for %s', async (_name, overrides) => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const other = await makeUser(kernel.pool, overrides);
    await expect(id.approval.approve(actorOf(admin), other.id)).rejects.toBeInstanceOf(Conflict);
  });

  it('answers 404 for an unknown id and for text that is not an id', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    for (const unknown of [
      '019a0000-0000-7000-8000-000000000000',
      'not-a-uuid',
      "'; drop table identity_user; --",
    ]) {
      await expect(id.approval.approve(actorOf(admin), unknown)).rejects.toBeInstanceOf(NotFound);
    }
  });

  it('lets two approvals at once succeed once and answer the other with 409', async () => {
    const { kernel, identity: id } = await identity.start();
    const a = await makeAdmin(kernel.pool);
    const b = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    const results = await Promise.allSettled([
      id.approval.approve(actorOf(a), pending.id),
      id.approval.approve(actorOf(b), pending.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.any(Conflict) as unknown,
    });
    // One approval: one role assignment, one event each, and nothing from the loser.
    expect(await all(kernel, 'kernel_outbox')).toHaveLength(2);
    expect(await rolesOf(kernel, pending.id)).toHaveLength(1);
  });

  it('rolls back the status when the event cannot be written', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'outbox on fire'; end $$;
      create trigger identity_test_fail before insert on kernel_outbox
        for each row execute function identity_test_fail();`);
    await expect(id.approval.approve(actorOf(admin), pending.id)).rejects.toThrow();
    const row = await rowOf(kernel, pending.id);
    expect(row.status).toBe('pending');
  });
});

describe('reject', () => {
  it('rejects and soft-deletes, keeps the username reserved, and emits identity.user.rejected@1', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending', username: 'mallory' });

    expect(await id.approval.reject(actorOf(admin), pending.id)).toBe('rejected');

    const row = await rowOf(kernel, pending.id);
    expect(row.status).toBe('rejected');
    expect(row.deleted_at).toBeInstanceOf(Date);
    expect(await id.users.findByUsername('mallory')).toMatchObject({ status: 'rejected' });
    expect(await all(kernel, 'kernel_outbox')).toEqual([
      expect.objectContaining({
        name: 'identity.user.rejected@1',
        payload: { userId: pending.id, username: 'mallory', rejectedBy: admin.id },
      }),
    ]);
  });

  it('refuses to reject your own account, and an anonymous caller (denied)', async () => {
    const { kernel, identity: id } = await identity.start();
    const me = await makeAdmin(kernel.pool, { status: 'pending' });
    await expect(id.approval.reject(actorOf(me), me.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(id.approval.reject(ANONYMOUS, me.id)).rejects.toBeInstanceOf(Unauthorized);
    const row = await rowOf(kernel, me.id);
    expect(row).toMatchObject({ status: 'pending', deleted_at: null });
  });

  it('answers 409 for an account that is not pending and 404 for an unknown one', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const active = await makeUser(kernel.pool);
    await expect(id.approval.reject(actorOf(admin), active.id)).rejects.toBeInstanceOf(Conflict);
    await expect(
      id.approval.reject(actorOf(admin), '019a0000-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('rolls back when the event cannot be written', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'outbox on fire'; end $$;
      create trigger identity_test_fail before insert on kernel_outbox
        for each row execute function identity_test_fail();`);
    await expect(id.approval.reject(actorOf(admin), pending.id)).rejects.toThrow();
    const row = await rowOf(kernel, pending.id);
    expect(row).toMatchObject({ status: 'pending', deleted_at: null });
  });
});

describe('listPending', () => {
  it('lists pending accounts only, oldest first, in pages with a total', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const first = await makeUser(kernel.pool, { status: 'pending' });
    await makeUser(kernel.pool); // active
    await makeUser(kernel.pool, { status: 'rejected', deleted: true });
    const second = await makeUser(kernel.pool, { status: 'pending' });
    const third = await makeUser(kernel.pool, { status: 'pending' });

    const one = await id.approval.listPending(actorOf(admin), { page: 0, pageSize: 2 });
    const two = await id.approval.listPending(actorOf(admin), { page: 1, pageSize: 2 });

    expect(one.total).toBe(3);
    expect([...one.users, ...two.users].map((u) => u.id)).toEqual([first.id, second.id, third.id]);
    expect(Object.keys(one.users[0]!).sort()).toEqual(['createdAt', 'email', 'id', 'username']);
  });

  it('refuses an anonymous caller (denied)', async () => {
    const { identity: id } = await identity.start();
    await expect(
      id.approval.listPending(ANONYMOUS, { page: 0, pageSize: 10 }),
    ).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe('approve with a role', () => {
  it('gives the named role instead of the default, in one transaction with the status and the event', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await id.approval.approve(actorOf(admin), pending.id, { role: 'reviewer' });
    expect(await rolesOf(kernel, pending.id)).toEqual([{ key: 'reviewer', assigned_by: admin.id }]);
    expect((await all(kernel, 'kernel_outbox')).map((e) => e.payload)).toEqual([
      { userId: pending.id, roleKey: 'reviewer', actorId: admin.id },
      expect.objectContaining({ approvedBy: admin.id, role: 'reviewer' }),
    ]);
  });

  it('keeps the account pending, with no role and no event, when the role does not exist', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await expect(
      id.approval.approve(actorOf(admin), pending.id, { role: 'no-such-role' }),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await rowOf(kernel, pending.id)).toMatchObject({ status: 'pending' });
    expect(await rolesOf(kernel, pending.id)).toEqual([]);
    expect(await all(kernel, 'kernel_outbox')).toEqual([]);
  });

  it('rolls the approval back when the role assignment fails after the status changed', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeAdmin(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'assignment on fire'; end $$;
      create trigger identity_test_fail before insert on authz_role_assignment
        for each row execute function identity_test_fail();`);
    await expect(id.approval.approve(actorOf(admin), pending.id)).rejects.toThrow();
    expect(await rowOf(kernel, pending.id)).toMatchObject({ status: 'pending' });
    expect(await rolesOf(kernel, pending.id)).toEqual([]);
    expect(await all(kernel, 'kernel_outbox')).toEqual([]);
  });

  it('is refused for an approver who may approve but not assign roles, and changes nothing', async () => {
    const { kernel, identity: id } = await identity.start();
    const approver = await makeUser(kernel.pool);
    const role = await makeRole(kernel.pool, {
      permissions: ['core.identity.user.approve', 'core.identity.user.reject'],
    });
    await makeRoleAssignment(kernel.pool, approver, role);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    await expect(id.approval.approve(actorOf(approver), pending.id)).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(await rowOf(kernel, pending.id)).toMatchObject({ status: 'pending' });
    expect(await rolesOf(kernel, pending.id)).toEqual([]);
    // Rejecting needs no role, so that approver may still reject.
    await expect(id.approval.reject(actorOf(approver), pending.id)).resolves.toBe('rejected');
  });
});

describe('the second check, with core.authz', () => {
  it('refuses a plain user and a user without roles on approve, reject and listPending, and changes nothing', async () => {
    const { kernel, identity: id } = await identity.start();
    const plain = await makeUser(kernel.pool);
    await makeRoleAssignment(kernel.pool, plain, 'user');
    const roleless = await makeUser(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    for (const caller of [plain, roleless]) {
      const actor = actorOf(caller);
      await expect(id.approval.approve(actor, pending.id)).rejects.toBeInstanceOf(Forbidden);
      await expect(id.approval.reject(actor, pending.id)).rejects.toBeInstanceOf(Forbidden);
      await expect(
        id.approval.listPending(actor, { page: 0, pageSize: 10 }),
      ).rejects.toBeInstanceOf(Forbidden);
    }
    expect(await rowOf(kernel, pending.id)).toMatchObject({ status: 'pending', deleted_at: null });
    expect(await all(kernel, 'kernel_outbox')).toEqual([]);
  });

  it('refuses an approval on your own account whatever you hold, also with the permission in a custom role', async () => {
    const { kernel, identity: id } = await identity.start();
    const me = await makeUser(kernel.pool, { status: 'pending' });
    const role = await makeRole(kernel.pool, {
      permissions: ['core.identity.user.approve', 'core.authz.role.assign'],
    });
    await makeRoleAssignment(kernel.pool, me, role);
    await expect(id.approval.approve(actorOf(me), me.id)).rejects.toBeInstanceOf(Forbidden);
    expect(await rowOf(kernel, me.id)).toMatchObject({ status: 'pending' });
    // Only the custom role: no `user` role came with the refused approval.
    expect((await rolesOf(kernel, me.id)).map((r) => r.key)).toEqual([role.key]);
  });
});
