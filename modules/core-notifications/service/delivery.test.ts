import { makeDelivery } from '@scorpion/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSmtpServer, type TestSmtpServer } from '../test/smtp-server.ts';
import { mail, useNotifications, type Started } from '../test/harness.ts';
import { backoffSeconds } from './backoff.ts';
import { claimDue, markSent } from './delivery.ts';

const harness = useNotifications();

const relays: TestSmtpServer[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.stop().catch(() => undefined);
});

/** A running relay and a kernel that sends through it. */
async function withRelay(settings: Record<string, unknown> = {}, secrets?: Record<string, string>) {
  const smtp = await startSmtpServer();
  relays.push(smtp);
  const t = await harness.start({
    settings: {
      emailTransport: 'smtp',
      smtp: { host: '127.0.0.1', port: smtp.port, tls: 'none', timeoutSeconds: 2 },
      ...settings,
    },
    secrets,
  });
  return { smtp, t };
}

const secondsUntilDue = async (t: Started, id: string) =>
  Number(
    (
      await t.kernel.pool.query<{ s: number }>(
        'select extract(epoch from next_attempt_at - now())::float as s from notify_delivery where id = $1',
        [id],
      )
    ).rows[0]!.s,
  );

describe('delivery through a relay', () => {
  it('sends a committed message once and marks it sent', async () => {
    const { smtp, t } = await withRelay();
    const id = await t.mail.send(
      mail({
        recipientAddress: 'ada@example.org',
        subject: 'Hello Ada',
        text: 'Plain body',
        html: '<p>Html body</p>',
      }),
    );
    const report = await t.notifications.deliverDue();
    expect(report).toEqual({ claimed: 1, sent: 1, retried: 0, dead: 0, lost: 0 });
    expect(smtp.received).toHaveLength(1);
    expect(smtp.received[0]).toMatchObject({ from: 'no-reply@localhost', to: ['ada@example.org'] });
    expect(smtp.received[0]!.data).toContain('Subject: Hello Ada');
    expect(smtp.received[0]!.data).toContain('Plain body');
    expect(smtp.received[0]!.data).toContain('Html body');
    const row = await t.delivery(id!);
    expect(row).toMatchObject({
      status: 'sent',
      attempts: 1,
      transport: 'smtp',
      locked_until: null,
    });
    expect(row.sent_at).toBeInstanceOf(Date);
    // nothing is left to do
    expect((await t.notifications.deliverDue()).claimed).toBe(0);
    expect(smtp.received).toHaveLength(1);
  });

  it('uses the sender address of the branding settings', async () => {
    const { smtp, t } = await withRelay();
    await t.kernel.pool.query(
      `insert into settings_setting (module_id, value) values ('core.settings', '{"branding":{"mailFrom":"office@example.org"}}')
       on conflict (module_id) do update set value = excluded.value`,
    );
    // a fresh kernel reads it (the store caches for 5 s)
    const second = await harness.start({ databaseUrl: t.databaseUrl, secretsKey: t.secretsKey });
    await second.mail.send(mail());
    await second.notifications.deliverDue();
    expect(smtp.received[0]!.from).toBe('office@example.org');
  });

  it('reads the SMTP password from the secrets store and sends it to the relay', async () => {
    const smtp = await startSmtpServer();
    relays.push(smtp);
    const t = await harness.start({
      settings: {
        emailTransport: 'smtp',
        smtp: {
          host: '127.0.0.1',
          port: smtp.port,
          tls: 'none',
          user: 'mailer',
          timeoutSeconds: 2,
        },
      },
      secrets: { 'notifications.smtp.password': 'relay-pass-1' },
    });
    await t.mail.send(mail());
    expect((await t.notifications.deliverDue()).sent).toBe(1);
    expect(smtp.credentials).toEqual([{ user: 'mailer', password: 'relay-pass-1' }]);
  });

  it('retries with not-configured when a user is set but the password secret is missing', async () => {
    const smtp = await startSmtpServer();
    relays.push(smtp);
    const t = await harness.start({
      settings: {
        emailTransport: 'smtp',
        smtp: { host: '127.0.0.1', port: smtp.port, tls: 'none', user: 'mailer' },
      },
    });
    const id = await t.mail.send(mail());
    expect((await t.notifications.deliverDue()).retried).toBe(1);
    expect(await t.delivery(id!)).toMatchObject({ status: 'queued', last_error: 'not-configured' });
    expect(smtp.received).toEqual([]);
  });
});

describe('the transport none', () => {
  it('records the message as sent with transport none, and says so in the status', async () => {
    const t = await harness.start();
    const id = await t.mail.send(mail({ sensitive: true, text: 'a link nobody gets' }));
    expect(await t.notifications.deliverDue()).toMatchObject({ claimed: 1, sent: 1 });
    expect(await t.delivery(id!)).toMatchObject({
      status: 'sent',
      transport: 'none',
      text_body: null, // sensitive: scrubbed even though nothing was sent
    });
    const status = await t.notifications.status(await t.actorOf('admin'));
    expect(status).toMatchObject({ transportIsNone: true, counts: { sent: 1 } });
  });
});

describe('two workers', () => {
  it('deliver every committed message exactly once when they race', async () => {
    const { smtp, t } = await withRelay();
    const other = await harness.start({ databaseUrl: t.databaseUrl, secretsKey: t.secretsKey });
    const messages = Array.from({ length: 40 }, (_, i) =>
      mail({ recipientAddress: `p${i}@example.org` }),
    );
    await t.mail.sendAll(messages);
    const reports = await Promise.all([
      t.notifications.deliverDue(),
      other.notifications.deliverDue(),
      t.notifications.deliverDue(),
      other.notifications.deliverDue(),
    ]);
    expect(reports.reduce((sum, r) => sum + r.sent, 0)).toBe(40);
    expect(reports.reduce((sum, r) => sum + r.lost, 0)).toBe(0);
    expect(smtp.received).toHaveLength(40);
    expect(new Set(smtp.received.map((m) => m.to[0])).size).toBe(40);
    const rows = await t.deliveries();
    expect(rows.every((row) => row.status === 'sent' && row.attempts === 1)).toBe(true);
  });
});

describe('a relay that is down', () => {
  it('keeps rows queued with growing attempts on the backoff schedule, then they are dead', async () => {
    const { smtp, t } = await withRelay();
    await smtp.stop();
    const first = await t.mail.send(mail());
    const second = await t.mail.send(mail());
    const ids = [first!, second!];

    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const report = await t.notifications.deliverDue();
      expect(report).toMatchObject({ claimed: 2, retried: 2, sent: 0, dead: 0 });
      for (const id of ids) {
        const row = await t.delivery(id);
        expect(row).toMatchObject({
          status: 'queued',
          attempts: attempt,
          last_error: 'ESOCKET',
          transport: 'smtp',
        });
        expect(row.locked_until).toBeNull();
        expect(await secondsUntilDue(t, id)).toBeCloseTo(backoffSeconds(attempt), -1);
      }
      // not due yet: another pass touches nothing
      expect((await t.notifications.deliverDue()).claimed).toBe(0);
      await t.makeDue();
    }
    const last = await t.notifications.deliverDue();
    expect(last).toMatchObject({ claimed: 2, dead: 2, retried: 0 });
    for (const id of ids) {
      expect(await t.delivery(id)).toMatchObject({
        status: 'dead',
        attempts: 8,
        last_error: 'ESOCKET',
      });
    }
    await t.makeDue();
    expect((await t.notifications.deliverDue()).claimed).toBe(0);
    expect(smtp.received).toEqual([]);
  });

  it('honours the maxAttempts setting', async () => {
    const { smtp, t } = await withRelay({ maxAttempts: 2 });
    await smtp.stop();
    const id = await t.mail.send(mail());
    await t.notifications.deliverDue();
    await t.makeDue();
    expect((await t.notifications.deliverDue()).dead).toBe(1);
    expect(await t.delivery(id!)).toMatchObject({ status: 'dead', attempts: 2 });
  });

  it('delivers the queued mail when the relay returns, together with newer mail', async () => {
    const { smtp, t } = await withRelay();
    await smtp.stop();
    const old = await t.mail.send(mail({ recipientAddress: 'old@example.org' }));
    await t.notifications.deliverDue();
    expect((await t.delivery(old!)).status).toBe('queued');
    await smtp.restart();
    const fresh = await t.mail.send(mail({ recipientAddress: 'fresh@example.org' }));
    await t.makeDue();
    expect(await t.notifications.deliverDue()).toMatchObject({ claimed: 2, sent: 2 });
    expect(smtp.received.map((m) => m.to[0]).sort()).toEqual([
      'fresh@example.org',
      'old@example.org',
    ]);
    expect(await t.delivery(old!)).toMatchObject({
      status: 'sent',
      attempts: 2,
      last_error: 'ESOCKET',
    });
    expect(await t.delivery(fresh!)).toMatchObject({
      status: 'sent',
      attempts: 1,
      last_error: null,
    });
  });

  it('shows the failures in the status without an address', async () => {
    const { smtp, t } = await withRelay();
    await smtp.stop();
    await t.mail.sendAll([
      mail({ recipientAddress: 'one@example.org' }),
      mail({ recipientAddress: 'two@example.org' }),
    ]);
    await t.notifications.deliverDue();
    const status = await t.notifications.status(await t.actorOf('admin'));
    expect(status).toMatchObject({
      transportIsNone: false,
      emailTransport: 'smtp',
      counts: { queued: 2, sending: 0, sent: 0, dead: 0 },
    });
    expect(status.lastErrors).toHaveLength(1);
    expect(status.lastErrors[0]).toMatchObject({ code: 'ESOCKET', count: 2 });
    expect(JSON.stringify(status)).not.toMatch(/example\.org/);
  });

  it('never lets a failing row block the others', async () => {
    // The webhook is on and its secret exists, so the transport builds and the target check
    // (a loopback address) is what fails.
    const { smtp, t } = await withRelay(
      { webhook: { enabled: true, url: 'https://127.0.0.1/hook' } },
      { 'notifications.webhook.secret': 'hook-secret' },
    );
    await t.mail.sendAll([mail(), mail(), mail()]);
    const bad = await makeDelivery(t.kernel.pool, { channel: 'webhook', subject: 'to the hook' });
    const report = await t.notifications.deliverDue();
    expect(report).toMatchObject({ claimed: 4, sent: 3, retried: 1 });
    expect(smtp.received).toHaveLength(3);
    expect(await t.delivery(bad.id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error: 'target-refused',
    });
  });
});

describe('a sensitive body', () => {
  it('is kept while the message waits and is gone once it is sent', async () => {
    const { smtp, t } = await withRelay();
    await smtp.stop();
    const link = 'https://example.org/reset-password#token=srt_SECRETTOKEN';
    const secret = await t.mail.send(
      mail({ sensitive: true, text: `Open ${link}`, html: `<a href="${link}">reset</a>` }),
    );
    const plain = await t.mail.send(mail({ text: 'Not a secret', html: '<p>Not a secret</p>' }));
    await t.notifications.deliverDue();
    expect(await t.delivery(secret!)).toMatchObject({
      status: 'queued',
      text_body: `Open ${link}`,
    }); // still needed for the retry
    await smtp.restart();
    await t.makeDue();
    await t.notifications.deliverDue();
    expect(smtp.received.some((m) => m.data.includes('srt_SECRETTOKEN'))).toBe(true);
    expect(await t.delivery(secret!)).toMatchObject({
      status: 'sent',
      text_body: null,
      html_body: null,
    });
    expect(await t.delivery(plain!)).toMatchObject({
      status: 'sent',
      text_body: 'Not a secret',
      html_body: '<p>Not a secret</p>',
    });
  });

  it('is gone when the message is dead', async () => {
    const { smtp, t } = await withRelay({ maxAttempts: 1 });
    await smtp.stop();
    const id = await t.mail.send(
      mail({
        sensitive: true,
        text: 'srt_DEADTOKEN',
        html: '<p>srt_DEADTOKEN</p>',
        subject: 'Reset your password',
      }),
    );
    await t.notifications.deliverDue();
    const row = await t.delivery(id!);
    expect(row).toMatchObject({
      status: 'dead',
      text_body: null,
      html_body: null,
      last_error: 'ESOCKET',
    });
    expect(row.subject).toBe('Reset your password');
    const everything = await t.kernel.pool.query('select * from notify_delivery');
    expect(JSON.stringify(everything.rows)).not.toContain('srt_DEADTOKEN');
  });
});

describe('leases', () => {
  it('leaves a row alone while another worker holds a valid lease', async () => {
    const { smtp, t } = await withRelay();
    const row = await makeDelivery(t.kernel.pool, {
      status: 'sending',
      attempts: 1,
      lockedUntil: new Date(Date.now() + 120_000),
    });
    expect((await t.notifications.deliverDue()).claimed).toBe(0);
    expect(await t.delivery(row.id)).toMatchObject({ status: 'sending', attempts: 1 });
    expect(smtp.received).toEqual([]);
  });

  it('takes a row over when the lease ran out, counting a new attempt', async () => {
    const { smtp, t } = await withRelay();
    const row = await makeDelivery(t.kernel.pool, {
      status: 'sending',
      attempts: 1,
      lockedUntil: new Date(Date.now() - 1000),
    });
    expect(await t.notifications.deliverDue()).toMatchObject({ claimed: 1, sent: 1 });
    expect(await t.delivery(row.id)).toMatchObject({ status: 'sent', attempts: 2 });
    expect(smtp.received).toHaveLength(1);
  });

  it('does not send again once a crashed worker used up the last attempt', async () => {
    const { smtp, t } = await withRelay({ maxAttempts: 3 });
    const row = await makeDelivery(t.kernel.pool, {
      status: 'sending',
      attempts: 3,
      sensitive: true,
      textBody: 'srt_CRASHTOKEN',
      lockedUntil: new Date(Date.now() - 1000),
    });
    expect(await t.notifications.deliverDue()).toMatchObject({ claimed: 1, dead: 1, sent: 0 });
    expect(await t.delivery(row.id)).toMatchObject({
      status: 'dead',
      attempts: 4,
      last_error: 'attempts-exhausted',
      text_body: null,
    });
    expect(smtp.received).toEqual([]);
  });

  it('writes nothing for a worker whose lease was taken over', async () => {
    const t = await harness.start();
    const row = await makeDelivery(t.kernel.pool, {
      status: 'sending',
      attempts: 1,
      lockedUntil: new Date(Date.now() - 1000),
    });
    const [stale] = [{ ...(await claimDue(t.kernel.db, 1))[0]!, attempts: 1 }]; // the first worker's view
    // the second worker claimed it (attempts 2); the first one finishes late and must not win
    expect(await markSent(t.kernel.db, stale, 'none')).toBe(false);
    expect(await t.delivery(row.id)).toMatchObject({
      status: 'sending',
      attempts: 2,
      sent_at: null,
    });
    expect(await markSent(t.kernel.db, { ...stale, attempts: 2 }, 'none')).toBe(true);
    expect(await t.delivery(row.id)).toMatchObject({ status: 'sent' });
  });
});

describe('the job path', () => {
  it('delivers a committed message through the wake-up and the delivery job, and nothing for a rollback', async () => {
    const { smtp, t } = await withRelay();
    // Workers start after the settings are in place; the kernel of `withRelay` ran none, so start another over the same database.
    const worker = await harness.start({
      databaseUrl: t.databaseUrl,
      secretsKey: t.secretsKey,
      startWorkers: true,
    });
    await worker.mail.send(mail(), { failAfter: true }).catch(() => undefined);
    const id = await worker.mail.send(mail({ recipientAddress: 'job@example.org' }));
    await vi.waitFor(async () => expect((await worker.delivery(id!)).status).toBe('sent'), {
      timeout: 30_000,
      interval: 250,
    });
    expect(smtp.received.map((m) => m.to[0])).toEqual(['job@example.org']);
    expect(await worker.deliveries()).toHaveLength(1);
  }, 45_000);
});
