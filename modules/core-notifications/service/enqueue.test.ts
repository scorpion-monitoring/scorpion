import { Forbidden, Invalid, Unauthorized } from '@scorpion/contracts';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { mail, useNotifications } from '../test/harness.ts';
import { NotificationError } from './notifications.ts';

const harness = useNotifications();

describe('enqueue', () => {
  it('stores a queued row when the caller commits, and returns its id', async () => {
    const t = await harness.start();
    const id = await t.mail.send(
      mail({
        recipientAddress: 'ada@example.org',
        subject: 'Hello',
        text: 'Hi Ada',
        html: '<p>Hi</p>',
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = await t.delivery(id!);
    expect(row).toMatchObject({
      template: 'test.message',
      channel: 'email',
      recipient_address: 'ada@example.org',
      recipient_user_id: null,
      locale: 'en', // the setting defaultLocale
      subject: 'Hello',
      text_body: 'Hi Ada',
      html_body: '<p>Hi</p>',
      sensitive: false,
      status: 'queued',
      attempts: 0,
      locked_until: null,
      last_error: null,
      sent_at: null,
      transport: null,
    });
    expect(row.next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('keeps an opaque recipient user id with no foreign key, and a given locale', async () => {
    const t = await harness.start();
    const userId = '0195b3f0-0000-7000-8000-0000000000aa';
    const id = await t.mail.send(mail({ recipientUserId: userId, locale: 'de' }));
    expect(await t.delivery(id!)).toMatchObject({ recipient_user_id: userId, locale: 'de' });
  });

  it('takes the default locale from the settings', async () => {
    const t = await harness.start({ settings: { defaultLocale: 'de' } });
    const id = await t.mail.send(mail());
    expect((await t.delivery(id!)).locale).toBe('de');
  });

  it('leaves no row when the caller rolls back, and nothing to deliver', async () => {
    const t = await harness.start();
    await expect(t.mail.send(mail(), { failAfter: true })).rejects.toThrow(/failed after/);
    expect(await t.deliveries()).toEqual([]);
    const report = await t.notifications.deliverDue();
    expect(report.claimed).toBe(0);
  });

  it('rolls back every message of a transaction together (multi-row write)', async () => {
    const t = await harness.start();
    await expect(t.mail.sendAll([mail(), mail(), mail()], { failAfter: true })).rejects.toThrow(
      /failed after/,
    );
    expect(await t.deliveries()).toEqual([]);
    const ids = await t.mail.sendAll([mail(), mail(), mail()]);
    expect(ids).toHaveLength(3);
    expect(await t.deliveries()).toHaveLength(3);
  });

  it('throws outside ctx.db.tx(), also with a transaction that is not the kernel’s', async () => {
    const t = await harness.start();
    await expect(t.mail.outsideTx(mail())).rejects.toBeInstanceOf(NotificationError);
    await expect(t.mail.outsideTx(mail())).rejects.toThrow(/inside ctx\.db\.tx\(\)/);
    expect(await t.deliveries()).toEqual([]);
  });

  describe('wake-up (pg_notify)', () => {
    async function listener(url: string) {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      await client.query('listen notify_delivery');
      const heard: string[] = [];
      client.on('notification', (message) => heard.push(message.payload ?? ''));
      return { heard, end: () => client.end() };
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

    it('notifies on commit with the id only, and not on rollback', async () => {
      const t = await harness.start();
      const { heard, end } = await listener(t.databaseUrl);
      try {
        await t.mail.send(mail(), { failAfter: true }).catch(() => undefined);
        await settle();
        expect(heard).toEqual([]);
        const id = await t.mail.send(mail({ recipientAddress: 'secret-person@example.org' }));
        await settle();
        expect(heard).toEqual([id]);
      } finally {
        await end();
      }
    });
  });

  describe('validation', () => {
    const long = (n: number) => 'x'.repeat(n);
    const bad: [string, Record<string, unknown>, string][] = [
      ['an address that is not one', { recipientAddress: 'not-an-address' }, 'recipientAddress'],
      [
        'an address with a header injection',
        { recipientAddress: 'a@example.org\r\nBcc: b@example.org' },
        'recipientAddress',
      ],
      ['an address list', { recipientAddress: 'a@example.org,b@example.org' }, 'recipientAddress'],
      ['no address on the email channel', { recipientAddress: undefined }, 'recipientAddress'],
      [
        'an address longer than 254',
        { recipientAddress: `${long(250)}@example.org` },
        'recipientAddress',
      ],
      ['a subject with a line break', { subject: 'Hi\r\nBcc: x@example.org' }, 'subject'],
      ['a subject with a control character', { subject: 'Hi\u0007' }, 'subject'],
      ['an empty subject', { subject: '' }, 'subject'],
      ['a subject longer than 300', { subject: long(301) }, 'subject'],
      ['a text longer than 100000', { text: long(100_001) }, 'text'],
      ['an html part longer than 300000', { html: long(300_001) }, 'html'],
      ['an empty text', { text: '' }, 'text'],
      ['a template key that is not a key', { template: 'Welcome Mail' }, 'template'],
      ['a template with no dot', { template: 'welcome' }, 'template'],
      ['a locale that is not a tag', { locale: 'English' }, 'locale'],
      ['a user id that is not a uuid', { recipientUserId: 'ada' }, 'recipientUserId'],
      ['a field nobody knows', { cc: 'x@example.org' }, ''],
      [
        'a sensitive message on the webhook',
        { channel: 'webhook', sensitive: true, recipientAddress: undefined },
        'sensitive',
      ],
    ];
    it.each(bad)(
      'rejects %s with 422 and names the field, never the value',
      async (_label, override, path) => {
        const t = await harness.start();
        const error = await t.mail.send(mail(override as never)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Invalid);
        const body = JSON.stringify((error as Invalid).errors) + (error as Invalid).message;
        if (path) expect(body).toContain(path);
        for (const key of ['recipientAddress', 'subject', 'text']) {
          const value = override[key];
          if (typeof value === 'string' && value.length > 5 && value.length < 100)
            expect(body).not.toContain(value);
        }
        expect(await t.deliveries()).toEqual([]);
      },
    );

    it('accepts the largest sizes the limits allow', async () => {
      const t = await harness.start();
      const id = await t.mail.send(
        mail({ subject: long(300), text: long(100_000), html: long(300_000) }),
      );
      expect(id).not.toBeNull();
    });

    it('does not enqueue a webhook message while the webhook is off', async () => {
      const t = await harness.start();
      const id = await t.mail.send(mail({ channel: 'webhook', recipientAddress: undefined }));
      expect(id).toBeNull();
      expect(await t.deliveries()).toEqual([]);
    });

    it('queues a webhook message without an address when the webhook is on', async () => {
      const t = await harness.start({
        settings: { webhook: { enabled: true, url: 'https://hooks.example.org/in' } },
      });
      const id = await t.mail.send(
        mail({ channel: 'webhook', recipientAddress: 'ignored@example.org' }),
      );
      expect(await t.delivery(id!)).toMatchObject({ channel: 'webhook', recipient_address: null });
    });
  });
});

describe('status', () => {
  it('is denied to anonymous (401) and to a user without the permission (403)', async () => {
    const t = await harness.start();
    await expect(
      t.notifications.status({ kind: 'anonymous', roles: [] } as never),
    ).rejects.toBeInstanceOf(Unauthorized);
    const plain = await t.actorOf('user');
    await expect(t.notifications.status(plain)).rejects.toBeInstanceOf(Forbidden);
    const reviewer = await t.actorOf('reviewer');
    await expect(t.notifications.status(reviewer)).rejects.toBeInstanceOf(Forbidden);
  });

  it('shows an administrator the counts, that email goes nowhere, and no address', async () => {
    const t = await harness.start();
    await t.mail.send(mail({ recipientAddress: 'ada@example.org', subject: 'A private subject' }));
    const admin = await t.actorOf('admin');
    const status = await t.notifications.status(admin);
    expect(status).toEqual({
      emailTransport: 'none',
      transportIsNone: true,
      webhookEnabled: false,
      counts: { queued: 1, sending: 0, sent: 0, dead: 0 },
      lastErrors: [],
    });
    expect(JSON.stringify(status)).not.toContain('ada@example.org');
  });

  it('is denied to a token whose scopes do not name the permission', async () => {
    const t = await harness.start();
    const admin = await t.actorOf('admin');
    const token = { ...admin, via: 'token' as const, scopes: ['core.settings.read'] };
    await expect(t.notifications.status(token as never)).rejects.toBeInstanceOf(Forbidden);
    const scoped = { ...admin, via: 'token' as const, scopes: ['core.notifications.status.read'] };
    await expect(t.notifications.status(scoped as never)).resolves.toBeDefined();
  });
});
