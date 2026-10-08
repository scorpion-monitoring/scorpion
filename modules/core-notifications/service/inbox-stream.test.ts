// The live count of the inbox on real Postgres (ADR-0028): what the stream says and to whom, that a change
// in another process reaches it, the caps, and that it ends when the caller is no longer good. The
// heartbeat is tuned down so a test does not wait 25 seconds.
import { Forbidden, Unauthorized } from '@scorpion/contracts';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useNotifications, type Started } from '../test/harness.ts';
import { TooManyStreams } from './inbox-stream.ts';

const harness = useNotifications();
const TUNED = { inboxStream: { heartbeatMs: 80, coalesceMs: 10 } };

/** Reads a stream as text, chunk by chunk, with a clock on every wait. */
function reader(body: ReadableStream<Uint8Array>) {
  const source = body.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  let done = false;
  async function until(predicate: (text: string) => boolean, ms = 5000): Promise<string> {
    const deadline = Date.now() + ms;
    while (!predicate(seen)) {
      if (done) throw new Error(`the stream ended; it said: ${JSON.stringify(seen)}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; the stream said: ${JSON.stringify(seen)}`);
      const next = await Promise.race([
        source.read(),
        new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), left)),
      ]);
      if (next === 'late') continue;
      if (next.done) done = true;
      else seen += decoder.decode(next.value, { stream: true });
    }
    return seen;
  }
  const counts = () =>
    [...seen.matchAll(/event: unread\ndata: \{"count":(\d+)\}/g)].map((m) => +m[1]!);
  return {
    until,
    counts,
    text: () => seen,
    /** Waits for the end of the stream (false if it stays open for `ms`). */
    async ends(ms = 3000) {
      const deadline = Date.now() + ms;
      while (!done && Date.now() < deadline) {
        const next = await Promise.race([
          source.read(),
          new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), 50)),
        ]);
        if (next !== 'late') {
          if (next.done) done = true;
          else seen += decoder.decode(next.value, { stream: true });
        }
      }
      return done;
    },
    close: () => source.cancel(),
  };
}

const alwaysGood = () => Promise.resolve(true);
const send = (t: Started, userId: string, name = 'Ada') =>
  t.mail.sendTemplate({
    template: 'fix.hello',
    data: { name },
    recipient: { address: `${randomUUID()}@example.org`, userId },
    inApp: true,
  });
const actorFor = async (t: Started) => {
  const actor = await t.actorOf('user');
  return actor;
};

describe('what the stream says', () => {
  it('starts with the current count, follows every change, and says nothing but numbers', async () => {
    const t = await harness.start({ notifications: TUNED });
    const me = await actorFor(t);
    await send(t, me.userId, 'Zed');
    const stream = reader(await t.notifications.inboxStream.open(me, { recheck: alwaysGood }));
    await stream.until(() => stream.counts().length >= 1);
    expect(stream.counts()).toEqual([1]);

    await send(t, me.userId, 'Ben');
    await stream.until(() => stream.counts().at(-1) === 2);

    const [item] = (await t.notifications.inbox.list(me, { page: 0, pageSize: 10 })).items;
    await t.notifications.inbox.markRead(me, item!.id);
    await stream.until(() => stream.counts().at(-1) === 1);
    await t.notifications.inbox.markAllRead(me);
    await stream.until(() => stream.counts().at(-1) === 0);

    await stream.until((text) => text.includes(': heartbeat'));
    // Only counts, a retry hint and heartbeats: no title, text, link, id or address ever.
    const said = stream.text();
    for (const secret of ['Zed', 'Ben', 'Welcome', 'Hello', item!.id, '@example.org']) {
      expect(said).not.toContain(secret);
    }
    expect(said).not.toMatch(/^id:/m);
    expect(said).toMatch(/^retry: \d+$/m);
    expect(said).toContain(': heartbeat');
    stream.close();
  });

  it('does not send the same count twice, and a burst of items is one event', async () => {
    const t = await harness.start({
      notifications: { inboxStream: { heartbeatMs: 60_000, coalesceMs: 150 } },
    });
    const me = await actorFor(t);
    const stream = reader(await t.notifications.inboxStream.open(me, { recheck: alwaysGood }));
    await stream.until(() => stream.counts().length === 1);
    await Promise.all([send(t, me.userId), send(t, me.userId), send(t, me.userId)]);
    await stream.until(() => stream.counts().at(-1) === 3);
    expect(stream.counts()).toEqual([0, 3]);
    stream.close();
  });

  it('tells a person only about their own inbox', async () => {
    const t = await harness.start({ notifications: TUNED });
    const ann = await actorFor(t);
    const bob = await actorFor(t);
    const annStream = reader(await t.notifications.inboxStream.open(ann, { recheck: alwaysGood }));
    const bobStream = reader(await t.notifications.inboxStream.open(bob, { recheck: alwaysGood }));
    await annStream.until(() => annStream.counts().length === 1);
    await bobStream.until(() => bobStream.counts().length === 1);
    await send(t, ann.userId);
    await annStream.until(() => annStream.counts().at(-1) === 1);
    // Give a wrong delivery every chance to happen.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(bobStream.counts()).toEqual([0]);
    annStream.close();
    bobStream.close();
  });

  it('starts from the current count after a reconnect, with no replay and no event ids', async () => {
    const t = await harness.start({ notifications: TUNED });
    const me = await actorFor(t);
    const first = reader(await t.notifications.inboxStream.open(me, { recheck: alwaysGood }));
    await first.until(() => first.counts().length === 1);
    await send(t, me.userId);
    await first.until(() => first.counts().at(-1) === 1);
    first.close();
    await send(t, me.userId);
    const second = reader(await t.notifications.inboxStream.open(me, { recheck: alwaysGood }));
    await second.until(() => second.counts().length >= 1);
    expect(second.counts()).toEqual([2]);
    expect(second.text()).not.toMatch(/^id:/m);
    second.close();
  });

  it('does not announce a change that was rolled back', async () => {
    const t = await harness.start({ notifications: TUNED });
    const me = await actorFor(t);
    const stream = reader(await t.notifications.inboxStream.open(me, { recheck: alwaysGood }));
    await stream.until(() => stream.counts().length === 1);
    await t.mail
      .sendTemplate(
        {
          template: 'fix.hello',
          data: { name: 'Ada' },
          recipient: { address: 'a@example.org', userId: me.userId },
          inApp: true,
        },
        { failAfter: true },
      )
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(stream.counts()).toEqual([0]);
    stream.close();
  });
});

describe('a change in another process', () => {
  it('reaches a stream through the database: a mail queued on one kernel, a stream on the other', async () => {
    const a = await harness.start({ notifications: TUNED });
    const b = await harness.start({
      databaseUrl: a.databaseUrl,
      secretsKey: undefined,
      notifications: TUNED,
    });
    const me = await actorFor(a);
    const stream = reader(await b.notifications.inboxStream.open(me, { recheck: alwaysGood }));
    await stream.until(() => stream.counts().length === 1);
    await send(a, me.userId);
    await stream.until(() => stream.counts().at(-1) === 1);
    // And back: reading the item on the other kernel lowers it.
    await a.notifications.inbox.markAllRead(me);
    await stream.until(() => stream.counts().at(-1) === 0);
    stream.close();
  });
});

describe('the caps', () => {
  const caps = (perUser: number, global: number) => ({
    notifications: TUNED,
    settings: { inboxStream: { perUser, global } },
  });

  it('refuses one person more streams than the setting allows (429), until one closes', async () => {
    const t = await harness.start(caps(2, 50));
    const me = await actorFor(t);
    const one = await t.notifications.inboxStream.open(me, { recheck: alwaysGood });
    const two = await t.notifications.inboxStream.open(me, { recheck: alwaysGood });
    const refused = await t.notifications.inboxStream
      .open(me, { recheck: alwaysGood })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TooManyStreams);
    expect(refused).toMatchObject({ status: 429, retryAfterSeconds: 30 });
    // Another person is not affected.
    const other = await actorFor(t);
    reader(await t.notifications.inboxStream.open(other, { recheck: alwaysGood })).close();

    await one.cancel();
    expect(t.notifications.inboxStream.streams).toBe(1);
    reader(await t.notifications.inboxStream.open(me, { recheck: alwaysGood })).close();
    await two.cancel();
  });

  it('refuses a stream over the cap of the process, whoever asks', async () => {
    const t = await harness.start(caps(5, 2));
    const [a, b, c] = [await actorFor(t), await actorFor(t), await actorFor(t)];
    const one = await t.notifications.inboxStream.open(a, { recheck: alwaysGood });
    const two = await t.notifications.inboxStream.open(b, { recheck: alwaysGood });
    await expect(
      t.notifications.inboxStream.open(c, { recheck: alwaysGood }),
    ).rejects.toBeInstanceOf(TooManyStreams);
    await one.cancel();
    await two.cancel();
    expect(t.notifications.inboxStream.streams).toBe(0);
  });

  it('counts two parallel requests of one person once each (no race past the cap)', async () => {
    const t = await harness.start(caps(1, 50));
    const me = await actorFor(t);
    const results = await Promise.allSettled([
      t.notifications.inboxStream.open(me, { recheck: alwaysGood }),
      t.notifications.inboxStream.open(me, { recheck: alwaysGood }),
      t.notifications.inboxStream.open(me, { recheck: alwaysGood }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    t.notifications.inboxStream.closeAll();
  });
});

describe('who may open one', () => {
  it('is denied to anonymous (401) and to a caller without core.notifications.inbox.read (403), and opens nothing', async () => {
    const t = await harness.start({ notifications: TUNED });
    await expect(
      t.notifications.inboxStream.open({ kind: 'anonymous' }, { recheck: alwaysGood }),
    ).rejects.toBeInstanceOf(Unauthorized);
    const nobody = await t.actorOf();
    await expect(
      t.notifications.inboxStream.open(nobody, { recheck: alwaysGood }),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(t.notifications.inboxStream.streams).toBe(0);
  });
});

describe('when the caller is no longer good', () => {
  it('ends within one heartbeat once the credentials fail the re-check (a logout, a revoked or expired session)', async () => {
    const t = await harness.start({ notifications: TUNED });
    const me = await actorFor(t);
    let good = true;
    const stream = reader(
      await t.notifications.inboxStream.open(me, { recheck: () => Promise.resolve(good) }),
    );
    await stream.until(() => stream.text().includes(': heartbeat'));
    good = false;
    expect(await stream.ends()).toBe(true);
    expect(t.notifications.inboxStream.streams).toBe(0);
    // Nothing more is sent after the end: a change now reaches nobody.
    await send(t, me.userId);
    expect(stream.counts()).toEqual([0]);
  });

  it('ends when the re-check throws, and when the person loses the permission', async () => {
    const t = await harness.start({ notifications: TUNED });
    const thrower = await actorFor(t);
    const one = reader(
      await t.notifications.inboxStream.open(thrower, {
        recheck: () => Promise.reject(new Error('the database is gone')),
      }),
    );
    expect(await one.ends()).toBe(true);

    const losing = await actorFor(t);
    const two = reader(await t.notifications.inboxStream.open(losing, { recheck: alwaysGood }));
    await two.until(() => two.counts().length === 1);
    await t.kernel.pool.query(`delete from authz_role_assignment where user_id = $1`, [
      losing.userId,
    ]);
    // The permission cache of a process is short; the stream ends within it and one heartbeat.
    expect(await two.ends(12_000)).toBe(true);
  }, 20_000);

  it('ends every stream when the module closes (the process is stopping)', async () => {
    const t = await harness.start({ notifications: TUNED });
    const me = await actorFor(t);
    const stream = reader(await t.notifications.inboxStream.open(me, { recheck: alwaysGood }));
    await stream.until(() => stream.counts().length === 1);
    await t.notifications.close();
    expect(await stream.ends()).toBe(true);
  });
});
