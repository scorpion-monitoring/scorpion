import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useAudit, type AuditStarted } from '../test/harness.ts';
import { createSystem } from './system.ts';

const audit = useAudit();

async function deadDelivery(s: AuditStarted, status: 'dead' | 'pending' | 'delivered' = 'dead') {
  const eventId = randomUUID();
  const deliveryId = randomUUID();
  await s.pool.query(
    `insert into kernel_outbox (id, name, emitter, payload)
     values ($1, 'settings.changed@1', 'core.settings', $2::jsonb)`,
    [eventId, JSON.stringify({ module: 'core.audit', keys: ['x'], version: 3, actorId: null })],
  );
  await s.pool.query(
    `insert into kernel_outbox_delivery (id, event_id, subscriber, status, attempts, last_error, next_attempt_at)
     values ($1, $2, 'core.audit', $3, 8, 'boom', now() - interval '1 hour')`,
    [deliveryId, eventId, status],
  );
  return { eventId, deliveryId };
}

describe('the outbox overview', () => {
  it('shows counts and the dead deliveries without any payload', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const { deliveryId } = await deadDelivery(s);
    const overview = await s.audit.system.outbox(admin);
    expect(overview.stats.dead).toBeGreaterThanOrEqual(1);
    const found = overview.dead.find((d) => d.deliveryId === deliveryId)!;
    expect(found).toMatchObject({
      eventName: 'settings.changed@1',
      subscriber: 'core.audit',
      attempts: 8,
      lastError: 'boom',
    });
    expect(Object.keys(found).sort()).toEqual([
      'attempts',
      'deliveryId',
      'eventId',
      'eventName',
      'failedAt',
      'lastError',
      'occurredAt',
      'subscriber',
    ]);
  });

  it('is denied to a plain User and to an anonymous caller', async () => {
    const s = await audit.startShared();
    await expect(s.audit.system.outbox(await s.actor('user'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.audit.system.outbox({ kind: 'anonymous' })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('the job-run history', () => {
  it('pages the runs newest first with their result counts, and filters by name and status', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const name = `core.audit.test-${randomUUID()}`;
    for (const [i, status] of (['succeeded', 'failed', 'succeeded'] as const).entries()) {
      await s.pool.query(
        `insert into kernel_job_run (id, job_name, module, job_id, attempt, status, timeout_seconds, started_at, finished_at, duration_ms, error, result)
         values ($1, $2, 'core.audit', $2, 1, $3, 60, now() - ($4 || ' minutes')::interval, now(), 7, $5, $6::jsonb)`,
        [
          randomUUID(),
          name,
          status,
          String(10 - i),
          status === 'failed' ? 'boom' : null,
          status === 'failed' ? null : JSON.stringify({ removed: i }),
        ],
      );
    }
    const first = await s.audit.system.jobRuns(admin, { jobName: name }, { page: 0, pageSize: 2 });
    expect(first.total).toBe(3);
    expect(first.runs.map((r) => r.result)).toEqual([{ removed: 2 }, null]);
    const rest = await s.audit.system.jobRuns(admin, { jobName: name }, { page: 1, pageSize: 2 });
    expect(rest.runs).toHaveLength(1);
    const failed = await s.audit.system.jobRuns(
      admin,
      { jobName: name, status: 'failed' },
      { page: 0, pageSize: 10 },
    );
    expect(failed.runs.map((r) => r.error)).toEqual(['boom']);
  });

  it('is denied to a plain User and to an anonymous caller', async () => {
    const s = await audit.startShared();
    const paging = { page: 0, pageSize: 10 };
    await expect(s.audit.system.jobRuns(await s.actor('user'), {}, paging)).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.audit.system.jobRuns({ kind: 'anonymous' }, {}, paging)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('requeue of a dead outbox delivery', () => {
  it('puts it back, the dispatcher delivers it, and the repair is on the record with the actor', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const { deliveryId, eventId } = await deadDelivery(s);

    const result = await s.audit.system.requeue(admin, deliveryId);
    expect(result).toMatchObject({
      deliveryId,
      eventName: 'settings.changed@1',
      subscriber: 'core.audit',
    });
    const { rows } = await s.pool.query(
      'select status, attempts, last_error, locked_until from kernel_outbox_delivery where id = $1',
      [deliveryId],
    );
    expect(rows[0]).toEqual({
      status: 'pending',
      attempts: 0,
      last_error: null,
      locked_until: null,
    });

    const [entry] = await s.rows("action = 'system.outbox.requeued' and subject_id = $1", [
      deliveryId,
    ]);
    expect(entry).toMatchObject({
      source: 'event',
      outcome: 'ok',
      actor_kind: 'user',
      user_id: admin.userId,
      subject_type: 'outbox-delivery',
      payload: { event: 'settings.changed@1', subscriber: 'core.audit', attempts: 8 },
    });

    await s.dispatch();
    expect(
      (await s.pool.query('select status from kernel_outbox_delivery where id = $1', [deliveryId]))
        .rows[0],
    ).toEqual({ status: 'delivered' });
    expect(await s.rows('event_id = $1', [eventId])).toHaveLength(1); // and the event reached the trail
  });

  it('answers 404 for an unknown or malformed id and 409 for a delivery that is not dead, changing nothing', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const pending = await deadDelivery(s, 'pending');
    const delivered = await deadDelivery(s, 'delivered');
    await expect(s.audit.system.requeue(admin, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    await expect(s.audit.system.requeue(admin, 'not-an-id')).rejects.toMatchObject({ status: 404 });
    await expect(s.audit.system.requeue(admin, pending.deliveryId)).rejects.toMatchObject({
      status: 409,
    });
    await expect(s.audit.system.requeue(admin, delivered.deliveryId)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await s.rows('subject_id = ANY($1)', [[pending.deliveryId, delivered.deliveryId]]),
    ).toHaveLength(0);
    expect(
      (
        await s.pool.query('select attempts from kernel_outbox_delivery where id = $1', [
          delivered.deliveryId,
        ])
      ).rows[0],
    ).toEqual({ attempts: 8 });
  });

  it('is denied to a plain User and to a holder of only system.read, and nothing changes', async () => {
    const s = await audit.startShared();
    const { deliveryId } = await deadDelivery(s);
    const { makeRole, makeRoleAssignment } = await import('@scorpion/testing');
    const reader = await s.actor();
    await makeRoleAssignment(
      s.pool,
      { id: reader.userId },
      await makeRole(s.pool, { permissions: ['core.audit.system.read'] }),
    );
    for (const actor of [await s.actor('user'), reader]) {
      await expect(s.audit.system.requeue(actor, deliveryId)).rejects.toMatchObject({
        status: 403,
      });
    }
    await expect(s.audit.system.requeue({ kind: 'anonymous' }, deliveryId)).rejects.toMatchObject({
      status: 401,
    });
    expect(
      (await s.pool.query('select status from kernel_outbox_delivery where id = $1', [deliveryId]))
        .rows[0],
    ).toEqual({ status: 'dead' });
  });

  it('rolls back with its audit entry: when the entry cannot be written, the delivery stays dead', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const { deliveryId } = await deadDelivery(s);
    const system = createSystem({
      db: s.kernel.db,
      authz: s.authz,
      store: {
        record: () => Promise.resolve(),
        recordEvent: () => Promise.resolve(),
        recordAlways: () => Promise.reject(new Error('the trail is full')),
      },
    });
    await expect(system.requeue(admin, deliveryId)).rejects.toThrow('the trail is full');
    expect(
      (
        await s.pool.query('select status, attempts from kernel_outbox_delivery where id = $1', [
          deliveryId,
        ])
      ).rows[0],
    ).toEqual({ status: 'dead', attempts: 8 });
  });
});
