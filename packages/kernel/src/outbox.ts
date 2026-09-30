// The transactional outbox (ADR 0003). `ctx.events.emit()` writes the event and one delivery row
// per subscribing module in the caller's transaction. The dispatcher delivers each row at least
// once, retries a failing subscriber with backoff and marks it dead after the last attempt.
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { z } from 'zod';
import { activeTransaction, type Db } from './db.ts';
import { ids } from './ids.ts';
import type { Logger } from './logger.ts';
import type { DomainEvent, EventHandler } from './manifest.ts';
import { maskString } from './redact.ts';

export const NOTIFY_CHANNEL = 'kernel_outbox';

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}

/** What a module sees as `ctx.events`. */
export interface EventsApi {
  /**
   * Records a domain event. Call it inside `ctx.db.tx()`: the event commits or rolls back with
   * the change. The payload is validated against the schema the module declared for the name.
   */
  emit(name: string, payload: unknown): Promise<void>;
}

export interface EmitterOptions {
  moduleId: string;
  /** The events this module declares: versioned name → payload schema. */
  schemas: ReadonlyMap<string, z.ZodType>;
  /** Event name → ids of the modules that subscribe to it. */
  subscribers: ReadonlyMap<string, readonly string[]>;
}

export function createEvents({ moduleId, schemas, subscribers }: EmitterOptions): EventsApi {
  return {
    async emit(name, payload) {
      const tx = activeTransaction();
      if (!tx) {
        throw new EventError(
          `${moduleId}: ctx.events.emit("${name}") must be called inside ctx.db.tx(), so the event commits with the change`,
        );
      }
      const schema = schemas.get(name);
      if (!schema)
        throw new EventError(`${moduleId}: event "${name}" is not declared in events.emits`);
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        const problems = parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`,
        );
        throw new EventError(
          `${moduleId}: payload of "${name}" is invalid (${problems.join('; ')})`,
        );
      }

      const eventId = ids.uuidv7();
      await tx.execute(
        sql`insert into kernel_outbox (id, name, emitter, payload) values (${eventId}, ${name}, ${moduleId}, ${JSON.stringify(parsed.data)}::jsonb)`,
      );
      for (const subscriber of subscribers.get(name) ?? []) {
        await tx.execute(
          sql`insert into kernel_outbox_delivery (id, event_id, subscriber) values (${ids.uuidv7()}, ${eventId}, ${subscriber})`,
        );
      }
      // Delivered when the transaction commits, and never if it rolls back.
      await tx.execute(sql`select pg_notify(${NOTIFY_CHANNEL}, ${eventId})`);
    },
  };
}

export interface Subscription {
  /** The subscribing module. */
  subscriber: string;
  eventName: string;
  handler: EventHandler;
}

export interface DispatcherOptions {
  db: Db;
  connectionString: string;
  log: Logger;
  subscriptions: readonly Subscription[];
  /** Handler runs for this module get its context. */
  contextFor: (subscriber: string) => Parameters<EventHandler>[1];
  /** Attempts before a delivery is marked dead. Default 8. */
  maxAttempts?: number;
  /** Delay before attempt `n + 1` after attempt `n` failed, in ms. Default: 5 s doubling, at most 15 min. */
  backoffMs?: (attempt: number) => number;
  /** How long a claimed delivery is reserved for one dispatcher. Default 5 min. */
  leaseMs?: number;
  /** Deliveries claimed per round. Default 20. */
  batchSize?: number;
  /** Handlers running at once. Default 4. */
  concurrency?: number;
  /** A handler that takes longer counts as failed. Default 30 s. */
  handlerTimeoutMs?: number;
  /** Polling interval when no notification arrives. Default 5 s. */
  pollIntervalMs?: number;
}

export function defaultBackoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** (attempt - 1), 15 * 60_000);
}

interface Claimed {
  id: string;
  eventId: string;
  subscriber: string;
  attempts: number;
  name: string;
  payload: unknown;
  occurredAt: Date;
}

export interface Dispatcher {
  /** Claims and delivers what is due once. Returns how many deliveries it worked on. */
  dispatchOnce(): Promise<number>;
  /** Starts the LISTEN/NOTIFY wake-up and the polling loop. */
  start(): Promise<void>;
  /** Stops claiming, waits for running handlers (up to `timeoutMs`) and closes the listener. */
  stop(timeoutMs?: number): Promise<void>;
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const {
    db,
    log,
    maxAttempts = 8,
    backoffMs = defaultBackoffMs,
    leaseMs = 5 * 60_000,
    batchSize = 20,
    concurrency = 4,
    handlerTimeoutMs = 30_000,
    pollIntervalMs = 5_000,
  } = options;
  const handlers = new Map(
    options.subscriptions.map((s) => [`${s.subscriber}\u0000${s.eventName}`, s.handler]),
  );

  let stopping = false;
  let running: Promise<void> | undefined;
  let listener: pg.Client | undefined;
  let wake: (() => void) | undefined;
  let notified = false;
  let inFlight = 0;

  async function claim(): Promise<Claimed[]> {
    // The attempt is counted when the delivery is claimed, so a handler that kills the process
    // still runs out of attempts instead of looping forever.
    const result = await db.execute<{
      id: string;
      event_id: string;
      subscriber: string;
      attempts: number;
      name: string;
      payload: unknown;
      occurred_at: Date;
    }>(sql`
      with due as (
        select d.id from kernel_outbox_delivery d
         where d.status = 'pending' and d.next_attempt_at <= now()
           and (d.locked_until is null or d.locked_until < now())
         order by d.next_attempt_at, d.id
         limit ${batchSize}
         for update skip locked
      )
      update kernel_outbox_delivery d
         set attempts = d.attempts + 1,
             locked_until = now() + ${leaseMs} * interval '1 millisecond'
        from due, kernel_outbox o
       where d.id = due.id and o.id = d.event_id
   returning d.id, d.event_id, d.subscriber, d.attempts, o.name, o.payload, o.occurred_at
    `);
    return result.rows
      .map((row) => ({
        id: row.id,
        eventId: row.event_id,
        subscriber: row.subscriber,
        attempts: row.attempts,
        name: row.name,
        payload: row.payload,
        occurredAt: new Date(row.occurred_at),
      }))
      .sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
  }

  async function withTimeout(work: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`handler timed out after ${handlerTimeoutMs} ms`)),
        handlerTimeoutMs,
      );
    });
    try {
      await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function deliver(delivery: Claimed): Promise<void> {
    const handler = handlers.get(`${delivery.subscriber}\u0000${delivery.name}`);
    const event: DomainEvent = {
      id: delivery.eventId,
      name: delivery.name,
      payload: delivery.payload,
      occurredAt: delivery.occurredAt,
    };
    try {
      if (!handler) throw new NoHandlerError(delivery.subscriber, delivery.name);
      await withTimeout(
        Promise.resolve().then(() => handler(event, options.contextFor(delivery.subscriber))),
      );
      await db.execute(sql`
        update kernel_outbox_delivery
           set status = 'delivered', delivered_at = now(), locked_until = null, last_error = null
         where id = ${delivery.id}`);
    } catch (error) {
      const message = maskString(error instanceof Error ? error.message : String(error));
      const dead = error instanceof NoHandlerError || delivery.attempts >= maxAttempts;
      log.warn(
        {
          eventId: delivery.eventId,
          event: delivery.name,
          subscriber: delivery.subscriber,
          attempt: delivery.attempts,
          dead,
          err: error,
        },
        dead ? 'event delivery failed for good' : 'event delivery failed, will retry',
      );
      await db.execute(sql`
        update kernel_outbox_delivery
           set status = ${dead ? 'dead' : 'pending'},
               last_error = ${message},
               locked_until = null,
               next_attempt_at = now() + ${dead ? 0 : backoffMs(delivery.attempts)} * interval '1 millisecond'
         where id = ${delivery.id}`);
    }
  }

  async function dispatchOnce(): Promise<number> {
    const batch = await claim();
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        const delivery = batch[next++]!;
        inFlight += 1;
        try {
          await deliver(delivery);
        } finally {
          inFlight -= 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
    return batch.length;
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      let worked = 0;
      try {
        worked = await dispatchOnce();
      } catch (error) {
        log.error({ err: error }, 'outbox dispatch failed');
      }
      if (stopping) break;
      if (worked === 0 && !notified) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, pollIntervalMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = undefined;
      }
      notified = false;
    }
  }

  async function listen(): Promise<void> {
    if (stopping) return;
    const client = new pg.Client({ connectionString: options.connectionString });
    client.on('notification', () => {
      notified = true;
      wake?.();
    });
    client.on('error', (error) => {
      log.warn({ err: error }, 'outbox listener lost its connection; polling continues');
      listener = undefined;
      client.removeAllListeners();
      client.end().catch(() => undefined);
      if (!stopping) setTimeout(() => void listen().catch(() => undefined), pollIntervalMs).unref();
    });
    try {
      await client.connect();
      await client.query(`listen ${NOTIFY_CHANNEL}`);
      listener = client;
    } catch (error) {
      log.warn({ err: error }, 'outbox listener could not connect; polling only');
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      if (!stopping) setTimeout(() => void listen().catch(() => undefined), pollIntervalMs).unref();
    }
  }

  return {
    dispatchOnce,
    async start() {
      if (running) return;
      stopping = false;
      await listen();
      running = loop();
    },
    async stop(timeoutMs = 10_000) {
      stopping = true;
      wake?.();
      const closing = listener;
      listener = undefined;
      if (closing) {
        closing.removeAllListeners();
        await closing.end().catch(() => undefined);
      }
      if (running) {
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref());
        await Promise.race([running, timeout]);
        if (inFlight > 0)
          log.warn({ inFlight }, 'stopped the outbox dispatcher with handlers still running');
        running = undefined;
      }
    },
  };
}

class NoHandlerError extends Error {
  constructor(subscriber: string, eventName: string) {
    super(`${subscriber} no longer has a handler for ${eventName}`);
  }
}
