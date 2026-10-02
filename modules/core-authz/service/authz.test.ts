// core.authz on real Postgres: the seed, the decision, roles as data, the built-in protections and
// the cache. Every service method has a denied case; the multi-row writes have a rollback case.
import { Conflict, Forbidden, Invalid, NotFound, Unauthorized } from '@scorpion/contracts';
import type { Actor, UserActor } from '@scorpion/contracts';
import { makeRole, makeRoleAssignment } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { notesModule, useAuthz, type Started } from '../test/harness.ts';

const harness = useAuthz();

const READ = 'fix.notes.read';
const APPROVE = 'fix.notes.approve';
const EDIT = 'fix.notes.edit';
const ROLE_READ = 'core.authz.role.read';
const ROLE_ASSIGN = 'core.authz.role.assign';
const ROLE_MANAGE = 'core.authz.role.manage';

const anonymous: Actor = { kind: 'anonymous' };
const actorFor = (userId: string): UserActor => ({
  kind: 'user',
  userId,
  username: `u-${userId.slice(0, 6)}`,
  roles: [],
  via: 'session',
});

type Pool = Started['kernel']['pool'];
const rows = async (pool: Pool, sql: string, values?: unknown[]) =>
  (await pool.query(sql, values)).rows as Record<string, unknown>[];
const stored = async (pool: Pool, key: string) =>
  (
    await rows(
      pool,
      `select p.permission from authz_role_permission p join authz_role r on r.id = p.role_id
       where r.key = $1 order by 1`,
      [key],
    )
  ).map((r) => r.permission);

/** A user who holds a role (by key) or a freshly made role with the given permissions. */
async function userWith(pool: Pool, role: string | { permissions: string[] }) {
  const user = { id: randomUUID() };
  await makeRoleAssignment(
    pool,
    user,
    typeof role === 'string' ? role : await makeRole(pool, { permissions: role.permissions }),
  );
  return actorFor(user.id);
}

const start = (options: Parameters<typeof harness.start>[0] = {}) =>
  harness.start({ modules: [notesModule()], ...options });

describe('the seed', () => {
  it('creates Admin, Reviewer and User as system roles, with UUIDv7 keys', async () => {
    const { kernel } = await start();
    const roles = await rows(
      kernel.pool,
      'select id, key, label, system from authz_role order by key',
    );
    expect(roles.map((r) => [r.key, r.label, r.system])).toEqual([
      ['admin', 'Admin', true],
      ['reviewer', 'Reviewer', true],
      ['user', 'User', true],
    ]);
    for (const r of roles) expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('is idempotent: a second start changes nothing, also while two start at once', async () => {
    const first = await start();
    const before = await rows(first.kernel.pool, 'select * from authz_role order by key');
    const [a, b] = await Promise.all([
      harness.start({ databaseUrl: first.databaseUrl, modules: [notesModule()] }),
      harness.start({ databaseUrl: first.databaseUrl, modules: [notesModule()] }),
    ]);
    expect(await rows(a.kernel.pool, 'select * from authz_role order by key')).toEqual(before);
    expect(b.logs.join('')).not.toMatch(/error/i);
  });

  it('applies contributed default permissions once, so an administrator can take one away', async () => {
    const contributes = {
      'authz.defaultRole': [{ role: 'reviewer', permissions: [READ, APPROVE] }],
    };
    const first = await start({ modules: [notesModule({ contributes })] });
    expect(await stored(first.kernel.pool, 'reviewer')).toEqual([READ, APPROVE].sort());

    const admin = await userWith(first.kernel.pool, 'admin');
    await first.authz.setRolePermissions(admin, 'reviewer', [READ]);
    await first.kernel.stop();

    const second = await harness.start({
      databaseUrl: first.databaseUrl,
      modules: [notesModule({ contributes })],
    });
    expect(await stored(second.kernel.pool, 'reviewer')).toEqual([READ]);
  });

  it('lets a module added later give existing roles its defaults', async () => {
    const first = await start({ modules: [] });
    const later = notesModule({
      contributes: { 'authz.defaultRole': [{ role: 'user', permissions: [READ] }] },
    });
    const second = await harness.start({ databaseUrl: first.databaseUrl, modules: [later] });
    expect(await stored(second.kernel.pool, 'user')).toEqual([READ]);
  });

  it('ignores, and logs, a default that names an undeclared permission or a missing role', async () => {
    const contributes = {
      'authz.defaultRole': [
        { role: 'reviewer', permissions: ['nobody.declares.this', READ] },
        { role: 'no-such-role', permissions: [READ] },
      ],
    };
    const { kernel, logs } = await start({ modules: [notesModule({ contributes })] });
    expect(await stored(kernel.pool, 'reviewer')).toEqual([READ]);
    expect(await stored(kernel.pool, 'no-such-role')).toEqual([]);
    const log = logs.join('');
    expect(log).toContain('nobody.declares.this');
    expect(log).toContain('no-such-role');
  });

  it('rolls the whole seed back when one grant fails', async () => {
    const first = await start({ modules: [] });
    await first.kernel.pool.query(
      `alter table authz_role_permission add constraint seed_fails check (permission <> '${READ}')`,
    );
    const contributes = {
      'authz.defaultRole': [{ role: 'reviewer', permissions: [APPROVE, READ] }],
    };
    await expect(
      harness.start({ databaseUrl: first.databaseUrl, modules: [notesModule({ contributes })] }),
    ).rejects.toThrow();
    // APPROVE was granted before READ failed: nothing of it may stay.
    expect(await rows(first.kernel.pool, 'select * from authz_default_grant')).toEqual([]);
    expect(await stored(first.kernel.pool, 'reviewer')).toEqual([]);
  });
});

describe('require and can', () => {
  it('answers 401 for anonymous, 403 for a user without roles, and lets a holder through', async () => {
    const { authz, kernel } = await start();
    const nobody = actorFor(randomUUID());
    const reader = await userWith(kernel.pool, { permissions: [READ] });

    await expect(authz.require(anonymous, READ)).rejects.toBeInstanceOf(Unauthorized);
    await expect(authz.require(nobody, READ)).rejects.toBeInstanceOf(Forbidden);
    await expect(authz.require(reader, READ)).resolves.toBeUndefined();
    await expect(authz.require(reader, APPROVE)).rejects.toBeInstanceOf(Forbidden);

    expect(await authz.can(anonymous, READ)).toBe(false);
    expect(await authz.can(nobody, READ)).toBe(false);
    expect(await authz.can(reader, READ)).toBe(true);
  });

  it('gives Admin every declared permission without copying them, also those of modules added later', async () => {
    const first = await start({ modules: [] });
    const admin = await userWith(first.kernel.pool, 'admin');
    expect(await stored(first.kernel.pool, 'admin')).toEqual([]);
    await expect(first.authz.require(admin, ROLE_MANAGE)).resolves.toBeUndefined();
    await expect(first.authz.require(admin, READ)).rejects.toBeInstanceOf(Forbidden); // not declared yet

    const second = await harness.start({
      databaseUrl: first.databaseUrl,
      modules: [notesModule()],
    });
    await expect(second.authz.require(admin, READ)).resolves.toBeUndefined();
    expect(await stored(second.kernel.pool, 'admin')).toEqual([]);
  });

  it('never grants a permission that no loaded module declares, and logs the stored one once', async () => {
    const { authz, kernel, logs } = await start();
    const odd = await userWith(kernel.pool, { permissions: ['gone.module.do', READ] });
    expect(await authz.can(odd, READ)).toBe(true);
    expect(await authz.can(odd, 'gone.module.do')).toBe(false);
    await expect(authz.require(odd, 'gone.module.do')).rejects.toBeInstanceOf(Forbidden);
    // An Admin does not get it either: it is not declared.
    const admin = await userWith(kernel.pool, 'admin');
    expect(await authz.can(admin, 'gone.module.do')).toBe(false);
    expect(logs.filter((line) => line.includes('stored permission')).length).toBe(1);
  });

  it('treats an actor id that is not a UUID as holding nothing, not as an error', async () => {
    const { authz } = await start();
    expect(await authz.can(actorFor('not-a-uuid'), READ)).toBe(false);
  });

  it('adds up several roles', async () => {
    const { authz, kernel } = await start();
    const user = { id: randomUUID() };
    await makeRoleAssignment(
      kernel.pool,
      user,
      await makeRole(kernel.pool, { permissions: [READ] }),
    );
    await makeRoleAssignment(
      kernel.pool,
      user,
      await makeRole(kernel.pool, { permissions: [APPROVE] }),
    );
    const actor = actorFor(user.id);
    expect(await authz.can(actor, READ)).toBe(true);
    expect(await authz.can(actor, APPROVE)).toBe(true);
  });
});

describe('built-in protection: nobody approves their own request', () => {
  it('refuses it for the holder of the permission and for Admin, and allows another approver', async () => {
    const { authz, kernel } = await start();
    const reviewer = await userWith(kernel.pool, { permissions: [APPROVE] });
    const admin = await userWith(kernel.pool, 'admin');
    const own = (actor: UserActor) => ({ type: 'note', approval: true, requestedBy: actor.userId });

    await expect(authz.require(reviewer, APPROVE, own(reviewer))).rejects.toBeInstanceOf(Forbidden);
    await expect(authz.require(admin, APPROVE, own(admin))).rejects.toBeInstanceOf(Forbidden);
    expect(await authz.can(admin, APPROVE, own(admin))).toBe(false);

    const request = { type: 'note', approval: true, requestedBy: randomUUID() };
    await expect(authz.require(reviewer, APPROVE, request)).resolves.toBeUndefined();
    await expect(authz.require(admin, APPROVE, request)).resolves.toBeUndefined();
    // Without the flag it is an ordinary check.
    await expect(
      authz.require(reviewer, APPROVE, { type: 'note', requestedBy: reviewer.userId }),
    ).resolves.toBeUndefined();
  });

  it('cannot be undone by a resource policy', async () => {
    const policy = { resourceType: 'note', allows: () => true };
    const { authz } = await start({
      modules: [notesModule({ contributes: { 'authz.resourcePolicy': [policy] } })],
    });
    const actor = actorFor(randomUUID());
    expect(await authz.can(actor, EDIT, { type: 'note', id: '1' })).toBe(true);
    expect(
      await authz.can(actor, EDIT, { type: 'note', approval: true, requestedBy: actor.userId }),
    ).toBe(false);
  });
});

describe('resource policies', () => {
  const member = randomUUID();
  const policy = {
    resourceType: 'note',
    allows: ({ actor, resource }: { actor: UserActor; resource: { id?: string } }) =>
      actor.userId === member && resource.id === 'mine',
  };
  const withPolicy = () =>
    start({ modules: [notesModule({ contributes: { 'authz.resourcePolicy': [policy] } })] });

  it('lets a policy add access to one resource for a caller without the global permission', async () => {
    const { authz } = await withPolicy();
    const actor = actorFor(member);
    await expect(authz.require(actor, EDIT, { type: 'note', id: 'mine' })).resolves.toBeUndefined();
    await expect(authz.require(actor, EDIT, { type: 'note', id: 'other' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(authz.require(actor, EDIT)).rejects.toBeInstanceOf(Forbidden); // no resource, no policy
    await expect(
      authz.require(actorFor(randomUUID()), EDIT, { type: 'note', id: 'mine' }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('consults policies only for permissions that declare that scope', async () => {
    const { authz } = await withPolicy();
    // READ has no scope: the policy for "note" does not apply to it.
    expect(await authz.can(actorFor(member), READ, { type: 'note', id: 'mine' })).toBe(false);
    // A resource of another type does not match the scope of EDIT.
    expect(await authz.can(actorFor(member), EDIT, { type: 'page', id: 'mine' })).toBe(false);
  });

  it('does not grant when a policy throws', async () => {
    const boom = {
      resourceType: 'note',
      allows: () => {
        throw new Error('policy broke');
      },
    };
    const { authz } = await start({
      modules: [notesModule({ contributes: { 'authz.resourcePolicy': [boom] } })],
    });
    await expect(
      authz.require(actorFor(randomUUID()), EDIT, { type: 'note', id: 'x' }),
    ).rejects.toThrow('policy broke');
  });

  it('does not consult a policy for a caller who holds the permission globally', async () => {
    let asked = 0;
    const counting = {
      resourceType: 'note',
      allows: () => {
        asked += 1;
        return false;
      },
    };
    const { authz, kernel } = await start({
      modules: [notesModule({ contributes: { 'authz.resourcePolicy': [counting] } })],
    });
    const editor = await userWith(kernel.pool, { permissions: [EDIT] });
    await authz.require(editor, EDIT, { type: 'note', id: 'x' });
    expect(asked).toBe(0);
  });

  it('refuses a registry entry that is not a policy', async () => {
    await expect(
      start({
        modules: [
          notesModule({ contributes: { 'authz.resourcePolicy': [{ resourceType: 'x' }] } }),
        ],
      }),
    ).rejects.toThrow(/resourcePolicy/);
  });
});

describe('the cache', () => {
  it('serves a decision from memory for the TTL, then asks the database again', async () => {
    let now = 1_000_000;
    const { authz, kernel } = await start({ now: () => now, cacheTtlMs: 5_000 });
    const user = { id: randomUUID() };
    const role = await makeRole(kernel.pool, { permissions: [READ] });
    const assignment = await makeRoleAssignment(kernel.pool, user, role);
    const actor = actorFor(user.id);

    expect(await authz.can(actor, READ)).toBe(true);
    // Another process revokes it: this one does not know yet.
    await kernel.pool.query('delete from authz_role_assignment where id = $1', [assignment.id]);
    now += 4_999;
    expect(await authz.can(actor, READ)).toBe(true);
    now += 1;
    expect(await authz.can(actor, READ)).toBe(false);
  });

  it('is emptied at once in this process when a role is removed, assigned or edited', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    const target = actorFor(randomUUID());

    await authz.assignRole(admin, { userId: target.userId, roleKey: 'admin' });
    expect(await authz.can(target, ROLE_MANAGE)).toBe(true); // cached as true
    await authz.removeRole(admin, { userId: target.userId, roleKey: 'admin' });
    expect(await authz.can(target, ROLE_MANAGE)).toBe(false);

    await authz.assignRole(admin, { userId: target.userId, roleKey: 'reviewer' });
    expect(await authz.can(target, READ)).toBe(false); // cached as false
    await authz.setRolePermissions(admin, 'reviewer', [READ]);
    expect(await authz.can(target, READ)).toBe(true);
    await authz.setRolePermissions(admin, 'reviewer', []);
    expect(await authz.can(target, READ)).toBe(false);
  });

  it('keeps a demoted user in another process for at most the TTL, and not in this one', async () => {
    let now = 5_000_000;
    const first = await start({ now: () => now, cacheTtlMs: 5_000 });
    const second = await harness.start({
      databaseUrl: first.databaseUrl,
      modules: [notesModule()],
      now: () => now,
      cacheTtlMs: 5_000,
    });
    const admin = await userWith(first.kernel.pool, 'admin');
    const target = actorFor(randomUUID());
    await first.authz.assignRole(admin, { userId: target.userId, roleKey: 'admin' });
    expect(await second.authz.can(target, ROLE_MANAGE)).toBe(true);

    await first.authz.removeRole(admin, { userId: target.userId, roleKey: 'admin' });
    expect(await first.authz.can(target, ROLE_MANAGE)).toBe(false); // this process: at once
    expect(await second.authz.can(target, ROLE_MANAGE)).toBe(true); // the other: within the TTL
    now += 5_000;
    expect(await second.authz.can(target, ROLE_MANAGE)).toBe(false);
  });

  it('decides a role change from the database, not from a cache that is out of date', async () => {
    const now = 9_000_000;
    const { authz, kernel } = await start({ now: () => now });
    const manager = await userWith(kernel.pool, { permissions: [ROLE_ASSIGN] });
    expect(await authz.can(manager, ROLE_ASSIGN)).toBe(true); // cached
    await kernel.pool.query('delete from authz_role_assignment where user_id = $1', [
      manager.userId,
    ]);
    // The cache still says yes within the TTL; the write path must not.
    await expect(
      authz.assignRole(manager, { userId: randomUUID(), roleKey: 'user' }),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('listRoles and rolesOf', () => {
  it('lists the roles with declared permissions only; Admin shows all of them', async () => {
    const { authz, kernel } = await start();
    await makeRole(kernel.pool, { key: 'steward', permissions: [READ, 'gone.module.do'] });
    const lister = await userWith(kernel.pool, { permissions: [ROLE_READ] });
    const roles = await authz.listRoles(lister);
    expect(roles.map((r) => r.key)).toEqual(
      expect.arrayContaining(['admin', 'reviewer', 'steward', 'user']),
    );
    expect(roles.find((r) => r.key === 'steward')!.permissions).toEqual([READ]);
    expect(roles.find((r) => r.key === 'admin')!.permissions).toContain(APPROVE);
    expect(roles.find((r) => r.key === 'admin')!.permissions).toContain(ROLE_MANAGE);
  });

  it('is denied without core.authz.role.read, and to anonymous', async () => {
    const { authz, kernel } = await start();
    const plain = await userWith(kernel.pool, { permissions: [READ] });
    await expect(authz.listRoles(plain)).rejects.toBeInstanceOf(Forbidden);
    await expect(authz.listRoles(anonymous)).rejects.toBeInstanceOf(Unauthorized);
  });

  it('tells you your own roles, and others only with core.authz.role.read', async () => {
    const { authz, kernel } = await start();
    const reviewer = await userWith(kernel.pool, 'reviewer');
    const other = await userWith(kernel.pool, 'user');
    const lister = await userWith(kernel.pool, { permissions: [ROLE_READ] });
    expect(await authz.rolesOf(reviewer, reviewer.userId)).toEqual(['reviewer']);
    await expect(authz.rolesOf(reviewer, other.userId)).rejects.toBeInstanceOf(Forbidden);
    expect(await authz.rolesOf(lister, other.userId)).toEqual(['user']);
    await expect(authz.rolesOf(anonymous, other.userId)).rejects.toBeInstanceOf(Unauthorized);
    expect(await authz.rolesOf(lister, 'not-a-uuid')).toEqual([]);
  });
});

describe('assignRole and removeRole', () => {
  it('assigns and removes a role, records who did it, and is idempotent', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    const target = randomUUID();

    expect(await authz.assignRole(admin, { userId: target, roleKey: 'reviewer' })).toBe(true);
    expect(await authz.assignRole(admin, { userId: target, roleKey: 'reviewer' })).toBe(false);
    const [row] = await rows(
      kernel.pool,
      'select assigned_by from authz_role_assignment where user_id = $1',
      [target],
    );
    expect(row!.assigned_by).toBe(admin.userId);
    expect(await authz.rolesOf(admin, target)).toEqual(['reviewer']);

    expect(await authz.removeRole(admin, { userId: target, roleKey: 'reviewer' })).toBe(true);
    expect(await authz.removeRole(admin, { userId: target, roleKey: 'reviewer' })).toBe(false);
    expect(await authz.rolesOf(admin, target)).toEqual([]);
  });

  it('is denied without core.authz.role.assign, to anonymous, and leaves no row', async () => {
    const { authz, kernel } = await start();
    const reviewer = await userWith(kernel.pool, { permissions: [READ, ROLE_READ, ROLE_MANAGE] });
    const target = randomUUID();
    await expect(
      authz.assignRole(reviewer, { userId: target, roleKey: 'admin' }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      authz.assignRole(anonymous, { userId: target, roleKey: 'admin' }),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      authz.removeRole(reviewer, { userId: target, roleKey: 'admin' }),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(
      await rows(kernel.pool, 'select * from authz_role_assignment where user_id = $1', [target]),
    ).toEqual([]);
  });

  it('refuses changing your own roles, even for Admin and in any letter case', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    const second = await userWith(kernel.pool, 'admin');
    for (const userId of [admin.userId, admin.userId.toUpperCase()]) {
      await expect(authz.assignRole(admin, { userId, roleKey: 'reviewer' })).rejects.toMatchObject({
        constructor: Forbidden,
        message: 'You cannot change your own roles.',
      });
      await expect(authz.removeRole(admin, { userId, roleKey: 'admin' })).rejects.toBeInstanceOf(
        Forbidden,
      );
    }
    expect(await authz.rolesOf(second, admin.userId)).toEqual(['admin']);
  });

  it('rejects an unknown role (404) and a user id that is not a UUID (422)', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    await expect(
      authz.assignRole(admin, { userId: randomUUID(), roleKey: 'nope' }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      authz.removeRole(admin, { userId: randomUUID(), roleKey: 'nope' }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      authz.assignRole(admin, { userId: 'x; drop table', roleKey: 'user' }),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('cannot remove the last Admin, but can once another one exists', async () => {
    const { authz, kernel } = await start();
    const keeper = await userWith(kernel.pool, { permissions: [ROLE_ASSIGN] });
    const onlyAdmin = { id: randomUUID() };
    await makeRoleAssignment(kernel.pool, onlyAdmin, 'admin');

    await expect(
      authz.removeRole(keeper, { userId: onlyAdmin.id, roleKey: 'admin' }),
    ).rejects.toBeInstanceOf(Conflict);
    expect(await authz.rolesOf(keeper, onlyAdmin.id).catch(() => 'denied')).toBe('denied'); // keeper may not read

    const next = randomUUID();
    await authz.assignRole(keeper, { userId: next, roleKey: 'admin' });
    await expect(
      authz.removeRole(keeper, { userId: onlyAdmin.id, roleKey: 'admin' }),
    ).resolves.toBe(true);
    await expect(
      authz.removeRole(keeper, { userId: next, roleKey: 'admin' }),
    ).rejects.toBeInstanceOf(Conflict);
    const left = await rows(
      kernel.pool,
      `select user_id from authz_role_assignment a join authz_role r on r.id = a.role_id where r.key = 'admin'`,
    );
    expect(left.map((r) => r.user_id)).toEqual([next]);
  });

  it('cannot lose the last Admin to two removals at once', async () => {
    const { authz, kernel } = await start();
    const keeper = await userWith(kernel.pool, { permissions: [ROLE_ASSIGN] });
    // Run the race several times; with the lock it never ends with no Admin.
    for (let round = 0; round < 8; round += 1) {
      await kernel.pool.query(
        `delete from authz_role_assignment a using authz_role r where r.id = a.role_id and r.key = 'admin'`,
      );
      const a = { id: randomUUID() };
      const b = { id: randomUUID() };
      await makeRoleAssignment(kernel.pool, a, 'admin');
      await makeRoleAssignment(kernel.pool, b, 'admin');
      const results = await Promise.allSettled([
        authz.removeRole(keeper, { userId: a.id, roleKey: 'admin' }),
        authz.removeRole(keeper, { userId: b.id, roleKey: 'admin' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(Conflict);
      const [{ n }] = (await rows(
        kernel.pool,
        `select count(*)::int as n from authz_role_assignment a join authz_role r on r.id = a.role_id where r.key = 'admin'`,
      )) as [{ n: number }];
      expect(n).toBe(1);
    }
  });

  it('rolls an assignment back with the caller transaction', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    const target = randomUUID();
    await expect(
      kernel.db.tx(async () => {
        await authz.assignRole(admin, { userId: target, roleKey: 'reviewer' });
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(
      await rows(kernel.pool, 'select * from authz_role_assignment where user_id = $1', [target]),
    ).toEqual([]);
  });

  it('has no foreign key to a user, so an assignment can outlive and precede any user row', async () => {
    const { kernel } = await start();
    const fks = await rows(
      kernel.pool,
      `select conname from pg_constraint where conrelid = 'authz_role_assignment'::regclass and contype = 'f'`,
    );
    expect(fks.map((r) => r.conname)).toEqual(['authz_role_assignment_role_id_authz_role_id_fk']);
  });
});

describe('setRolePermissions', () => {
  it('replaces the stored permissions, deduplicated, and returns the role', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    const role = await authz.setRolePermissions(admin, 'reviewer', [READ, APPROVE, READ]);
    expect(role).toEqual({
      key: 'reviewer',
      label: 'Reviewer',
      system: true,
      permissions: [APPROVE, READ].sort(),
    });
    const replaced = await authz.setRolePermissions(admin, 'reviewer', [EDIT]);
    expect(replaced.permissions).toEqual([EDIT]);
    expect(await stored(kernel.pool, 'reviewer')).toEqual([EDIT]);
  });

  it('is denied without core.authz.role.manage and to anonymous', async () => {
    const { authz, kernel } = await start();
    const assigner = await userWith(kernel.pool, { permissions: [ROLE_ASSIGN, ROLE_READ] });
    await expect(authz.setRolePermissions(assigner, 'reviewer', [READ])).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(authz.setRolePermissions(anonymous, 'reviewer', [READ])).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(await stored(kernel.pool, 'reviewer')).toEqual([]);
  });

  it('rejects an undeclared permission (422) and stores nothing, not even the valid ones', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    await authz.setRolePermissions(admin, 'reviewer', [READ]);
    await expect(
      authz.setRolePermissions(admin, 'reviewer', [APPROVE, 'made.up.permission']),
    ).rejects.toMatchObject({
      constructor: Invalid,
      errors: [{ path: 'permissions', message: '"made.up.permission" is not a known permission.' }],
    });
    expect(await stored(kernel.pool, 'reviewer')).toEqual([READ]);
  });

  it('cannot edit Admin, and reports an unknown role', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    await expect(authz.setRolePermissions(admin, 'admin', [READ])).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(authz.setRolePermissions(admin, 'nope', [READ])).rejects.toBeInstanceOf(NotFound);
    expect(await stored(kernel.pool, 'admin')).toEqual([]);
  });

  it('rolls back the delete and the insert together', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    await authz.setRolePermissions(admin, 'reviewer', [READ, APPROVE]);
    await expect(
      kernel.db.tx(async () => {
        await authz.setRolePermissions(admin, 'reviewer', [EDIT]);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await stored(kernel.pool, 'reviewer')).toEqual([APPROVE, READ].sort());
  });

  it('rolls back when the insert fails after the delete', async () => {
    const { authz, kernel } = await start();
    const admin = await userWith(kernel.pool, 'admin');
    await authz.setRolePermissions(admin, 'reviewer', [READ]);
    await kernel.pool.query(
      `alter table authz_role_permission add constraint insert_fails check (permission <> '${EDIT}')`,
    );
    await expect(authz.setRolePermissions(admin, 'reviewer', [APPROVE, EDIT])).rejects.toThrow();
    expect(await stored(kernel.pool, 'reviewer')).toEqual([READ]);
  });
});
