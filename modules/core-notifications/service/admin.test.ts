// What an administrator does with deliveries, on real Postgres: the list (metadata only), the requeue
// of a dead delivery and the events around it, the test mail and its budget, and the retention job.
// Two kernels for the file: one with the default settings, one whose relay is down.
import { Conflict, Forbidden, Invalid, NotFound } from '@scorpion/contracts';
import { makeDelivery, makeInboxItem } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { useNotifications, type Started } from '../test/harness.ts';
import { TEST_MAIL_BURST } from './admin.ts';

const harness = useNotifications();
let t: Started;
let down: Started;
beforeAll(async () => {
  t = await harness.startShared();
  // A relay that refuses connections, and one attempt only: the first failure is the last.
  down = await harness.startShared({
    settings: {
      emailTransport: 'smtp',
      smtp: { host: '127.0.0.1', port: 1, tls: 'none', timeoutSeconds: 1 },
      maxAttempts: 1,
    },
  });
});

const page = { page: 0, pageSize: 100 };
const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const events = async (k: Started, name: string) =>
  (
    await k.kernel.pool.query<{ payload: Record<string, unknown> }>(
      'select payload from kernel_outbox where name = $1 order by id',
      [name],
    )
  ).rows.map((row) => row.payload);

/** Makes every insert into the outbox fail, so a transaction that emits an event rolls back. */
async function breakOutbox<T>(k: Started, run: () => Promise<T>): Promise<T> {
  await k.kernel.pool.query(
    'alter table kernel_outbox add constraint sabotage check (false) not valid',
  );
  try {
    return await run();
  } finally {
    await k.kernel.pool.query('alter table kernel_outbox drop constraint sabotage');
  }
}

describe('the delivery list', () => {
  it('filters by status, template, channel and date range, newest first', async () => {
    const admin = await t.actorOf('admin');
    const tpl = `list.${randomUUID().slice(0, 8)}`;
    const old = await makeDelivery(t.kernel.pool, {
      template: tpl,
      status: 'sent',
      createdAt: days(10),
    });
    const mid = await makeDelivery(t.kernel.pool, {
      template: tpl,
      status: 'dead',
      createdAt: days(5),
    });
    const hook = await makeDelivery(t.kernel.pool, {
      template: tpl,
      channel: 'webhook',
      status: 'queued',
      createdAt: days(1),
    });
    const list = (filter: object) =>
      t.notifications.admin.list(admin, { template: tpl, ...filter }, page);
    expect((await list({})).deliveries.map((d) => d.id)).toEqual([hook.id, mid.id, old.id]);
    expect((await list({})).total).toBe(3);
    expect((await list({ status: 'dead' })).deliveries.map((d) => d.id)).toEqual([mid.id]);
    expect((await list({ channel: 'webhook' })).deliveries.map((d) => d.id)).toEqual([hook.id]);
    expect((await list({ from: days(6), to: days(2) })).deliveries.map((d) => d.id)).toEqual([
      mid.id,
    ]);
    expect((await list({ from: days(2) })).deliveries.map((d) => d.id)).toEqual([hook.id]);
    expect((await list({ template: 'no.such' })).total).toBe(0);
  });

  it('pages with a stable order', async () => {
    const admin = await t.actorOf('admin');
    const tpl = `page.${randomUUID().slice(0, 8)}`;
    const same = new Date();
    for (let i = 0; i < 5; i++) {
      await makeDelivery(t.kernel.pool, { template: tpl, createdAt: same });
    }
    const seen: string[] = [];
    for (let p = 0; p < 3; p++) {
      const r = await t.notifications.admin.list(
        admin,
        { template: tpl },
        { page: p, pageSize: 2 },
      );
      seen.push(...r.deliveries.map((d) => d.id));
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('shows metadata only: no body, address, subject or URL, even for a delivery that has them', async () => {
    const admin = await t.actorOf('admin');
    const row = await makeDelivery(t.kernel.pool, {
      template: `meta.${randomUUID().slice(0, 8)}`,
      recipientAddress: 'secret-person@example.org',
      subject: 'Secret subject',
      textBody: 'Secret body https://example.org/reset?token=abc',
      htmlBody: '<p>Secret html</p>',
      status: 'dead',
      lastError: 'ECONNREFUSED',
      recipientUserId: randomUUID(),
    });
    const { deliveries } = await t.notifications.admin.list(
      admin,
      { template: row.template },
      page,
    );
    expect(deliveries).toHaveLength(1);
    const view = deliveries[0]!;
    expect(view).toMatchObject({
      id: row.id,
      lastError: 'ECONNREFUSED',
      bodyAvailable: true,
      status: 'dead',
    });
    const json = JSON.stringify(view);
    for (const secret of [
      'secret-person',
      'Secret subject',
      'Secret body',
      'token=abc',
      'Secret html',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(view).sort()).toEqual(
      [
        'attempts',
        'bodyAvailable',
        'channel',
        'createdAt',
        'id',
        'lastError',
        'nextAttemptAt',
        'recipientUserId',
        'sensitive',
        'sentAt',
        'status',
        'statusChangedAt',
        'template',
        'transport',
      ].sort(),
    );
  });

  it('refuses a range that ends before it starts (422)', async () => {
    const admin = await t.actorOf('admin');
    await expect(
      t.notifications.admin.list(admin, { from: days(1), to: days(5) }, page),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('is denied to a plain User and to a user with no role', async () => {
    for (const actor of [await t.actorOf('user'), await t.actorOf()]) {
      await expect(t.notifications.admin.list(actor, {}, page)).rejects.toBeInstanceOf(Forbidden);
    }
  });
});

describe('requeue', () => {
  it('puts a dead delivery back in the queue with its attempts reset, wakes delivery and emits an event', async () => {
    const admin = await t.actorOf('admin');
    const dead = await makeDelivery(t.kernel.pool, {
      template: 'requeue.ok',
      status: 'dead',
      attempts: 8,
      lastError: 'ETIMEDOUT',
      recipientAddress: 'someone@example.org',
    });
    const view = await t.notifications.admin.requeue(admin, dead.id);
    expect(view).toMatchObject({ id: dead.id, status: 'queued', attempts: 0 });
    const row = await t.delivery(dead.id);
    expect(row).toMatchObject({ status: 'queued', attempts: 0, locked_until: null });
    expect(row.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    const emitted = (await events(t, 'notifications.delivery.requeued@1')).filter(
      (p) => p.deliveryId === dead.id,
    );
    expect(emitted).toEqual([
      { deliveryId: dead.id, template: 'requeue.ok', channel: 'email', requestedBy: admin.userId },
    ]);
    expect(JSON.stringify(emitted)).not.toContain('someone@example.org');

    // It is delivered by the next pass (the default transport accepts and drops).
    await t.notifications.deliverDue();
    expect((await t.delivery(dead.id)).status).toBe('sent');
  });

  it.each(['queued', 'sending', 'sent'] as const)('refuses a %s delivery (409)', async (status) => {
    const admin = await t.actorOf('admin');
    const row = await makeDelivery(t.kernel.pool, { status });
    await expect(t.notifications.admin.requeue(admin, row.id)).rejects.toBeInstanceOf(Conflict);
    expect((await t.delivery(row.id)).status).toBe(status);
  });

  it('refuses a dead delivery whose sensitive body was scrubbed: it cannot be sent', async () => {
    const admin = await t.actorOf('admin');
    const scrubbed = await makeDelivery(t.kernel.pool, {
      template: 'requeue.scrubbed',
      status: 'dead',
      sensitive: true,
      textBody: null,
      htmlBody: null,
      attempts: 8,
    });
    await expect(t.notifications.admin.requeue(admin, scrubbed.id)).rejects.toBeInstanceOf(
      Conflict,
    );
    expect(await t.delivery(scrubbed.id)).toMatchObject({ status: 'dead', attempts: 8 });
    expect(
      (await events(t, 'notifications.delivery.requeued@1')).filter(
        (p) => p.deliveryId === scrubbed.id,
      ),
    ).toEqual([]);
  });

  it('answers 404 for an unknown delivery and for an id that is not a UUID', async () => {
    const admin = await t.actorOf('admin');
    for (const id of [randomUUID(), 'nope']) {
      await expect(t.notifications.admin.requeue(admin, id)).rejects.toBeInstanceOf(NotFound);
    }
  });

  it('is denied to a plain User and changes nothing', async () => {
    const dead = await makeDelivery(t.kernel.pool, { status: 'dead', attempts: 8 });
    for (const actor of [await t.actorOf('user'), await t.actorOf()]) {
      await expect(t.notifications.admin.requeue(actor, dead.id)).rejects.toBeInstanceOf(Forbidden);
    }
    expect(await t.delivery(dead.id)).toMatchObject({ status: 'dead', attempts: 8 });
  });

  it('rolls back with its event: when the event cannot be stored the delivery stays dead', async () => {
    const admin = await t.actorOf('admin');
    const dead = await makeDelivery(t.kernel.pool, { status: 'dead', attempts: 8 });
    await expect(
      breakOutbox(t, () => t.notifications.admin.requeue(admin, dead.id)),
    ).rejects.toThrow();
    expect(await t.delivery(dead.id)).toMatchObject({ status: 'dead', attempts: 8 });
  });

  it('lets only one of two parallel requeues win', async () => {
    const admin = await t.actorOf('admin');
    const dead = await makeDelivery(t.kernel.pool, {
      template: 'requeue.race',
      status: 'dead',
      attempts: 8,
    });
    const results = await Promise.allSettled([
      t.notifications.admin.requeue(admin, dead.id),
      t.notifications.admin.requeue(admin, dead.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await events(t, 'notifications.delivery.requeued@1')).filter(
        (p) => p.deliveryId === dead.id,
      ),
    ).toHaveLength(1);
  });
});

describe('a delivery that becomes dead', () => {
  const enqueue = (k: Started) =>
    k.mail.send({
      template: 'dead.test',
      recipientAddress: 'victim@example.org',
      subject: 'Subject of the dead one',
      text: 'Body of the dead one',
    });

  it('is dead with its error code, and the event carries ids and codes only', async () => {
    const id = (await enqueue(down))!;
    const report = await down.notifications.deliverDue();
    expect(report.dead).toBeGreaterThanOrEqual(1);
    const row = await down.delivery(id);
    expect(row).toMatchObject({ status: 'dead', attempts: 1 });
    expect(row.last_error).toMatch(/^[A-Za-z0-9._-]+$/);

    const emitted = (await events(down, 'notifications.delivery.dead@1')).filter(
      (p) => p.deliveryId === id,
    );
    expect(emitted).toEqual([
      {
        deliveryId: id,
        template: 'dead.test',
        channel: 'email',
        attempts: 1,
        code: row.last_error,
      },
    ]);
    const text = JSON.stringify(emitted) + down.logs.join('');
    for (const secret of [
      'victim@example.org',
      'Subject of the dead one',
      'Body of the dead one',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('shows to an administrator without its body, and can be requeued', async () => {
    const admin = await down.actorOf('admin');
    const id = (await enqueue(down))!;
    await down.notifications.deliverDue();
    const { deliveries } = await down.notifications.admin.list(admin, { status: 'dead' }, page);
    const view = deliveries.find((d) => d.id === id)!;
    expect(view.bodyAvailable).toBe(true);
    expect(JSON.stringify(view)).not.toContain('Body of the dead one');
    const back = await down.notifications.admin.requeue(admin, id);
    expect(back.status).toBe('queued');
  });

  it('rolls back with its event: when the event cannot be stored the row is not dead', async () => {
    const id = (await enqueue(down))!;
    await breakOutbox(down, () => down.notifications.deliverDue());
    const row = await down.delivery(id);
    expect(row.status).toBe('sending'); // its lease runs out and the next pass takes it again
    expect(down.logs.join('')).toContain('could not finish a delivery');
  });
});

describe('the test mail', () => {
  it('queues a mail for the caller’s own address through the configured transport, and emits an event', async () => {
    const admin = await t.actorOf('admin');
    t.mail.setAddress(admin.userId, 'admin@example.org');
    const result = await t.notifications.admin.sendTest(admin);
    expect(result.transportIsNone).toBe(true); // the default settings
    const row = await t.delivery(result.deliveryId);
    expect(row).toMatchObject({
      template: 'notifications.test',
      recipient_address: 'admin@example.org',
      recipient_user_id: admin.userId,
      status: 'queued',
    });
    expect(await events(t, 'notifications.settings.tested@1')).toContainEqual({
      deliveryId: result.deliveryId,
      template: 'notifications.test',
      requestedBy: admin.userId,
    });
  });

  it('is not stopped by a preference, because the administrator asked for it', async () => {
    const admin = await t.actorOf('admin');
    t.mail.setAddress(admin.userId, 'admin2@example.org');
    await t.kernel.pool.query(
      `insert into settings_user_preference (id, user_id, key, value, updated_at)
       values ($1, $2, 'notifications.preferences', $3, now())`,
      [randomUUID(), admin.userId, JSON.stringify({ system: { email: false, inApp: false } })],
    );
    const result = await t.notifications.admin.sendTest(admin);
    expect((await t.delivery(result.deliveryId)).recipient_address).toBe('admin2@example.org');
  });

  it(`allows a burst of ${TEST_MAIL_BURST}, then answers 429`, async () => {
    const admin = await t.actorOf('admin');
    t.mail.setAddress(admin.userId, 'burst@example.org');
    for (let i = 0; i < TEST_MAIL_BURST; i++) await t.notifications.admin.sendTest(admin);
    const before = (await t.deliveries()).length;
    await expect(t.notifications.admin.sendTest(admin)).rejects.toMatchObject({ status: 429 });
    expect((await t.deliveries()).length).toBe(before);
    // Another administrator has their own budget.
    const other = await t.actorOf('admin');
    t.mail.setAddress(other.userId, 'other@example.org');
    await expect(t.notifications.admin.sendTest(other)).resolves.toBeDefined();
  });

  it('answers 409 when no module knows an address for the caller, and queues nothing', async () => {
    const admin = await t.actorOf('admin');
    const before = (await t.deliveries()).length;
    await expect(t.notifications.admin.sendTest(admin)).rejects.toBeInstanceOf(Conflict);
    expect((await t.deliveries()).length).toBe(before);
  });

  it('is denied to a plain User and queues nothing', async () => {
    const before = (await t.deliveries()).length;
    for (const actor of [await t.actorOf('user'), await t.actorOf()]) {
      t.mail.setAddress(actor.userId, 'x@example.org');
      await expect(t.notifications.admin.sendTest(actor)).rejects.toBeInstanceOf(Forbidden);
    }
    expect((await t.deliveries()).length).toBe(before);
  });

  it('rolls back with its event: when the event cannot be stored no mail remains', async () => {
    const admin = await t.actorOf('admin');
    t.mail.setAddress(admin.userId, 'rollback@example.org');
    const before = (await t.deliveries()).length;
    await expect(breakOutbox(t, () => t.notifications.admin.sendTest(admin))).rejects.toThrow();
    expect((await t.deliveries()).length).toBe(before);
  });
});

describe('retention', () => {
  it('deletes sent and dead deliveries past retentionDays and nothing that is queued, sending or recent', async () => {
    const tpl = `ret.${randomUUID().slice(0, 8)}`;
    const mk = (status: 'queued' | 'sending' | 'sent' | 'dead', ageDays: number) =>
      makeDelivery(t.kernel.pool, { template: tpl, status, statusChangedAt: days(ageDays) });
    const [oldSent, oldDead, oldQueued, oldSending, newSent, newDead] = [
      await mk('sent', 100),
      await mk('dead', 100),
      await mk('queued', 100),
      await mk('sending', 100),
      await mk('sent', 10),
      await mk('dead', 89),
    ];
    const report = await t.notifications.admin.runRetention();
    expect(report.deliveries).toBeGreaterThanOrEqual(2);
    const left = (await t.deliveries()).filter((d) => d.template === tpl).map((d) => d.id);
    expect(left.sort()).toEqual([oldQueued.id, oldSending.id, newSent.id, newDead.id].sort());
    expect(left).not.toContain(oldSent.id);
    expect(left).not.toContain(oldDead.id);
  });

  it('uses the setting: a shorter retentionDays removes more', async () => {
    const short = await harness.start({ settings: { retentionDays: 5 } });
    const tpl = 'ret.short';
    await makeDelivery(short.kernel.pool, {
      template: tpl,
      status: 'sent',
      statusChangedAt: days(6),
    });
    const keep = await makeDelivery(short.kernel.pool, {
      template: tpl,
      status: 'sent',
      statusChangedAt: days(4),
    });
    await short.notifications.admin.runRetention();
    expect((await short.deliveries()).map((d) => d.id)).toEqual([keep.id]);
  });

  it('deletes read inbox items past inboxRetentionDays and keeps unread and recent ones', async () => {
    const owner = randomUUID();
    const mk = (readAt: Date | null, title: string) =>
      makeInboxItem(t.kernel.pool, { userId: owner, readAt, title });
    const oldRead = await mk(days(100), 'old read');
    await mk(days(100), 'old read 2');
    const oldUnread = await mk(null, 'old unread');
    await t.kernel.pool.query('update notify_inbox_item set created_at = $2 where id = $1', [
      oldUnread.id,
      days(400),
    ]);
    const recentRead = await mk(days(10), 'recent read');
    const report = await t.notifications.admin.runRetention();
    expect(report.inboxItems).toBeGreaterThanOrEqual(2);
    const left = (
      await t.kernel.pool.query<{ id: string }>(
        'select id from notify_inbox_item where user_id = $1',
        [owner],
      )
    ).rows.map((r) => r.id);
    expect(left.sort()).toEqual([oldUnread.id, recentRead.id].sort());
    expect(left).not.toContain(oldRead.id);
  });

  it('is idempotent', async () => {
    await t.notifications.admin.runRetention();
    const again = await t.notifications.admin.runRetention();
    expect(again).toEqual({ deliveries: 0, inboxItems: 0 });
  });
});
