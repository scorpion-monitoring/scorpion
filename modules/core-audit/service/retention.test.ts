import { randomUUID } from 'node:crypto';
import { makeAuditEvent } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { RETENTION_JOB } from '../module.ts';
import { useAudit } from '../test/harness.ts';

const audit = useAudit();
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('retention of the trail', () => {
  it('removes rows past their retention and leaves newer ones, the request log sooner than events', async () => {
    const s = await audit.start();
    const keep = {
      oldEvent: await makeAuditEvent(s.pool, { source: 'event', occurredAt: ago(400) }),
      midEvent: await makeAuditEvent(s.pool, { source: 'event', occurredAt: ago(100) }),
      midApi: await makeAuditEvent(s.pool, { source: 'api', occurredAt: ago(100) }),
      oldApi: await makeAuditEvent(s.pool, { source: 'api', occurredAt: ago(91) }),
      newApi: await makeAuditEvent(s.pool, { source: 'api', occurredAt: ago(1) }),
    };
    const report = await s.audit.retention.run();
    expect(report).toMatchObject({ deletedEvents: 1, deletedApi: 2 });
    const left = new Set((await s.rows()).map((r) => r.id));
    expect(left.has(keep.oldEvent.id)).toBe(false); // events: 365 days
    expect(left.has(keep.midEvent.id)).toBe(true);
    expect(left.has(keep.midApi.id)).toBe(false); // the request log: 90 days
    expect(left.has(keep.oldApi.id)).toBe(false);
    expect(left.has(keep.newApi.id)).toBe(true);
  });

  it('uses the retention settings an administrator saved', async () => {
    const s = await audit.start({ auditSettings: { retentionDays: 10, apiRetentionDays: 5 } });
    const a = await makeAuditEvent(s.pool, { source: 'event', occurredAt: ago(11) });
    const b = await makeAuditEvent(s.pool, { source: 'event', occurredAt: ago(9) });
    const c = await makeAuditEvent(s.pool, { source: 'api', occurredAt: ago(6) });
    const d = await makeAuditEvent(s.pool, { source: 'api', occurredAt: ago(4) });
    await s.audit.retention.run();
    const left = (await s.rows()).map((r) => r.id);
    expect(left).toContain(b.id);
    expect(left).toContain(d.id);
    expect(left).not.toContain(a.id);
    expect(left).not.toContain(c.id);
  });

  it('deletes in batches and keeps going until nothing old is left', async () => {
    const s = await audit.start();
    await s.pool.query(
      `insert into audit_event (id, occurred_at, source, action, outcome, actor_kind)
       select gen_random_uuid(), now() - interval '500 days' - n * interval '1 second', 'event', 'test.bulk', 'ok', 'system'
         from generate_series(1, 2500) n`,
    );
    const fresh = await makeAuditEvent(s.pool, { source: 'event' });
    const report = await s.audit.retention.run();
    expect(report.deletedEvents).toBe(2500);
    expect((await s.rows()).map((r) => r.id)).toEqual([fresh.id]);
  });

  it('stops when told to', async () => {
    const s = await audit.start();
    const controller = new AbortController();
    controller.abort(new Error('shutting down'));
    await expect(s.audit.retention.run({ signal: controller.signal })).rejects.toThrow(
      'shutting down',
    );
  });

  it('cuts the ip to a network prefix after 30 days, and changes nothing else about the row', async () => {
    const s = await audit.start();
    const v4 = await makeAuditEvent(s.pool, {
      ip: '203.0.113.77',
      occurredAt: ago(40),
      source: 'api',
    });
    const v6 = await makeAuditEvent(s.pool, {
      ip: '2001:db8:1234:5678:9abc::1',
      occurredAt: ago(40),
      source: 'api',
      body: { keep: 'me' },
    });
    const recent = await makeAuditEvent(s.pool, {
      ip: '203.0.113.78',
      occurredAt: ago(10),
      source: 'api',
    });
    const none = await makeAuditEvent(s.pool, { ip: null, occurredAt: ago(40), source: 'api' });

    const report = await s.audit.retention.run();
    expect(report.ipTruncated).toBe(2);
    const by = Object.fromEntries((await s.rows()).map((r) => [r.id, r]));
    expect(by[v4.id]!.ip).toBe('203.0.113.0/24');
    expect(by[v6.id]!.ip).toBe('2001:db8:1234::/48');
    expect(by[recent.id]!.ip).toBe('203.0.113.78');
    expect(by[none.id]!.ip).toBeNull();
    expect({ ...by[v6.id]!, ip: null }).toEqual({ ...v6, ip: null });

    // A second run has nothing to do: a cut address is not cut again.
    expect((await s.audit.retention.run()).ipTruncated).toBe(0);
  });

  it('cuts the ip after the number of days the setting names', async () => {
    const s = await audit.start({ auditSettings: { ipTruncateAfterDays: 5 } });
    const old = await makeAuditEvent(s.pool, { ip: '198.51.100.9', occurredAt: ago(6) });
    const young = await makeAuditEvent(s.pool, { ip: '198.51.100.10', occurredAt: ago(4) });
    await s.audit.retention.run();
    const by = Object.fromEntries((await s.rows()).map((r) => [r.id, r.ip]));
    expect(by[old.id]).toBe('198.51.100.0/24');
    expect(by[young.id]).toBe('198.51.100.10');
  });

  it('the daily job runs it and returns the counts for the job-run history', async () => {
    const s = await audit.start();
    await makeAuditEvent(s.pool, { source: 'event', occurredAt: ago(500) });
    await makeAuditEvent(s.pool, { source: 'api', occurredAt: ago(200), ip: '192.0.2.5' });
    await makeAuditEvent(s.pool, { source: 'api', occurredAt: ago(50), ip: '192.0.2.6' });
    const job = s.manifest.jobs!.find((j) => j.name === RETENTION_JOB)!;
    expect(job.schedule).toBeDefined();
    const result = await job.handler(
      {
        id: 'job-1',
        name: job.name,
        data: undefined,
        attempt: 1,
        signal: new AbortController().signal,
      },
      { log: s.kernel.log } as never,
    );
    expect(result).toEqual({ deletedEvents: 1, deletedApi: 1, ipTruncated: 1 });
  });
});

describe('the retention of the kernel tables, hosted here', () => {
  it('deletes delivered events past the retention and keeps what is pending or dead', async () => {
    const s = await audit.start();
    const old = new Date(Date.now() - 30 * DAY);
    const insertEvent = async (name: string, statuses: string[], at = old) => {
      const id = randomUUID();
      await s.pool.query(
        `insert into kernel_outbox (id, name, emitter, payload, occurred_at) values ($1, $2, 'test', '{}', $3)`,
        [id, name, at],
      );
      for (const [i, status] of statuses.entries()) {
        await s.pool.query(
          `insert into kernel_outbox_delivery (id, event_id, subscriber, status) values ($1, $2, $3, $4)`,
          [randomUUID(), id, `sub${i}`, status],
        );
      }
      return id;
    };
    const delivered = await insertEvent('t.delivered@1', ['delivered', 'delivered']);
    const noSubscribers = await insertEvent('t.nobody@1', []);
    const pending = await insertEvent('t.pending@1', ['delivered', 'pending']);
    const dead = await insertEvent('t.dead@1', ['dead']);
    const recent = await insertEvent('t.recent@1', ['delivered'], new Date());

    const report = await s.audit.retention.runOutbox();
    expect(report.deleted).toBeGreaterThanOrEqual(2);
    const left = new Set(
      (await s.pool.query<{ id: string }>('select id from kernel_outbox')).rows.map((r) => r.id),
    );
    expect(left.has(delivered)).toBe(false);
    expect(left.has(noSubscribers)).toBe(false);
    expect(left.has(pending)).toBe(true);
    expect(left.has(dead)).toBe(true);
    expect(left.has(recent)).toBe(true);
  });

  it('removes the username of a purged account from the outbox once its events are delivered and old', async () => {
    const s = await audit.start();
    const marker = `purged-person-${randomUUID().slice(0, 8)}`;
    const eventId = randomUUID();
    await s.pool.query(
      `insert into kernel_outbox (id, name, emitter, payload, occurred_at)
       values ($1, 'identity.user.purged@1', 'core.identity', $2::jsonb, now() - interval '40 days')`,
      [eventId, JSON.stringify({ userId: randomUUID(), username: marker })],
    );
    await s.pool.query(
      `insert into kernel_outbox_delivery (id, event_id, subscriber, status) values ($1, $2, 'core.audit', 'delivered')`,
      [randomUUID(), eventId],
    );
    expect(
      (
        await s.pool.query('select 1 from kernel_outbox where payload::text like $1', [
          `%${marker}%`,
        ])
      ).rows,
    ).toHaveLength(1);
    await s.audit.retention.runOutbox();
    expect(
      (
        await s.pool.query('select 1 from kernel_outbox where payload::text like $1', [
          `%${marker}%`,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('deletes finished job runs past the retention and never a running one', async () => {
    const s = await audit.start();
    const insert = async (status: string, daysOld: number) => {
      const id = randomUUID();
      await s.pool.query(
        `insert into kernel_job_run (id, job_name, module, job_id, attempt, status, timeout_seconds, started_at)
         values ($1, 'test.job', 'test', $2, 1, $3, 60, now() - $4 * interval '1 day')`,
        [id, randomUUID(), status, daysOld],
      );
      return id;
    };
    const oldOk = await insert('succeeded', 120);
    const oldFailed = await insert('failed', 120);
    const oldRunning = await insert('running', 120);
    const young = await insert('succeeded', 5);
    const report = await s.audit.retention.runJobRuns();
    expect(report.deleted).toBeGreaterThanOrEqual(2);
    const left = new Set(
      (await s.pool.query<{ id: string }>('select id from kernel_job_run')).rows.map((r) => r.id),
    );
    expect(left.has(oldOk)).toBe(false);
    expect(left.has(oldFailed)).toBe(false);
    expect(left.has(oldRunning)).toBe(true);
    expect(left.has(young)).toBe(true);
  });
});
