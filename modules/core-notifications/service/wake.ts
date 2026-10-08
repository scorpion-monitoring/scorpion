// Wakes delivery when a message is committed (ADR 0020). `enqueue` calls `pg_notify` inside its
// transaction, which Postgres delivers on commit only; this listener hears it and runs `onWake`
// (which queues the delivery job). The kernel's own listener is the outbox's and offers modules no
// hook, so the module holds one connection per process. Missing a wake-up costs at most a minute:
// the table is the source of truth and a cron sweep covers a lost listener.
import type { Logger } from '@scorpion/kernel';
import pg from 'pg';
import { INBOX_CHANNEL } from './inbox-channel.ts';

export const WAKE_CHANNEL = 'notify_delivery';

export interface WakeListenerOptions {
  connectionString: string;
  log: Logger;
  /** Called at most once per `coalesceMs`, however many messages were committed meanwhile. */
  onWake: () => void | Promise<void>;
  /** Called for every change of an inbox, with the id of its owner (no coalescing: the stream does that). */
  onInbox?: (userId: string) => void;
  coalesceMs?: number;
  reconnectMs?: number;
}

export interface WakeListener {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createWakeListener(options: WakeListenerOptions): WakeListener {
  const { log } = options;
  const coalesceMs = options.coalesceMs ?? 100;
  const reconnectMs = options.reconnectMs ?? 5_000;
  let client: pg.Client | undefined;
  let stopped = true;
  let wakeTimer: NodeJS.Timeout | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;

  function wake() {
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined;
      Promise.resolve(options.onWake()).catch((err: unknown) =>
        log.warn(
          { err },
          'could not queue the delivery job; the minute sweep will pick the work up',
        ),
      );
    }, coalesceMs);
    wakeTimer.unref();
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, reconnectMs);
    reconnectTimer.unref();
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const next = new pg.Client({
      connectionString: options.connectionString,
      application_name: 'scorpion-notifications-listener',
    });
    // A lost connection is not an error for the module: delivery falls back to the sweep.
    next.on('error', (err) => {
      log.warn({ err }, 'notification listener lost its connection; the minute sweep continues');
      client = undefined;
      next.removeAllListeners();
      next.end().catch(() => undefined);
      scheduleReconnect();
    });
    next.on('notification', (message) => {
      if (message.channel === WAKE_CHANNEL) wake();
      else if (message.channel === INBOX_CHANNEL && message.payload) {
        options.onInbox?.(message.payload);
      }
    });
    try {
      await next.connect();
      // Do not keep the process alive for a listener.
      (
        next as unknown as { connection?: { stream?: { unref?: () => void } } }
      ).connection?.stream?.unref?.();
      await next.query(`listen ${WAKE_CHANNEL}`);
      await next.query(`listen ${INBOX_CHANNEL}`);
      if (stopped) {
        next.removeAllListeners();
        await next.end().catch(() => undefined);
        return;
      }
      client = next;
    } catch (err) {
      log.warn({ err }, 'notification listener could not connect; the minute sweep continues');
      next.removeAllListeners();
      next.end().catch(() => undefined);
      scheduleReconnect();
    }
  }

  return {
    async start() {
      if (!stopped) return;
      stopped = false;
      await connect();
    },
    async stop() {
      stopped = true;
      clearTimeout(wakeTimer);
      clearTimeout(reconnectTimer);
      wakeTimer = undefined;
      reconnectTimer = undefined;
      const closing = client;
      client = undefined;
      if (closing) {
        closing.removeAllListeners();
        closing.on('error', () => undefined);
        await closing.end().catch(() => undefined);
      }
    },
  };
}
