// "Never log an address, subject, body, SMTP URL, password or signing secret" (CLAUDE.md, ADR 0012,
// 0019). This runs sends that succeed, retry and die, an SMTP sign-in, a refused webhook and a
// sensitive mail, with the logger at trace level, and greps the captured log stream and the rows.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startSmtpServer, type TestSmtpServer } from '@scorpion/testing';
import { mail, useNotifications } from '../test/harness.ts';

const harness = useNotifications();
const relays: TestSmtpServer[] = [];
let hook: http.Server | undefined;
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.stop().catch(() => undefined);
  hook?.closeAllConnections();
  await new Promise<void>((resolve) => (hook ? hook.close(() => resolve()) : resolve()));
  hook = undefined;
});

const SECRETS = {
  smtpPassword: 'S3cretRelayPassw0rd-xyz',
  signingSecret: 'S1gningSecret-abc-123',
  token: 'srt_SensitiveResetToken_0123456789',
};
const ADDRESSES = [
  'ada.lovelace@example.org',
  'charles.babbage@example.org',
  'grace.hopper@example.org',
];
const SUBJECTS = [
  'Please reset your password now',
  'A very private subject line',
  'Hook subject line',
];
const BODIES = ['Plain body that must not be logged', 'Hook body that must not be logged'];

describe('what the module writes to the log', () => {
  it('holds no address, subject, body, password, signing secret or token, and no row holds an error message', async () => {
    const smtp = await startSmtpServer();
    relays.push(smtp);
    hook = http.createServer((_request, response) => response.writeHead(500).end());
    await new Promise<void>((resolve) => hook!.listen(0, '127.0.0.1', resolve));
    const hookPort = (hook.address() as AddressInfo).port;

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
        webhook: {
          enabled: true,
          url: `http://127.0.0.1:${hookPort}/hook?key=urlkey123`,
          allowPrivateTargets: true,
        },
        maxAttempts: 2,
      },
      secrets: {
        'notifications.smtp.password': SECRETS.smtpPassword,
        'notifications.webhook.secret': SECRETS.signingSecret,
      },
    });

    // sent
    await t.mail.send(
      mail({
        recipientAddress: ADDRESSES[0],
        subject: SUBJECTS[0],
        text: `Open ${SECRETS.token}`,
        sensitive: true,
      }),
    );
    await t.notifications.deliverDue();
    // retried and dead: the relay goes away
    await smtp.stop();
    await t.mail.send(
      mail({
        recipientAddress: ADDRESSES[1],
        subject: SUBJECTS[1],
        text: BODIES[0],
        sensitive: true,
      }),
    );
    await t.notifications.deliverDue();
    await t.makeDue();
    await t.notifications.deliverDue();
    // a webhook that fails
    await t.mail.send(
      mail({
        channel: 'webhook',
        recipientAddress: undefined,
        subject: SUBJECTS[2],
        text: BODIES[1],
      }),
    );
    await t.notifications.deliverDue();
    await t.notifications.deliverDue();

    // validation failures must not echo what was sent either
    await t.mail
      .send(mail({ recipientAddress: ADDRESSES[2], subject: 'bad\nsubject' }))
      .catch(() => undefined);

    const stream = t.logs.join('\n');
    // the capture works: the lines we expect are there
    expect(stream).toContain('a delivery failed for the last time and is dead');
    expect(stream).toContain('a delivery failed and will be tried again');
    expect(stream).toContain('deliveryId');

    const forbidden = [
      ...Object.values(SECRETS),
      ...ADDRESSES,
      ...SUBJECTS,
      ...BODIES,
      'urlkey123', // the webhook URL can carry a key
      t.secretsKey,
      'example.org',
    ];
    for (const value of forbidden) expect(stream, `the log holds "${value}"`).not.toContain(value);

    // the table: error columns hold codes, never messages; a finished sensitive row holds no body
    const rows = await t.deliveries();
    for (const row of rows) {
      if (row.last_error !== null) expect(row.last_error).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
      if (row.sensitive && (row.status === 'sent' || row.status === 'dead')) {
        expect([row.text_body, row.html_body]).toEqual([null, null]);
      }
    }
    expect(JSON.stringify(rows)).not.toContain(SECRETS.token);
    expect(JSON.stringify(rows)).not.toContain(SECRETS.smtpPassword);
    expect(JSON.stringify(rows)).not.toContain(SECRETS.signingSecret);
  });
});
