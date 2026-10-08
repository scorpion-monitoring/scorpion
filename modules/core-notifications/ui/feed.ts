// The unread count of the bell: a live stream when there is one (ADR-0028), and a poll every minute when the
// stream cannot be opened, breaks, or is cut by a proxy. Plain logic with its clock and its stream passed in,
// so the rules are tests and the component only wires them to `EventSource` and the typed client.
export interface FeedOptions {
  /**
   * Opens the stream. `count` is called with every number it says; `fail` once when it cannot be opened or
   * breaks (the feed then closes it and polls). Returns the function that closes it.
   */
  openStream: (handlers: { count: (n: number) => void; fail: () => void }) => () => void;
  /** Asks for the count once (`GET /notifications/inbox/unread-count`). A failure is ignored: the next poll tries again. */
  poll: () => Promise<number>;
  /** Called with each new count, from the stream or a poll. */
  onCount: (n: number) => void;
  /** How often to poll while there is no stream. Default 60 s. */
  pollMs?: number;
  /** How long to wait before trying the stream again after it failed. Default 5 minutes. */
  retryStreamMs?: number;
  setTimeout?: (run: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface Feed {
  start(): void;
  stop(): void;
  /** `stream` while a stream is open and has spoken, `poll` while polling, `idle` before start and after stop. */
  readonly mode: 'stream' | 'poll' | 'idle';
}

export const POLL_MS = 60_000;
export const RETRY_STREAM_MS = 300_000;

export function createInboxFeed(options: FeedOptions): Feed {
  const pollMs = options.pollMs ?? POLL_MS;
  const retryMs = options.retryStreamMs ?? RETRY_STREAM_MS;
  const later = options.setTimeout ?? ((run, ms) => globalThis.setTimeout(run, ms));
  const cancel = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as never));
  let mode: Feed['mode'] = 'idle';
  let closeStream: (() => void) | undefined;
  let pollTimer: unknown;
  let retryTimer: unknown;
  let running = false;

  function stopPolling() {
    if (pollTimer !== undefined) cancel(pollTimer);
    pollTimer = undefined;
  }

  async function pollOnce() {
    try {
      const n = await options.poll();
      if (running && mode === 'poll') options.onCount(n);
    } catch {
      // The next round asks again.
    }
  }

  function schedulePoll() {
    if (!running || mode !== 'poll') return;
    pollTimer = later(() => {
      pollTimer = undefined;
      void pollOnce().then(schedulePoll);
    }, pollMs);
  }

  function fallBack() {
    closeStream?.();
    closeStream = undefined;
    if (!running || mode === 'poll') return;
    mode = 'poll';
    void pollOnce().then(schedulePoll);
    retryTimer = later(() => {
      retryTimer = undefined;
      tryStream();
    }, retryMs);
  }

  function tryStream() {
    if (!running) return;
    let failed = false;
    closeStream = options.openStream({
      count: (n) => {
        if (!running) return;
        // The first word of a stream ends the polling: the stream is the source from here on.
        if (mode !== 'stream') {
          mode = 'stream';
          stopPolling();
          if (retryTimer !== undefined) cancel(retryTimer);
          retryTimer = undefined;
        }
        options.onCount(n);
      },
      fail: () => {
        if (failed) return;
        failed = true;
        fallBack();
      },
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      tryStream();
    },
    stop() {
      running = false;
      mode = 'idle';
      stopPolling();
      if (retryTimer !== undefined) cancel(retryTimer);
      retryTimer = undefined;
      closeStream?.();
      closeStream = undefined;
    },
    get mode() {
      return mode;
    },
  };
}
