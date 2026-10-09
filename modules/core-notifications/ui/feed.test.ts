import { describe, expect, it } from 'vitest';
import { createInboxFeed, POLL_MS, RETRY_STREAM_MS, type FeedOptions } from './feed.ts';

/** A clock the test moves by hand, a stream it can speak and break, and a poll it can answer. */
function rig(overrides: Partial<FeedOptions> = {}) {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextId = 1;
  const counts: number[] = [];
  const streams: { closed: boolean; count: (n: number) => void; fail: () => void }[] = [];
  let polls = 0;
  let pollAnswer: () => Promise<number> = () => Promise.resolve(7);
  const feed = createInboxFeed({
    openStream: (handlers) => {
      const stream = { closed: false, ...handlers };
      streams.push(stream);
      return () => {
        stream.closed = true;
      };
    },
    poll: () => {
      polls += 1;
      return pollAnswer();
    },
    onCount: (n) => counts.push(n),
    setTimeout: (run, ms) => {
      timers.set(nextId, { at: now + ms, run });
      return nextId++;
    },
    clearTimeout: (id) => void timers.delete(id as number),
    ...overrides,
  });
  async function advance(ms: number) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    }
    // Let the promises of a poll settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    feed,
    counts,
    streams,
    advance,
    polls: () => polls,
    timers: () => timers.size,
    answerPoll: (next: () => Promise<number>) => (pollAnswer = next),
  };
}

describe('the feed of the unread count', () => {
  it('uses the stream while it speaks, and does not poll', async () => {
    const r = rig();
    r.feed.start();
    r.streams[0]!.count(3);
    r.streams[0]!.count(4);
    expect(r.counts).toEqual([3, 4]);
    expect(r.feed.mode).toBe('stream');
    await r.advance(10 * POLL_MS);
    expect(r.polls()).toBe(0);
  });

  it('polls at once and then every minute when the stream cannot be opened', async () => {
    const r = rig();
    r.feed.start();
    r.streams[0]!.fail();
    await r.advance(0);
    expect(r.feed.mode).toBe('poll');
    expect(r.polls()).toBe(1);
    expect(r.counts).toEqual([7]);
    await r.advance(POLL_MS);
    await r.advance(POLL_MS);
    expect(r.polls()).toBe(3);
    expect(r.streams[0]!.closed).toBe(true);
  });

  it('polls when a stream that was working breaks (a proxy cut it)', async () => {
    const r = rig();
    r.feed.start();
    r.streams[0]!.count(1);
    r.streams[0]!.fail();
    await r.advance(0);
    expect(r.feed.mode).toBe('poll');
    expect(r.counts).toEqual([1, 7]);
  });

  it('tries the stream again after five minutes, and stops polling when it speaks', async () => {
    const r = rig();
    r.feed.start();
    r.streams[0]!.fail();
    await r.advance(0);
    await r.advance(RETRY_STREAM_MS);
    expect(r.streams).toHaveLength(2);
    const before = r.polls();
    r.streams[1]!.count(9);
    expect(r.feed.mode).toBe('stream');
    await r.advance(5 * POLL_MS);
    expect(r.polls()).toBe(before);
    expect(r.counts.at(-1)).toBe(9);
  });

  it('keeps polling when the second stream fails too, and does not open one stream per round', async () => {
    const r = rig();
    r.feed.start();
    r.streams[0]!.fail();
    await r.advance(RETRY_STREAM_MS);
    r.streams[1]!.fail();
    await r.advance(0);
    expect(r.feed.mode).toBe('poll');
    await r.advance(POLL_MS);
    expect(r.streams).toHaveLength(2);
  });

  it('survives a failed poll and asks again next round', async () => {
    const r = rig();
    r.answerPoll(() => Promise.reject(new Error('offline')));
    r.feed.start();
    r.streams[0]!.fail();
    await r.advance(0);
    expect(r.counts).toEqual([]);
    r.answerPoll(() => Promise.resolve(2));
    await r.advance(POLL_MS);
    expect(r.counts).toEqual([2]);
  });

  it('says a failure once, whatever the stream does afterwards', async () => {
    const r = rig();
    r.feed.start();
    r.streams[0]!.fail();
    r.streams[0]!.fail();
    await r.advance(0);
    expect(r.polls()).toBe(1);
  });

  it('stops everything: no timer, no stream, no count', async () => {
    const r = rig();
    r.feed.start();
    r.streams[0]!.fail();
    await r.advance(0);
    r.feed.stop();
    expect(r.feed.mode).toBe('idle');
    expect(r.timers()).toBe(0);
    await r.advance(10 * RETRY_STREAM_MS);
    expect(r.streams).toHaveLength(1);
    r.streams[0]!.count(5);
    expect(r.counts).toEqual([7]);
  });

  it('start twice is one start', () => {
    const r = rig();
    r.feed.start();
    r.feed.start();
    expect(r.streams).toHaveLength(1);
  });
});
