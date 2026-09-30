import { sql } from 'drizzle-orm';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useKernels } from '../test/helpers.ts';
import { defaultBackoffMs, EventError } from './outbox.ts';
import { defineModule, type DomainEvent } from './manifest.ts';
import type { Kernel } from './kernel.ts';
import { listDeadDeliveries, outboxStats } from './queries.ts';

const kernels = useKernels();
const fast = { backoffMs: () => 0, pollIntervalMs: 50 };

async function count(kernel: Kernel, table: string): Promise<number> {
  const { rows } = await kernel.db.execute<{ n: string }>(
    sql.raw(`select count(*) as n from ${table}`),
  );
  return Number(rows[0]!.n);
}

/** An emitter `em` and two subscribers. `behaviour` decides what each subscriber does per call. */
function pair(behaviour: {
  s1?: (event: DomainEvent, call: number) => void | Promise<void>;
  s2?: () => void;
}) {
  const calls = { s1: [] as DomainEvent[], s2: [] as DomainEvent[] };
  const emitter = defineModule<{
    fire(payload: { n: number }): Promise<void>;
    fireAndFail(): Promise<void>;
  }>({
    id: 'em',
    version: '1.0.0',
    events: { emits: { 'em.done@1': z.strictObject({ n: z.number() }) } },
    services: (ctx) => ({
      fire: (payload) => ctx.db.tx(() => ctx.events.emit('em.done@1', payload)),
      fireAndFail: () =>
        ctx.db.tx(async () => {
          await ctx.events.emit('em.done@1', { n: 1 });
          throw new Error('rolled back on purpose');
        }),
    }),
  });
  const subscriber = (id: 's1' | 's2') =>
    defineModule({
      id,
      version: '1.0.0',
      events: {
        on: {
          'em.done@1': async (event) => {
            calls[id].push(event);
            if (id === 's1') await behaviour.s1?.(event, calls.s1.length);
            else behaviour.s2?.();
          },
        },
      },
    });
  return {
    calls,
    modules: [emitter, subscriber('s1'), subscriber('s2')],
    requires: { s1: ['em'], s2: ['em'] },
  };
}

const service = <T>(kernel: Kernel, id: string) => kernel.services.get(id) as T;

describe('ctx.events.emit', () => {
  it('must run inside ctx.db.tx()', async () => {
    let emitBare: (name: string, payload: unknown) => Promise<void> = () => Promise.resolve();
    const kernel = await kernels.inline([
      defineModule({
        id: 'em',
        version: '1.0.0',
        events: { emits: { 'em.done@1': z.strictObject({ n: z.number() }) } },
        services: (ctx) => {
          emitBare = (name, payload) => ctx.events.emit(name, payload); // no ctx.db.tx around it
          return {};
        },
      }),
    ]);
    await kernel.start();

    const error = await emitBare('em.done@1', { n: 1 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EventError);
    expect((error as Error).message).toMatch(/must be called inside ctx\.db\.tx\(\)/);
    expect(await count(kernel, 'kernel_outbox')).toBe(0);
  });

  it('rejects an event the module did not declare and a payload that does not match', async () => {
    let emitted: (name: string, payload: unknown) => Promise<void> = () => Promise.resolve();
    const kernel = await kernels.inline([
      defineModule({
        id: 'em',
        version: '1.0.0',
        events: { emits: { 'em.done@1': z.strictObject({ n: z.number() }) } },
        services: (ctx) => {
          emitted = (name, payload) => ctx.db.tx(() => ctx.events.emit(name, payload));
          return {};
        },
      }),
    ]);
    await kernel.start();

    await expect(emitted('em.other@1', {})).rejects.toThrowError(
      /"em.other@1" is not declared in events.emits/,
    );
    await expect(emitted('em.done@1', { n: 'one' })).rejects.toThrowError(
      /payload of "em.done@1" is invalid \(n: /,
    );
    await expect(emitted('em.done@1', { n: 1, extra: true })).rejects.toBeInstanceOf(EventError);
    expect(await count(kernel, 'kernel_outbox')).toBe(0);
  });

  it('writes the event and one delivery per subscriber when the transaction commits', async () => {
    const { modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires);
    await kernel.start();

    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 7 });

    expect(await count(kernel, 'kernel_outbox')).toBe(1);
    const { rows } = await kernel.db.execute<{ subscriber: string; status: string }>(
      sql`select subscriber, status from kernel_outbox_delivery order by subscriber`,
    );
    expect(rows).toEqual([
      { subscriber: 's1', status: 'pending' },
      { subscriber: 's2', status: 'pending' },
    ]);
  });

  it('produces no event when the transaction rolls back', async () => {
    const { calls, modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires);
    await kernel.start();

    await expect(
      service<{ fireAndFail(): Promise<void> }>(kernel, 'em').fireAndFail(),
    ).rejects.toThrowError('rolled back on purpose');

    expect(await count(kernel, 'kernel_outbox')).toBe(0);
    expect(await count(kernel, 'kernel_outbox_delivery')).toBe(0);
    expect(await kernel.dispatcher.dispatchOnce()).toBe(0);
    expect(calls.s1).toHaveLength(0);
  });

  it('rolls back the change and the event together (fixture b)', async () => {
    const kernel = await kernels.fixture('ab');
    await kernel.start();
    const b = service<{
      createThing(n: string): Promise<string>;
      createThingThenFail(n: string): Promise<never>;
      count(): Promise<number>;
    }>(kernel, 'fixture.b');

    await b.createThing('kept');
    await expect(b.createThingThenFail('dropped')).rejects.toThrowError('rolled back on purpose');

    expect(await b.count()).toBe(1);
    expect(await count(kernel, 'kernel_outbox')).toBe(1);
  });
});

describe('delivery', () => {
  it('passes the event to the subscribers and marks the deliveries delivered', async () => {
    const { calls, modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires, { dispatcher: fast });
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 42 });

    expect(await kernel.dispatcher.dispatchOnce()).toBe(2);

    for (const received of [calls.s1, calls.s2]) {
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ name: 'em.done@1', payload: { n: 42 } });
      expect(received[0]!.occurredAt).toBeInstanceOf(Date);
    }
    expect(await kernel.dispatcher.dispatchOnce()).toBe(0);
    expect(await outboxStats(kernel.db)).toEqual({ pending: 0, dead: 0, lagSeconds: 0 });
  });

  it('delivers an event committed before any dispatcher was running, from a different process', async () => {
    const url = await kernels.newDatabase();
    const first = await kernels.fixture('ab', { databaseUrl: url });
    await first.start();
    const b = service<{ createThing(n: string): Promise<string> }>(first, 'fixture.b');
    const thingId = await b.createThing('before the dispatcher');
    await first.stop(); // the process goes away; no dispatcher ever ran

    const second = await kernels.fixture('ab', { databaseUrl: url, dispatcher: fast });
    await second.start();
    await second.startWorkers();

    const a = service<{ notes(): Promise<{ thingId: string }[]> }>(second, 'fixture.a');
    await vi.waitFor(
      async () => expect(await a.notes()).toEqual([expect.objectContaining({ thingId })]),
      {
        timeout: 10_000,
      },
    );
  });

  it('retries a failing subscriber without delivering again to the others', async () => {
    const { calls, modules, requires } = pair({
      s1: (_event, call) => {
        if (call <= 2) throw new Error(`s1 fails on call ${call}`);
      },
    });
    const kernel = await kernels.inline(modules, requires, { dispatcher: fast });
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });

    for (let round = 0; round < 6; round++) await kernel.dispatcher.dispatchOnce();

    expect(calls.s1).toHaveLength(3); // two failures, then success
    expect(calls.s2).toHaveLength(1); // delivered once, never again
    const { rows } = await kernel.db.execute<{
      subscriber: string;
      status: string;
      attempts: number;
      last_error: string | null;
    }>(
      sql`select subscriber, status, attempts, last_error from kernel_outbox_delivery order by subscriber`,
    );
    expect(rows).toEqual([
      { subscriber: 's1', status: 'delivered', attempts: 3, last_error: null },
      { subscriber: 's2', status: 'delivered', attempts: 1, last_error: null },
    ]);
  });

  it('waits for the backoff before retrying', async () => {
    const { calls, modules, requires } = pair({
      s1: () => {
        throw new Error('always');
      },
    });
    const kernel = await kernels.inline(modules, requires, {
      dispatcher: { backoffMs: () => 60_000 },
    });
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });

    expect(await kernel.dispatcher.dispatchOnce()).toBe(2);
    expect(await kernel.dispatcher.dispatchOnce()).toBe(0); // s1 is not due for a minute
    expect(calls.s1).toHaveLength(1);
  });

  it('marks a delivery dead after the last attempt and shows it through a query function', async () => {
    const { calls, modules, requires } = pair({
      s1: () => {
        throw new Error('cannot process, password=hunter2 at postgres://u:pw-secret@db/x');
      },
    });
    const kernel = await kernels.inline(modules, requires, {
      dispatcher: { ...fast, maxAttempts: 3 },
    });
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 5 });

    for (let round = 0; round < 6; round++) await kernel.dispatcher.dispatchOnce();

    expect(calls.s1).toHaveLength(3);
    expect(calls.s2).toHaveLength(1);
    const dead = await listDeadDeliveries(kernel.db);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ eventName: 'em.done@1', subscriber: 's1', attempts: 3 });
    expect(dead[0]!.lastError).toContain('cannot process');
    expect(dead[0]!.lastError).not.toContain('pw-secret');
    expect(dead[0]!.occurredAt).toBeInstanceOf(Date);
    expect((await outboxStats(kernel.db)).dead).toBe(1);
    expect(await kernel.dispatcher.dispatchOnce()).toBe(0);
  });

  it('marks a delivery dead when the subscriber no longer has a handler', async () => {
    const { modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires);
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });
    await kernel.db.execute(
      sql`update kernel_outbox_delivery set subscriber = 'removed.module' where subscriber = 's2'`,
    );

    await kernel.dispatcher.dispatchOnce();

    const dead = await listDeadDeliveries(kernel.db);
    expect(dead).toEqual([expect.objectContaining({ subscriber: 'removed.module' })]);
    expect(dead[0]!.lastError).toMatch(/no longer has a handler/);
  });

  it('fails a handler that takes too long', async () => {
    const { modules, requires } = pair({ s1: () => new Promise(() => undefined) });
    const kernel = await kernels.inline(modules, requires, {
      dispatcher: { ...fast, handlerTimeoutMs: 50, maxAttempts: 1 },
    });
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });

    await kernel.dispatcher.dispatchOnce();

    expect((await listDeadDeliveries(kernel.db))[0]!.lastError).toMatch(/timed out after 50 ms/);
  });

  it('does not lose a delivery claimed by a dispatcher that crashed: it comes back when the lease ends', async () => {
    const { calls, modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires, { dispatcher: fast });
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });
    // A dispatcher claimed both deliveries and died before it recorded anything.
    await kernel.db.execute(
      sql`update kernel_outbox_delivery set attempts = 1, locked_until = now() + interval '5 minutes'`,
    );

    expect(await kernel.dispatcher.dispatchOnce()).toBe(0); // still reserved
    await kernel.db.execute(
      sql`update kernel_outbox_delivery set locked_until = now() - interval '1 second'`,
    );
    expect(await kernel.dispatcher.dispatchOnce()).toBe(2); // the lease ran out

    expect(calls.s1).toHaveLength(1);
    expect(calls.s2).toHaveLength(1);
    const { rows } = await kernel.db.execute<{ attempts: number }>(
      sql`select attempts from kernel_outbox_delivery`,
    );
    expect(rows.every((row) => row.attempts === 2)).toBe(true);
  });

  it('counts a crashed attempt, so a poison event ends up dead instead of looping', async () => {
    const { modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires, {
      dispatcher: { ...fast, maxAttempts: 2 },
    });
    await kernel.start();
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });
    await kernel.db.execute(
      sql`update kernel_outbox_delivery set attempts = 2, locked_until = now() - interval '1 second' where subscriber = 's1'`,
    );
    await kernel.db.execute(
      sql`update kernel_outbox_delivery set status = 'delivered' where subscriber = 's2'`,
    );

    // The claim makes it attempt 3, above the limit. The handler succeeds here, but a handler that
    // crashed the process each time would never reach the update, and the count would still grow.
    await kernel.dispatcher.dispatchOnce();
    const { rows } = await kernel.db.execute<{ attempts: number }>(
      sql`select attempts from kernel_outbox_delivery where subscriber = 's1'`,
    );
    expect(rows[0]!.attempts).toBe(3);
  });
});

describe('wake-up', () => {
  it('delivers through LISTEN/NOTIFY long before the next poll', async () => {
    const { calls, modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires, {
      dispatcher: { pollIntervalMs: 60_000 },
    });
    await kernel.start();
    await kernel.startWorkers();
    await new Promise((resolve) => setTimeout(resolve, 300)); // the first poll finds nothing and sleeps

    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });

    await vi.waitFor(() => expect(calls.s1).toHaveLength(1), { timeout: 5_000 });
    expect(calls.s2).toHaveLength(1);
  });

  it('falls back to polling when notifications are not delivered', async () => {
    const { calls, modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires, { dispatcher: { pollIntervalMs: 100 } });
    await kernel.start();
    // Insert the event without a NOTIFY: only the poll can find it.
    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });
    await kernel.startWorkers();

    await vi.waitFor(() => expect(calls.s2).toHaveLength(1), { timeout: 5_000 });
  });

  it('survives the loss of the listener connection', async () => {
    const { calls, modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires, { dispatcher: { pollIntervalMs: 100 } });
    await kernel.start();
    await kernel.startWorkers();
    const admin = new pg.Client({ connectionString: kernel.config.DATABASE_URL });
    await admin.connect();
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where query like 'listen kernel_outbox%'`,
    );
    await admin.end();

    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });

    await vi.waitFor(() => expect(calls.s1).toHaveLength(1), { timeout: 5_000 });
  });

  it('stops cleanly and does not deliver afterwards', async () => {
    const { calls, modules, requires } = pair({});
    const kernel = await kernels.inline(modules, requires, { dispatcher: { pollIntervalMs: 50 } });
    await kernel.start();
    await kernel.startWorkers();
    await kernel.dispatcher.stop();

    await service<{ fire(p: { n: number }): Promise<void> }>(kernel, 'em').fire({ n: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(calls.s1).toHaveLength(0);
  });
});

describe('system.ready', () => {
  it('reaches the handlers once, after the services are built', async () => {
    const seen: string[] = [];
    const kernel = await kernels.inline([
      defineModule({
        id: 'watcher',
        version: '1.0.0',
        services: () => {
          seen.push('services');
          return {};
        },
        events: {
          on: {
            'system.ready': (event) => {
              seen.push(event.name);
              return Promise.resolve();
            },
          },
        },
      }),
    ]);
    await kernel.start();
    expect(seen).toEqual(['services', 'system.ready']);
  });
});

describe('defaultBackoffMs', () => {
  it.each([
    [1, 5_000],
    [2, 10_000],
    [3, 20_000],
    [6, 160_000],
    [8, 640_000],
    [9, 900_000],
    [30, 900_000],
  ])('after attempt %i it waits %i ms', (attempt, expected) => {
    expect(defaultBackoffMs(attempt)).toBe(expected);
  });
});
