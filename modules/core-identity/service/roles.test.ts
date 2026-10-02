// The role service of core.identity on real Postgres, with the real core.authz: the two
// permissions (identity's and authz's), the built-in protections, and what a refusal leaves behind.
import { ANONYMOUS, Conflict, Forbidden, NotFound, Unauthorized } from '@scorpion/contracts';
import { makeRole, makeUser } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';

const identity = useIdentity();

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
const rolesOf = async (kernel: { pool: Pool }, userId: string) =>
  (
    await rows(
      kernel,
      `select r.key from authz_role_assignment a join authz_role r on r.id = a.role_id
       where a.user_id = $1 order by r.key`,
      [userId],
    )
  ).map((r) => r.key);

async function start() {
  const started = await identity.start();
  const admin = await makeUser(started.kernel.pool, { username: 'root' });
  const adminActor = await started.actorOf(admin, 'admin');
  const target = await makeMember(started.kernel.pool, { username: 'target' });
  return { ...started, admin, adminActor, target, roles: started.identity.roles };
}

describe('list', () => {
  it('lists the roles for Admin, with the permissions each holds', async () => {
    const { roles, adminActor } = await start();
    const list = await roles.list(adminActor);
    expect(list.map((r) => r.key)).toEqual(['admin', 'reviewer', 'user']);
    expect(list.find((r) => r.key === 'user')!.permissions).toContain('core.identity.me.read');
    expect(list.find((r) => r.key === 'admin')!.permissions).toContain('core.identity.role.assign');
  });

  it('is denied to a plain user, to a user without roles and to anonymous', async () => {
    const { kernel, roles, identity: id } = await start();
    const plain = await makeMember(kernel.pool);
    const roleless = await makeUser(kernel.pool);
    for (const user of [plain, roleless]) {
      await expect(
        roles.list({
          kind: 'user',
          userId: user.id,
          username: user.username,
          roles: [],
          via: 'session',
        }),
      ).rejects.toBeInstanceOf(Forbidden);
    }
    await expect(roles.list(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    expect(id).toBeDefined();
  });

  it('needs both permissions: identity.role.read alone is not enough', async () => {
    const { kernel, roles, actorOf } = await start();
    const half = await makeUser(kernel.pool);
    const role = await makeRole(kernel.pool, { permissions: ['core.identity.role.read'] });
    await expect(roles.list(await actorOf(half, role.key))).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('assign and remove', () => {
  it('gives a user a role and takes it away, recording who did it, and reports whether it changed anything', async () => {
    const { kernel, roles, adminActor, admin, target } = await start();
    expect(await roles.assign(adminActor, target.id, 'reviewer')).toBe(true);
    expect(await roles.assign(adminActor, target.id, 'reviewer')).toBe(false);
    expect(await rolesOf(kernel, target.id)).toEqual(['reviewer', 'user']);
    expect(
      await rows(
        kernel,
        `select assigned_by from authz_role_assignment a join authz_role r on r.id = a.role_id where r.key = 'reviewer'`,
      ),
    ).toEqual([{ assigned_by: admin.id }]);
    expect(await roles.remove(adminActor, target.id, 'reviewer')).toBe(true);
    expect(await roles.remove(adminActor, target.id, 'reviewer')).toBe(false);
    expect(await rolesOf(kernel, target.id)).toEqual(['user']);
  });

  it('answers 404 for an unknown user, a deleted one and an unknown role, and changes nothing', async () => {
    const { kernel, roles, adminActor, target } = await start();
    const deleted = await makeUser(kernel.pool, { deleted: true, status: 'rejected' });
    for (const id of [randomUUID(), 'not-a-uuid', deleted.id]) {
      await expect(roles.assign(adminActor, id, 'reviewer')).rejects.toBeInstanceOf(NotFound);
      await expect(roles.remove(adminActor, id, 'reviewer')).rejects.toBeInstanceOf(NotFound);
    }
    await expect(roles.assign(adminActor, target.id, 'no-such-role')).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(await rolesOf(kernel, target.id)).toEqual(['user']);
    expect(await rolesOf(kernel, deleted.id)).toEqual([]);
  });

  it('is denied to a plain user, a user without roles and anonymous, and changes nothing', async () => {
    const { kernel, roles, target } = await start();
    const plain = await makeMember(kernel.pool);
    const roleless = await makeUser(kernel.pool);
    for (const user of [plain, roleless]) {
      const actor = {
        kind: 'user',
        userId: user.id,
        username: user.username,
        roles: [],
        via: 'session',
      } as const;
      await expect(roles.assign(actor, target.id, 'admin')).rejects.toBeInstanceOf(Forbidden);
      await expect(roles.remove(actor, target.id, 'user')).rejects.toBeInstanceOf(Forbidden);
      // Nor can they give themselves a role.
      await expect(roles.assign(actor, user.id, 'admin')).rejects.toBeInstanceOf(Forbidden);
    }
    await expect(roles.assign(ANONYMOUS, target.id, 'admin')).rejects.toBeInstanceOf(Unauthorized);
    expect(await rolesOf(kernel, target.id)).toEqual(['user']);
    expect(await rolesOf(kernel, plain.id)).toEqual(['user']);
    expect(await rows(kernel, "select 1 from kernel_outbox where name like 'authz.%'")).toEqual([]);
  });

  it('needs both permissions: core.identity.role.assign without core.authz.role.assign changes nothing', async () => {
    const { kernel, roles, target, actorOf } = await start();
    const half = await makeUser(kernel.pool);
    const role = await makeRole(kernel.pool, { permissions: ['core.identity.role.assign'] });
    const actor = await actorOf(half, role.key);
    await expect(roles.assign(actor, target.id, 'reviewer')).rejects.toBeInstanceOf(Forbidden);
    expect(await rolesOf(kernel, target.id)).toEqual(['user']);
  });

  it('refuses to change your own roles, Admin included, and keeps the last Admin', async () => {
    const { kernel, roles, adminActor, admin } = await start();
    await expect(roles.assign(adminActor, admin.id, 'reviewer')).rejects.toBeInstanceOf(Forbidden);
    await expect(roles.remove(adminActor, admin.id, 'admin')).rejects.toBeInstanceOf(Forbidden);
    expect(await rolesOf(kernel, admin.id)).toEqual(['admin']);

    // With a second Admin, the first can be removed by the second, but not the last one.
    const second = await makeUser(kernel.pool, { username: 'second' });
    await roles.assign(adminActor, second.id, 'admin');
    const secondActor = { ...adminActor, userId: second.id, username: 'second' };
    await expect(roles.remove(secondActor, admin.id, 'admin')).resolves.toBe(true);
    const third = await makeUser(kernel.pool, { username: 'third' });
    await expect(
      roles.remove({ ...adminActor, userId: third.id }, second.id, 'admin'),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await rolesOf(kernel, second.id)).toEqual(['admin']);
    await expect(roles.remove(adminActor, second.id, 'admin')).rejects.toSatisfy(
      (error) => error instanceof Conflict || error instanceof Forbidden,
    );
  });

  it('takes effect at once in this process: a demoted Admin loses access', async () => {
    const { kernel, roles, adminActor, authz } = await start();
    const other = await makeUser(kernel.pool, { username: 'other' });
    await roles.assign(adminActor, other.id, 'admin');
    const otherActor = { ...adminActor, userId: other.id, username: 'other' };
    await expect(authz.require(otherActor, 'core.identity.role.assign')).resolves.toBeUndefined();
    await roles.remove(adminActor, other.id, 'admin');
    await expect(authz.require(otherActor, 'core.identity.role.assign')).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});
