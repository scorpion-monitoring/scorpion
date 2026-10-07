// The in-app inbox on real Postgres: how an item comes to be (same transaction as the mail, or alone),
// what the preferences do to it, what a sensitive template leaves out, and the service that serves the
// caller's own items and nobody else's. One kernel for the file: each test uses its own users.
import { Forbidden, Invalid } from '@scorpion/contracts';
import { makeInboxItem, makePreference, tablesContaining } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { mail, useNotifications, type Started } from '../test/harness.ts';
import { NotificationError } from './notifications.ts';
import { PREFERENCES_KEY } from './preferences.ts';

const harness = useNotifications();
let t: Started;
beforeAll(async () => {
  t = await harness.startShared();
});

const user = () => ({ id: randomUUID() });
const itemsOf = async (userId: string) =>
  (
    await t.kernel.pool.query<{
      title: string;
      text: string;
      link: string | null;
      template: string;
      read_at: Date | null;
    }>('select * from notify_inbox_item where user_id = $1 order by created_at, id', [userId])
  ).rows;
const deliveriesTo = async (userId: string) =>
  (await t.deliveries()).filter((row) => row.recipient_user_id === userId);

describe('how an inbox item comes to be', () => {
  it('is written in the same transaction as the mail, from the same content', async () => {
    const u = user();
    const id = await t.mail.sendTemplate({
      template: 'fix.hello',
      data: { name: 'Ada' },
      recipient: { address: 'ada@example.org', userId: u.id },
      inApp: true,
    });
    expect((await t.delivery(id)).subject).toBe('Hello Ada');
    const items = await itemsOf(u.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      template: 'fix.hello',
      title: 'Hello Ada', // no heading: the subject
      text: 'Welcome, Ada.',
      link: null,
      read_at: null,
    });
  });

  it('renders in the recipient’s locale', async () => {
    const u = user();
    await t.mail.sendTemplate({
      template: 'fix.hello',
      data: { name: 'Ada' },
      recipient: { address: 'ada@example.org', userId: u.id },
      locale: 'de',
      inApp: true,
    });
    expect((await itemsOf(u.id))[0]).toMatchObject({
      title: 'Hallo Ada',
      text: 'Willkommen, Ada.',
    });
  });

  it('carries the template’s link, as the mail does', async () => {
    const u = user();
    await t.mail.sendTemplate({
      template: 'fix.mandatory',
      data: { link: 'https://example.org/base/somewhere' },
      recipient: { address: 'a@example.org', userId: u.id },
      inApp: true,
    });
    expect((await itemsOf(u.id))[0]!.link).toBe('https://example.org/base/somewhere');
  });

  it('is written alone when the person has no address, and then no delivery exists', async () => {
    const u = user();
    const id = await t.mail.sendTemplateOrNone({
      template: 'fix.hello',
      data: { name: 'Ada' },
      recipient: { userId: u.id },
      inApp: true,
    });
    expect(id).toBeNull();
    expect(await itemsOf(u.id)).toHaveLength(1);
    expect(await deliveriesTo(u.id)).toEqual([]);
  });

  it('is not written unless the caller asks for it', async () => {
    const u = user();
    await t.mail.sendTemplate({
      template: 'fix.hello',
      data: { name: 'Ada' },
      recipient: { address: 'ada@example.org', userId: u.id },
    });
    expect(await itemsOf(u.id)).toEqual([]);
  });

  it('is not written without a user id, whatever the flag says', async () => {
    const before = (await t.kernel.pool.query('select 1 from notify_inbox_item')).rowCount;
    await t.mail.sendTemplate({
      template: 'fix.hello',
      data: { name: 'Ada' },
      recipient: { address: 'nobody@example.org' },
      inApp: true,
    });
    expect((await t.kernel.pool.query('select 1 from notify_inbox_item')).rowCount).toBe(before);
  });

  it('refuses a recipient with neither an address nor a user id, as a bug of the caller', async () => {
    await expect(
      t.mail.sendTemplate({ template: 'fix.hello', data: { name: 'x' }, recipient: {} }),
    ).rejects.toBeInstanceOf(NotificationError);
  });

  it('keeps the data validation: bad data is 422 even if the person would not get the message', async () => {
    const u = user();
    await makePreference(t.kernel.pool, u, PREFERENCES_KEY, {
      test: { email: false, inApp: false },
    });
    await expect(
      t.mail.sendTemplateOrNone({
        template: 'fix.hello',
        data: { name: '' },
        recipient: { address: 'a@example.org', userId: u.id },
        inApp: true,
      }),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('rolls back with the mail: neither a delivery nor an item remains', async () => {
    const u = user();
    await expect(
      t.mail.sendTemplate(
        {
          template: 'fix.hello',
          data: { name: 'Ada' },
          recipient: { address: 'ada@example.org', userId: u.id },
          inApp: true,
        },
        { failAfter: true },
      ),
    ).rejects.toThrow(/failed after/);
    expect(await itemsOf(u.id)).toEqual([]);
    expect(await deliveriesTo(u.id)).toEqual([]);
  });

  it('rolls back an item that is written alone', async () => {
    const u = user();
    await expect(
      t.mail.sendTemplateOrNone(
        { template: 'fix.hello', data: { name: 'Ada' }, recipient: { userId: u.id }, inApp: true },
        { failAfter: true },
      ),
    ).rejects.toThrow(/failed after/);
    expect(await itemsOf(u.id)).toEqual([]);
  });

  it('is refused outside ctx.db.tx(), like the mail', async () => {
    await expect(
      t.mail.templateOutsideTx({
        template: 'fix.hello',
        data: { name: 'x' },
        recipient: { address: 'a@example.org', userId: randomUUID() },
        inApp: true,
      }),
    ).rejects.toBeInstanceOf(NotificationError);
  });
});

describe('preferences', () => {
  const send = (u: { id: string }) =>
    t.mail.sendTemplateOrNone({
      template: 'fix.hello', // category "test"
      data: { name: 'Ada' },
      recipient: { address: `${u.id}@example.org`, userId: u.id },
      inApp: true,
    });

  it('send both by default', async () => {
    const u = user();
    expect(await send(u)).not.toBeNull();
    expect(await itemsOf(u.id)).toHaveLength(1);
  });

  it('email off stops the mail and keeps the item', async () => {
    const u = user();
    await makePreference(t.kernel.pool, u, PREFERENCES_KEY, { test: { email: false } });
    expect(await send(u)).toBeNull();
    expect(await deliveriesTo(u.id)).toEqual([]);
    expect(await itemsOf(u.id)).toHaveLength(1);
  });

  it('in-app off stops the item and keeps the mail', async () => {
    const u = user();
    await makePreference(t.kernel.pool, u, PREFERENCES_KEY, { test: { inApp: false } });
    expect(await send(u)).not.toBeNull();
    expect(await itemsOf(u.id)).toEqual([]);
    expect(await deliveriesTo(u.id)).toHaveLength(1);
  });

  it('both off stores nothing at all, and says so only at debug level with the key', async () => {
    const u = user();
    await makePreference(t.kernel.pool, u, PREFERENCES_KEY, {
      test: { email: false, inApp: false },
    });
    expect(await send(u)).toBeNull();
    expect(await itemsOf(u.id)).toEqual([]);
    expect(await deliveriesTo(u.id)).toEqual([]);
    const logged = t.logs.join('');
    expect(logged).not.toContain(u.id);
    expect(logged).not.toContain('@example.org');
  });

  it('are per category: switching "test" off leaves another category alone', async () => {
    const u = user();
    await makePreference(t.kernel.pool, u, PREFERENCES_KEY, {
      test: { email: false, inApp: false },
    });
    const id = await t.mail.sendTemplateOrNone({
      template: 'fix.partial', // also "test"
      data: { name: 'x' },
      recipient: { address: 'a@example.org', userId: u.id },
    });
    expect(id).toBeNull();
    const other = await t.mail.sendTemplateOrNone({
      template: 'fix.mandatory',
      data: {},
      recipient: { address: 'a@example.org', userId: u.id },
    });
    expect(other).not.toBeNull();
  });

  it('never stop a mandatory template, in the service', async () => {
    const u = user();
    await makePreference(t.kernel.pool, u, PREFERENCES_KEY, {
      safety: { email: false, inApp: false },
    });
    const id = await t.mail.sendTemplateOrNone({
      template: 'fix.mandatory',
      data: {},
      recipient: { address: 'a@example.org', userId: u.id },
      inApp: true,
    });
    expect(id).not.toBeNull();
    expect(await itemsOf(u.id)).toHaveLength(1);
  });

  it('treat a stored value that no longer fits the schema as not set', async () => {
    const u = user();
    await makePreference(t.kernel.pool, u, PREFERENCES_KEY, { test: 'off' });
    expect(await send(u)).not.toBeNull();
  });
});

describe('a sensitive template and the inbox', () => {
  it('writes no item, whatever the flag says, and the token is nowhere once the mail is sent', async () => {
    const u = user();
    const token = `tok-${randomUUID()}`;
    await t.mail.sendTemplate({
      template: 'fix.secret-link',
      data: { link: `https://example.org/reset?token=${token}` },
      recipient: { address: 'ada@example.org', userId: u.id },
      inApp: true,
    });
    expect(await itemsOf(u.id)).toEqual([]);
    // Queued: the body is in the delivery row and in no other table.
    expect(await tablesContaining(t.kernel.pool, token)).toEqual(['notify_delivery']);
    const report = await t.notifications.deliverDue();
    expect(report.sent).toBeGreaterThanOrEqual(1);
    expect(await tablesContaining(t.kernel.pool, token)).toEqual([]);
    expect(t.logs.join('')).not.toContain(token);
  });
});

describe('raw enqueue with an inbox item', () => {
  it('writes the item in the same transaction, cleaned', async () => {
    const u = user();
    await t.mail.send(
      mail({
        recipientUserId: u.id,
        inApp: { title: 'Line\r\nbreak‮', text: 'Body <b>x</b>', link: 'https://example.org/x' },
      }),
    );
    expect((await itemsOf(u.id))[0]).toMatchObject({
      title: 'Line break',
      text: 'Body <b>x</b>',
      link: 'https://example.org/x',
    });
  });

  it('drops a link that is not http(s)', async () => {
    const u = user();
    await t.mail.send(
      mail({ recipientUserId: u.id, inApp: { title: 't', text: '', link: 'ftp://example.org/x' } }),
    );
    expect((await itemsOf(u.id))[0]!.link).toBeNull();
  });

  it('rolls back with the delivery', async () => {
    const u = user();
    await expect(
      t.mail.send(mail({ recipientUserId: u.id, inApp: { title: 't', text: 'x' } }), {
        failAfter: true,
      }),
    ).rejects.toThrow(/failed after/);
    expect(await itemsOf(u.id)).toEqual([]);
  });

  it.each([
    ['without a user id', { inApp: { title: 't', text: 'x' } }],
    [
      'for a sensitive message',
      { recipientUserId: randomUUID(), sensitive: true, inApp: { title: 't', text: 'x' } },
    ],
    [
      'for the webhook',
      {
        channel: 'webhook' as const,
        recipientAddress: undefined,
        recipientUserId: randomUUID(),
        inApp: { title: 't', text: 'x' },
      },
    ],
    ['with an empty title', { recipientUserId: randomUUID(), inApp: { title: '', text: 'x' } }],
    [
      'with a title over 200 characters',
      { recipientUserId: randomUUID(), inApp: { title: 'x'.repeat(201), text: '' } },
    ],
    [
      'with a text over 2000 characters',
      { recipientUserId: randomUUID(), inApp: { title: 't', text: 'x'.repeat(2001) } },
    ],
  ])('is refused %s (422)', async (_name, extra) => {
    await expect(t.mail.send(mail(extra))).rejects.toBeInstanceOf(Invalid);
  });
});

describe('the inbox service serves the caller’s own items', () => {
  it('lists them newest first with the id as the tie-break, in pages, and counts them', async () => {
    const a = await t.actorOf('user');
    const stamp = new Date('2026-01-01T10:00:00Z');
    const made = [];
    for (let i = 0; i < 5; i++) {
      made.push(
        await makeInboxItem(t.kernel.pool, {
          userId: a.userId,
          title: `Item ${i}`,
          // Two items share a time: the id decides.
          createdAt: new Date(stamp.getTime() + Math.floor(i / 2) * 1000),
        }),
      );
    }
    await makeInboxItem(t.kernel.pool, { title: 'Somebody else’s' });
    const first = await t.notifications.inbox.list(a, { page: 0, pageSize: 2 });
    const second = await t.notifications.inbox.list(a, { page: 1, pageSize: 2 });
    const third = await t.notifications.inbox.list(a, { page: 2, pageSize: 2 });
    expect(first.total).toBe(5);
    const expected = [...made]
      .sort(
        (x, y) =>
          y.created_at.getTime() - x.created_at.getTime() ||
          (x.id < y.id ? 1 : x.id > y.id ? -1 : 0),
      )
      .map((row) => row.id);
    expect([...first.items, ...second.items, ...third.items].map((i) => i.id)).toEqual(expected);
    expect(third.items).toHaveLength(1);
    expect(await t.notifications.inbox.unreadCount(a)).toBe(5);
  });

  it('marks one read (and keeps the first read time), then all', async () => {
    const a = await t.actorOf('user');
    const [one, two, three] = [
      await makeInboxItem(t.kernel.pool, { userId: a.userId }),
      await makeInboxItem(t.kernel.pool, { userId: a.userId }),
      await makeInboxItem(t.kernel.pool, { userId: a.userId }),
    ];
    const read = await t.notifications.inbox.markRead(a, one.id);
    expect(read.readAt).toBeInstanceOf(Date);
    expect(await t.notifications.inbox.unreadCount(a)).toBe(2);
    const again = await t.notifications.inbox.markRead(a, one.id);
    expect(again.readAt).toEqual(read.readAt);
    expect(await t.notifications.inbox.markAllRead(a)).toBe(2);
    expect(await t.notifications.inbox.unreadCount(a)).toBe(0);
    expect(await t.notifications.inbox.markAllRead(a)).toBe(0);
    void two;
    void three;
  });

  it('deletes one item', async () => {
    const a = await t.actorOf('user');
    const item = await makeInboxItem(t.kernel.pool, { userId: a.userId });
    await t.notifications.inbox.remove(a, item.id);
    expect((await t.notifications.inbox.list(a, { page: 0, pageSize: 10 })).total).toBe(0);
  });

  it('answers 403 for another user’s item and for an id that does not exist, and changes nothing [ASVS-8.2.2]', async () => {
    const a = await t.actorOf('user');
    const b = await t.actorOf('user');
    const theirs = await makeInboxItem(t.kernel.pool, { userId: b.userId });
    for (const id of [theirs.id, randomUUID(), 'not-a-uuid']) {
      await expect(t.notifications.inbox.markRead(a, id)).rejects.toBeInstanceOf(Forbidden);
      await expect(t.notifications.inbox.remove(a, id)).rejects.toBeInstanceOf(Forbidden);
    }
    const after = (
      await t.kernel.pool.query('select read_at from notify_inbox_item where id = $1', [theirs.id])
    ).rows;
    expect(after).toEqual([{ read_at: null }]);
    expect(await t.notifications.inbox.unreadCount(b)).toBe(1);
  });

  it('does not let mark-all-read touch other people’s items', async () => {
    const a = await t.actorOf('user');
    const b = await t.actorOf('user');
    await makeInboxItem(t.kernel.pool, { userId: b.userId });
    await t.notifications.inbox.markAllRead(a);
    expect(await t.notifications.inbox.unreadCount(b)).toBe(1);
  });

  it('needs the permissions: a user with no role is denied every method', async () => {
    const nobody = await t.actorOf();
    const item = await makeInboxItem(t.kernel.pool, { userId: nobody.userId });
    const page = { page: 0, pageSize: 10 };
    for (const call of [
      () => t.notifications.inbox.list(nobody, page),
      () => t.notifications.inbox.unreadCount(nobody),
      () => t.notifications.inbox.markRead(nobody, item.id),
      () => t.notifications.inbox.markAllRead(nobody),
      () => t.notifications.inbox.remove(nobody, item.id),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(Forbidden);
    }
    expect((await itemsOf(nobody.userId))[0]!.read_at).toBeNull();
  });

  it('is for signed-in users: a system actor has no inbox', async () => {
    const admin = await t.actorOf('admin');
    const system = { ...admin, kind: 'system' } as never;
    await expect(t.notifications.inbox.list(system, { page: 0, pageSize: 1 })).rejects.toThrow();
  });
});

describe('the purge of an account', () => {
  it('removes every item of the user, in the caller’s transaction, and none of the others', async () => {
    const gone = user();
    const kept = user();
    await makeInboxItem(t.kernel.pool, { userId: gone.id });
    await makeInboxItem(t.kernel.pool, { userId: gone.id, readAt: new Date() });
    await makeInboxItem(t.kernel.pool, { userId: kept.id });
    const removed = await t.kernel.db.tx((tx) => t.notifications.removeInboxOfUser(tx, gone.id));
    expect(removed).toBe(2);
    expect(await itemsOf(gone.id)).toEqual([]);
    expect(await itemsOf(kept.id)).toHaveLength(1);
  });

  it('rolls back with the caller’s transaction', async () => {
    const u = user();
    await makeInboxItem(t.kernel.pool, { userId: u.id });
    await expect(
      t.kernel.db.tx(async (tx) => {
        await t.notifications.removeInboxOfUser(tx, u.id);
        throw new Error('the purge failed');
      }),
    ).rejects.toThrow(/purge failed/);
    expect(await itemsOf(u.id)).toHaveLength(1);
  });

  it('ignores an id that is not a UUID', async () => {
    expect(await t.kernel.db.tx((tx) => t.notifications.removeInboxOfUser(tx, 'x'))).toBe(0);
  });
});
