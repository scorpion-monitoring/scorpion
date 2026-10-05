import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { useKernels } from '../test/helpers.ts';
import type { Kernel } from './kernel.ts';
import { deleteDeliveredEvents, deleteJobRuns, requeueDelivery } from './maintenance.ts';
import { defineModule } from './manifest.ts';

const kernels = useKernels();
const DAY = 24 * 60 * 60 * 1000;

async function start() {
  const kernel = await kernels.inline([defineModule({ id: 'maint', version: '1.0.0' })]);
  await kernel.start();
  return kernel;
}

async function event(
  kernel: Kernel,
  statuses: ('pending' | 'delivered' | 'dead')[],
  ageDays = 30,
  payload: unknown = {},
) {
  const id = randomUUID();
  await kernel.db.execute(sql`
    insert into kernel_outbox (id, name, emitter, payload, occurred_at)
    values (${id}, 't.event@1', 'maint', ${JSON.stringify(payload)}::jsonb, now() - ${ageDays} * interval '1 day')`);
  const deliveries: string[] = [];
  for (const [i, status] of statuses.entries()) {
    const deliveryId = randomUUID();
    deliveries.push(deliveryId);
    await kernel.db.execute(sql`
      insert into kernel_outbox_delivery (id, event_id, subscriber, status, attempts, last_error)
      values (${deliveryId}, ${id}, ${`sub${i}`}, ${status}, 4, ${status === 'dead' ? 'boom' : null})`);
  }
  return { id, deliveries };
}

const ids = async (kernel: Kernel) =>
  new Set(
    (await kernel.db.execute<{ id: string }>(sql`select id from kernel_outbox`)).rows.map(
      (r) => r.id,
    ),
  );

describe('deleteDeliveredEvents', () => {
  it('deletes old events whose deliveries are all delivered, or that have none, with their deliveries', async () => {
    const kernel = await start();
    const done = await event(kernel, ['delivered', 'delivered']);
    const nobody = await event(kernel, []);
    const waiting = await event(kernel, ['delivered', 'pending']);
    const dead = await event(kernel, ['dead']);
    const young = await event(kernel, ['delivered'], 1);

    const deleted = await deleteDeliveredEvents(kernel.db, {
      olderThan: new Date(Date.now() - 7 * DAY),
    });
    expect(deleted).toBe(2);
    const left = await ids(kernel);
    expect(left.has(done.id)).toBe(false);
    expect(left.has(nobody.id)).toBe(false);
    expect(left.has(waiting.id)).toBe(true);
    expect(left.has(dead.id)).toBe(true);
    expect(left.has(young.id)).toBe(true);
    const remaining = await kernel.db.execute<{ id: string }>(
      sql`select id from kernel_outbox_delivery`,
    );
    expect(remaining.rows.map((r) => r.id)).not.toContain(done.deliveries[0]);
  });

  it('works in batches and reports what it deleted', async () => {
    const kernel = await start();
    for (let i = 0; i < 5; i += 1) await event(kernel, ['delivered']);
    const cutoff = new Date(Date.now() - 7 * DAY);
    expect(await deleteDeliveredEvents(kernel.db, { olderThan: cutoff, limit: 3 })).toBe(3);
    expect(await deleteDeliveredEvents(kernel.db, { olderThan: cutoff, limit: 3 })).toBe(2);
    expect(await deleteDeliveredEvents(kernel.db, { olderThan: cutoff, limit: 3 })).toBe(0);
  });

  it('removes the username of a purged account from the outbox, once the event is delivered and old', async () => {
    const kernel = await start();
    const username = `purged-${randomUUID().slice(0, 8)}`;
    await event(kernel, ['delivered'], 40, { userId: randomUUID(), username });
    const has = async () =>
      (
        await kernel.db.execute(
          sql`select 1 from kernel_outbox where payload::text like ${`%${username}%`}`,
        )
      ).rows.length;
    expect(await has()).toBe(1);
    await deleteDeliveredEvents(kernel.db, { olderThan: new Date(Date.now() - 30 * DAY) });
    expect(await has()).toBe(0);
  });

  it('clamps a limit that is out of range instead of failing or deleting everything', async () => {
    const kernel = await start();
    await event(kernel, ['delivered']);
    await event(kernel, ['delivered']);
    const cutoff = new Date(Date.now() - 7 * DAY);
    expect(await deleteDeliveredEvents(kernel.db, { olderThan: cutoff, limit: 0 })).toBe(1); // at least 1
    expect(await deleteDeliveredEvents(kernel.db, { olderThan: cutoff, limit: -5 })).toBe(1);
  });
});

describe('deleteJobRuns', () => {
  it('deletes finished runs before the cut-off and never a running one', async () => {
    const kernel = await start();
    const insert = async (status: string, ageDays: number) => {
      const id = randomUUID();
      await kernel.db.execute(sql`
        insert into kernel_job_run (id, job_name, module, job_id, attempt, status, timeout_seconds, started_at)
        values (${id}, 't.job', 'maint', ${randomUUID()}, 1, ${status}, 60, now() - ${ageDays} * interval '1 day')`);
      return id;
    };
    const ok = await insert('succeeded', 100);
    const failed = await insert('failed', 100);
    const running = await insert('running', 100);
    const young = await insert('succeeded', 1);
    expect(await deleteJobRuns(kernel.db, { olderThan: new Date(Date.now() - 30 * DAY) })).toBe(2);
    const left = new Set(
      (await kernel.db.execute<{ id: string }>(sql`select id from kernel_job_run`)).rows.map(
        (r) => r.id,
      ),
    );
    expect([ok, failed].some((id) => left.has(id))).toBe(false);
    expect(left.has(running)).toBe(true);
    expect(left.has(young)).toBe(true);
  });
});

describe('requeueDelivery', () => {
  const state = async (kernel: Kernel, id: string) =>
    (
      await kernel.db.execute<{ status: string; attempts: number; last_error: string | null }>(
        sql`select status, attempts, last_error from kernel_outbox_delivery where id = ${id}`,
      )
    ).rows[0];

  it('puts a dead delivery back: pending, no attempts, no error, and says what it was', async () => {
    const kernel = await start();
    const { deliveries } = await event(kernel, ['dead']);
    const result = await requeueDelivery(kernel.db, deliveries[0]!);
    expect(result).toMatchObject({
      deliveryId: deliveries[0],
      eventName: 't.event@1',
      subscriber: 'sub0',
      attempts: 4,
    });
    expect(await state(kernel, deliveries[0]!)).toEqual({
      status: 'pending',
      attempts: 0,
      last_error: null,
    });
  });

  it('leaves a delivery that is not dead, and an unknown id, alone', async () => {
    const kernel = await start();
    const { deliveries } = await event(kernel, ['pending', 'delivered']);
    expect(await requeueDelivery(kernel.db, deliveries[0]!)).toBeUndefined();
    expect(await requeueDelivery(kernel.db, deliveries[1]!)).toBeUndefined();
    expect(await requeueDelivery(kernel.db, randomUUID())).toBeUndefined();
    expect(await state(kernel, deliveries[1]!)).toMatchObject({ status: 'delivered', attempts: 4 });
  });

  it('rolls back with its transaction', async () => {
    const kernel = await start();
    const { deliveries } = await event(kernel, ['dead']);
    await expect(
      kernel.db.tx(async (tx) => {
        expect(await requeueDelivery(tx, deliveries[0]!)).toBeDefined();
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await state(kernel, deliveries[0]!)).toMatchObject({ status: 'dead', attempts: 4 });
  });

  it('two requests at once requeue it once', async () => {
    const kernel = await start();
    const { deliveries } = await event(kernel, ['dead']);
    const results = await Promise.all([
      requeueDelivery(kernel.db, deliveries[0]!),
      requeueDelivery(kernel.db, deliveries[0]!),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
