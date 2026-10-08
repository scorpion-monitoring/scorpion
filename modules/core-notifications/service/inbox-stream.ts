// The live count of the inbox (ADR-0028): `GET /inbox/stream` is a server-sent event stream that tells one
// signed-in person how many items they have not read. It carries **only that number** and a heartbeat, never
// the title, text or link of an item: the page fetches the list through the ordinary route when the number
// says something changed, so the stream holds nothing that needs the access checks of a list.
//
// What keeps it safe to leave open:
//  - a stream belongs to the caller who opened it and can only ever name that caller's count; there is no
//    id in the request, so there is nobody else's stream to open;
//  - at most `inboxStream.perUser` streams per person and `inboxStream.global` in a process (429 above);
//  - every heartbeat (25 s) asks the authentication step again, passively, whether the session or token is
//    still good, and whether the person still holds the permission; if not the stream ends, so a logout,
//    a revoked session, an expired one or a lost role closes it within one heartbeat;
//  - no event ids and no `Last-Event-ID` replay: a client that reconnects starts from the current count;
//  - a change made in another process reaches it through `pg_notify` (the channel carries a user id).
import { DomainError, Unauthorized, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { Db, Logger } from '@scorpion/kernel';
import { and, count, eq, isNull } from 'drizzle-orm';
import { inboxItem } from '../db/schema.ts';
import { PERMISSION_INBOX_READ } from './inbox.ts';

/** How often an open stream is checked and told it is alive. Below the idle limits of most proxies (30 to 60 s). */
export const HEARTBEAT_MS = 25_000;
/** What a browser waits before it reconnects a stream that was cut. */
export const RETRY_MS = 15_000;

/** 429 for a person or a process that has too many streams open. Only a signed-in caller can meet it. */
export class TooManyStreams extends DomainError {
  constructor(detail: string, retryAfterSeconds: number) {
    super(429, 'Too Many Requests', detail);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface InboxStreamLimits {
  perUser: number;
  global: number;
}

export interface OpenOptions {
  /** `recheckActor` of the request: false once the credentials of this request are no good. */
  recheck: () => Promise<boolean>;
}

export interface InboxStreamHub {
  /**
   * Needs `core.notifications.inbox.read`. The stream of the caller's unread count: a `ReadableStream` of
   * UTF-8 server-sent events. `Unauthorized` for an anonymous caller, `TooManyStreams` over a cap.
   */
  open(actor: Actor, options: OpenOptions): Promise<ReadableStream<Uint8Array>>;
  /** Somebody's inbox changed (this process or another): every stream of that person looks at the count again. */
  changed(userId: string): void;
  /** How many streams are open in this process. */
  readonly streams: number;
  /** Ends every stream (the process is stopping). */
  closeAll(): void;
}

interface Stream {
  userId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  last: number | undefined;
  heartbeat: NodeJS.Timeout;
  push: NodeJS.Timeout | undefined;
  closed: boolean;
}

const encoder = new TextEncoder();
const unreadEvent = (value: number) =>
  encoder.encode(`event: unread\ndata: {"count":${value}}\n\n`);
const COMMENT = encoder.encode(': heartbeat\n\n');
const HELLO = encoder.encode(`retry: ${RETRY_MS}\n\n`);

export function createInboxStreamHub(deps: {
  db: Db;
  authz: Pick<AuthzService, 'require' | 'can'>;
  limits: () => Promise<InboxStreamLimits>;
  log: Logger;
  heartbeatMs?: number;
  /** How long changes are gathered before the count is read, so a burst of items is one event. */
  coalesceMs?: number;
}): InboxStreamHub {
  const { db, authz, log } = deps;
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const coalesceMs = deps.coalesceMs ?? 100;
  const byUser = new Map<string, Set<Stream>>();
  let total = 0;

  async function unread(userId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(inboxItem)
      .where(and(eq(inboxItem.userId, userId), isNull(inboxItem.readAt)));
    return row?.n ?? 0;
  }

  function end(stream: Stream) {
    if (stream.closed) return;
    stream.closed = true;
    clearInterval(stream.heartbeat);
    clearTimeout(stream.push);
    const set = byUser.get(stream.userId);
    set?.delete(stream);
    if (set?.size === 0) byUser.delete(stream.userId);
    total -= 1;
    try {
      stream.controller.close();
    } catch {
      // already closed by the client going away
    }
  }

  /** Sends the count if it differs from the last one sent. */
  async function sendCount(stream: Stream): Promise<void> {
    try {
      const value = await unread(stream.userId);
      if (stream.closed || value === stream.last) return;
      stream.last = value;
      stream.controller.enqueue(unreadEvent(value));
    } catch (err) {
      // A database that cannot answer ends the stream: the client falls back to polling, which retries.
      log.warn({ err }, 'inbox stream: could not read the unread count; the stream ends');
      end(stream);
    }
  }

  async function beat(stream: Stream, actor: Actor, recheck: OpenOptions['recheck']) {
    if (stream.closed) return;
    let good: boolean;
    try {
      good = (await recheck()) && (await authz.can(actor, PERMISSION_INBOX_READ));
    } catch {
      good = false;
    }
    if (stream.closed) return;
    if (!good) return end(stream);
    try {
      stream.controller.enqueue(COMMENT);
    } catch {
      return end(stream);
    }
    // Self-healing: a wake-up that was lost (the listener reconnecting) is made up for here.
    await sendCount(stream);
  }

  return {
    async open(actor, { recheck }) {
      await authz.require(actor, PERMISSION_INBOX_READ);
      if (actor.kind !== 'user') throw new Unauthorized();
      const userId = actor.userId;
      const limits = await deps.limits();
      // The checks and the registration below run with no await between them, so two requests cannot both pass.
      if (total >= limits.global) {
        throw new TooManyStreams('The server has too many open streams. Try again shortly.', 30);
      }
      if ((byUser.get(userId)?.size ?? 0) >= limits.perUser) {
        throw new TooManyStreams('You have too many open streams. Close another tab first.', 30);
      }
      let mine: Stream | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const stream: Stream = {
            userId,
            controller,
            last: undefined,
            heartbeat: setInterval(() => void beat(stream, actor, recheck), heartbeatMs),
            push: undefined,
            closed: false,
          };
          stream.heartbeat.unref();
          mine = stream;
          const set = byUser.get(userId) ?? new Set<Stream>();
          set.add(stream);
          byUser.set(userId, set);
          total += 1;
          controller.enqueue(HELLO);
        },
        cancel() {
          if (mine) end(mine);
        },
      });
      // The first event is the count as it is now.
      if (mine) await sendCount(mine);
      return body;
    },

    changed(userId) {
      for (const stream of byUser.get(userId) ?? []) {
        if (stream.push) continue;
        stream.push = setTimeout(() => {
          stream.push = undefined;
          void sendCount(stream);
        }, coalesceMs);
        stream.push.unref();
      }
    },

    get streams() {
      return total;
    },

    closeAll() {
      for (const set of [...byUser.values()]) for (const stream of [...set]) end(stream);
    },
  };
}
