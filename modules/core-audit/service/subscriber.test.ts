// The event subscriber: the trail records what the modules emit, with the right actor, once.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeUser } from '@scorpion/testing';
import { useAudit } from '../test/harness.ts';

const audit = useAudit();

describe('the subscriber: one row per event, with the actor that caused it', () => {
  it('records a role change with the administrator as the actor', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const target = await makeUser(s.pool);
    await s.authz.assignRole(admin, { userId: target.id, roleKey: 'reviewer' });
    await s.authz.removeRole(admin, { userId: target.id, roleKey: 'reviewer' });
    await s.dispatch();

    const rows = await s.rows('subject_id = $1 and source = $2', [target.id, 'event']);
    expect(rows.map((r) => r.action)).toEqual(['authz.role.assigned@1', 'authz.role.removed@1']);
    for (const row of rows) {
      expect(row).toMatchObject({
        source: 'event',
        outcome: 'ok',
        actor_kind: 'user',
        user_id: admin.userId,
        subject_type: 'user',
        subject_id: target.id,
        payload: { userId: target.id, roleKey: 'reviewer', actorId: admin.userId },
      });
      expect(row.event_id).not.toBeNull();
    }
  });

  it('records a change of the permissions of a role: who, which role, which strings, and nothing about users', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    await s.authz.setRolePermissions(admin, 'reviewer', ['core.audit.read']);
    await s.authz.setRolePermissions(admin, 'reviewer', ['core.audit.read']); // no change: no event
    await s.authz.setRolePermissions(admin, 'reviewer', ['core.audit.export']);
    await s.dispatch();

    const rows = (
      await s.rows('action = $1 and user_id = $2', [
        'authz.role.permissions.changed@1',
        admin.userId,
      ])
    ).filter((r) => (r.payload as { roleKey?: string }).roleKey === 'reviewer');
    const last = rows.at(-1)!;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(last).toMatchObject({
      actor_kind: 'user',
      user_id: admin.userId,
      subject_type: 'role',
      subject_id: 'reviewer',
      payload: {
        roleKey: 'reviewer',
        added: ['core.audit.export'],
        removed: ['core.audit.read'],
        actorId: admin.userId,
      },
    });
    expect(Object.keys(last.payload as object).sort()).toEqual([
      'actorId',
      'added',
      'removed',
      'roleKey',
    ]);
    // The unchanged save left no row of its own.
    expect(
      rows.filter((r) => JSON.stringify((r.payload as { added: string[] }).added) === '[]'),
    ).toHaveLength(0);
  });

  it('records a settings change with the administrator as the actor, the keys and never the values', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    await s.settingsStore.settings.update(admin, 'core.notifications', {
      version: 0,
      values: { defaultLocale: 'de', maxAttempts: 5 },
    });
    await s.dispatch();
    const [row] = await s.rows('action = $1 and subject_id = $2', [
      'settings.changed@1',
      'core.notifications',
    ]);
    expect(row).toMatchObject({
      actor_kind: 'user',
      user_id: admin.userId,
      subject_type: 'settings',
      payload: { module: 'core.notifications', version: 1, actorId: admin.userId },
    });
    expect((row!.payload as { keys: string[] }).keys).toEqual(['defaultLocale', 'maxAttempts']);
    expect(JSON.stringify(row!.payload)).not.toContain('"de"');
  });

  it('records a secret change by name only, never the value', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const value = `value-${randomUUID()}`;
    await s.settingsStore.secrets.set(admin, 'audit.test.secret', value);
    await s.settingsStore.secrets.remove(admin, 'audit.test.secret');
    await s.dispatch();
    const rows = await s.rows('subject_id = $1', ['audit.test.secret']);
    expect(rows.map((r) => (r.payload as { removed: boolean }).removed)).toEqual([false, true]);
    expect(rows[0]).toMatchObject({
      user_id: admin.userId,
      payload: { name: 'audit.test.secret' },
    });
    expect(JSON.stringify(rows)).not.toContain(value);
  });

  it('records an approval with the approver as the actor', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const pending = await makeUser(s.pool, { status: 'pending' });
    await s.identity.approval.approve(admin, pending.id, { role: 'user' });
    await s.dispatch();
    const rows = await s.rows('subject_id = $1', [pending.id]);
    const approved = rows.find((r) => r.action === 'identity.user.approved@1')!;
    expect(approved).toMatchObject({
      user_id: admin.userId,
      actor_kind: 'user',
      payload: { userId: pending.id, approvedBy: admin.userId, role: 'user' },
    });
    // The role the approval gave is its own entry, by the same actor.
    expect(rows.find((r) => r.action === 'authz.role.assigned@1')).toMatchObject({
      user_id: admin.userId,
    });
  });

  it('records a token revoke with the revoking administrator as the actor, not the owner', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const owner = await s.actor('user');
    const made = await s.identity.tokens.create(owner, {
      name: 'audited',
      scopes: ['core.identity.me.read'],
    });
    await s.identity.tokens.revoke(admin, made.id);
    await s.dispatch();
    const rows = await s.rows('subject_id = $1', [made.id]);
    expect(rows.map((r) => r.action)).toEqual([
      'identity.token.created@1',
      'identity.token.revoked@1',
    ]);
    expect(rows[0]).toMatchObject({ user_id: owner.userId });
    expect(rows[1]).toMatchObject({
      actor_kind: 'user',
      user_id: admin.userId,
      payload: { userId: owner.userId, revokedBy: admin.userId },
    });
    // The token itself is nowhere.
    expect(JSON.stringify(rows)).not.toContain(made.token);
  });

  it('keeps an actor id that matches no user, as written', async () => {
    const s = await audit.startShared();
    const ghost = randomUUID();
    const victim = randomUUID();
    await s.audit.store.recordEvent({
      id: randomUUID(),
      name: 'authz.role.assigned@1',
      payload: { userId: victim, roleKey: 'user', actorId: ghost },
      occurredAt: new Date(),
    });
    const [row] = await s.rows('subject_id = $1', [victim]);
    expect(row).toMatchObject({ user_id: ghost, actor_kind: 'user' });
  });

  it('records a system event with the actor kind `system`, and an event with no actor as system', async () => {
    const s = await audit.startShared();
    const userId = randomUUID();
    await s.audit.store.recordEvent({
      id: randomUUID(),
      name: 'authz.role.assigned@1',
      payload: { userId, roleKey: 'admin', actorId: null },
      occurredAt: new Date(),
    });
    const [row] = await s.rows('subject_id = $1', [userId]);
    expect(row).toMatchObject({ actor_kind: 'system', user_id: null });
  });

  it('is idempotent: the same event delivered twice makes one row', async () => {
    const s = await audit.startShared();
    const event = {
      id: randomUUID(),
      name: 'settings.changed@1',
      payload: { module: 'core.audit', keys: ['x'], version: 9, actorId: null },
      occurredAt: new Date(),
    };
    await s.audit.store.recordEvent(event);
    await s.audit.store.recordEvent(event);
    expect(await s.rows('event_id = $1', [event.id])).toHaveLength(1);
  });

  it('does not store a username: the id is enough, and a name cannot be erased from an append-only table', async () => {
    const s = await audit.startShared();
    const userId = randomUUID();
    await s.audit.store.recordEvent({
      id: randomUUID(),
      name: 'identity.user.registered@1',
      payload: { userId, username: 'secret-person', status: 'pending' },
      occurredAt: new Date(),
    });
    const [row] = await s.rows('subject_id = $1', [userId]);
    expect(row!.payload).toEqual({ userId, status: 'pending' });
    expect(JSON.stringify(row)).not.toContain('secret-person');
  });

  it('uses the time of the event, not the time of the delivery', async () => {
    const s = await audit.startShared();
    const at = new Date('2026-01-02T03:04:05.000Z');
    const userId = randomUUID();
    await s.audit.store.recordEvent({
      id: randomUUID(),
      name: 'identity.password.changed@1',
      payload: { userId, username: 'x' },
      occurredAt: at,
    });
    const [row] = await s.rows('subject_id = $1', [userId]);
    expect(row!.occurred_at.toISOString()).toBe(at.toISOString());
  });

  it('skips an event it has no decision to log for, and a payload that is not an object', async () => {
    const s = await audit.startShared();
    const before = (await s.rows()).length;
    await s.audit.store.recordEvent({
      id: randomUUID(),
      name: 'settings.preference.changed@1',
      payload: { userId: randomUUID(), key: 'k', removed: false },
      occurredAt: new Date(),
    });
    await s.audit.store.recordEvent({
      id: randomUUID(),
      name: 'not.an.event@1',
      payload: null,
      occurredAt: new Date(),
    });
    expect(await s.rows()).toHaveLength(before);
  });
});

describe('the channels setting', () => {
  it('switches the admin channel off for ordinary events and never for the security-critical ones', async () => {
    const s = await audit.start({ auditSettings: { channels: { admin: false, api: true } } });
    const admin = await s.actor('admin');
    const target = await makeUser(s.pool);
    await s.authz.assignRole(admin, { userId: target.id, roleKey: 'reviewer' }); // critical: role
    await s.dispatch();
    // A vocabulary change is an ordinary administrative event.
    await s.audit.store.recordEvent({
      id: randomUUID(),
      name: 'settings.vocabulary.changed@1',
      payload: { vocabulary: 'stage', key: 'X', change: 'created', actorId: admin.userId },
      occurredAt: new Date(),
    });
    expect((await s.rows('action = $1', ['authz.role.assigned@1'])).length).toBeGreaterThan(0);
    expect(await s.rows('action = $1', ['settings.vocabulary.changed@1'])).toHaveLength(0);
  });
});
