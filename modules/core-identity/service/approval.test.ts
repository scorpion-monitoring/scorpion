import {
  ANONYMOUS,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';

const identity = useIdentity();

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
    const admin = await makeUser(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });

    expect(await id.approval.approve(actorOf(admin), pending.id)).toBe('active');

    const row = await rowOf(kernel, pending.id);
    expect(row).toMatchObject({ status: 'active', deleted_at: null });
    expect(await all(kernel, 'kernel_outbox')).toEqual([
      expect.objectContaining({
        name: 'identity.user.approved@1',
        payload: { userId: pending.id, username: pending.username, approvedBy: admin.id },
      }),
    ]);
  });

  it('refuses to approve your own account, and changes nothing (self-approval)', async () => {
    const { kernel, identity: id } = await identity.start();
    const me = await makeUser(kernel.pool, { status: 'pending' });
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
    const admin = await makeUser(kernel.pool);
    const other = await makeUser(kernel.pool, overrides);
    await expect(id.approval.approve(actorOf(admin), other.id)).rejects.toBeInstanceOf(Conflict);
  });

  it('answers 404 for an unknown id and for text that is not an id', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeUser(kernel.pool);
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
    const a = await makeUser(kernel.pool);
    const b = await makeUser(kernel.pool);
    const pending = await makeUser(kernel.pool, { status: 'pending' });
    const results = await Promise.allSettled([
      id.approval.approve(actorOf(a), pending.id),
      id.approval.approve(actorOf(b), pending.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.any(Conflict) as unknown,
    });
    expect(await all(kernel, 'kernel_outbox')).toHaveLength(1);
  });

  it('rolls back the status when the event cannot be written', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeUser(kernel.pool);
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
    const admin = await makeUser(kernel.pool);
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
    const me = await makeUser(kernel.pool, { status: 'pending' });
    await expect(id.approval.reject(actorOf(me), me.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(id.approval.reject(ANONYMOUS, me.id)).rejects.toBeInstanceOf(Unauthorized);
    const row = await rowOf(kernel, me.id);
    expect(row).toMatchObject({ status: 'pending', deleted_at: null });
  });

  it('answers 409 for an account that is not pending and 404 for an unknown one', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeUser(kernel.pool);
    const active = await makeUser(kernel.pool);
    await expect(id.approval.reject(actorOf(admin), active.id)).rejects.toBeInstanceOf(Conflict);
    await expect(
      id.approval.reject(actorOf(admin), '019a0000-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('rolls back when the event cannot be written', async () => {
    const { kernel, identity: id } = await identity.start();
    const admin = await makeUser(kernel.pool);
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
    const admin = await makeUser(kernel.pool);
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
