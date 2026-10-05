// A change of the transport settings or of a notification secret reaches another process within the
// settings port's 5 s TTL (ADR 0017, 0020), and the process that hears the event rebuilds at once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSecret, startSmtpServer, type TestSmtpServer } from '@scorpion/testing';
import { mail, useNotifications } from '../test/harness.ts';

const harness = useNotifications();
const TTL = 5_000;

const relays: TestSmtpServer[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.stop().catch(() => undefined);
});
const relay = async () => {
  const server = await startSmtpServer();
  relays.push(server);
  return server;
};
const smtpSettings = (server: TestSmtpServer, user = '') => ({
  emailTransport: 'smtp',
  smtp: { host: '127.0.0.1', port: server.port, tls: 'none', user, timeoutSeconds: 2 },
});

describe('a transport change in another process', () => {
  it('reaches a second kernel over the same database within the TTL, and not sooner than the cache allows', async () => {
    const first = await relay();
    const second = await relay();
    const clock = { now: 1_000_000 };
    const tuning = {
      settingsModule: { cacheTtlMs: TTL, now: () => clock.now },
      notifications: { transportTtlMs: TTL, now: () => clock.now },
    };
    const a = await harness.start({ ...tuning, settings: smtpSettings(first) });
    const b = await harness.start({
      ...tuning,
      databaseUrl: a.databaseUrl,
      secretsKey: a.secretsKey,
    });

    await b.mail.send(mail({ recipientAddress: 'one@example.org' }));
    await b.notifications.deliverDue();
    expect(first.received.map((m) => m.to[0])).toEqual(['one@example.org']);

    // Another process (A's side of the world) points the instance at the second relay.
    await a.kernel.pool.query(
      `update settings_setting set value = $1::jsonb, version = version + 1 where module_id = 'core.notifications'`,
      [JSON.stringify(smtpSettings(second))],
    );

    clock.now += TTL - 1; // still inside the bound: B may use what it has
    await b.mail.send(mail({ recipientAddress: 'two@example.org' }));
    await b.notifications.deliverDue();
    expect(first.received.map((m) => m.to[0])).toEqual(['one@example.org', 'two@example.org']);
    expect(second.received).toEqual([]);

    clock.now += 2; // past the TTL
    await b.mail.send(mail({ recipientAddress: 'three@example.org' }));
    await b.notifications.deliverDue();
    expect(second.received.map((m) => m.to[0])).toEqual(['three@example.org']);
    expect(first.received).toHaveLength(2);
  });

  it('picks up a rotated SMTP password within the TTL', async () => {
    const server = await relay();
    const clock = { now: 1_000_000 };
    const tuning = {
      settingsModule: { cacheTtlMs: TTL, now: () => clock.now },
      notifications: { transportTtlMs: TTL, now: () => clock.now },
    };
    const a = await harness.start({
      ...tuning,
      settings: smtpSettings(server, 'mailer'),
      secrets: { 'notifications.smtp.password': 'old-password' },
    });
    const b = await harness.start({
      ...tuning,
      databaseUrl: a.databaseUrl,
      secretsKey: a.secretsKey,
    });
    await b.mail.send(mail());
    await b.notifications.deliverDue();
    expect(server.credentials.at(-1)).toEqual({ user: 'mailer', password: 'old-password' });

    await a.kernel.pool.query(
      `delete from settings_secret where name = 'notifications.smtp.password'`,
    );
    await makeSecret(a.kernel.pool, {
      name: 'notifications.smtp.password',
      value: 'new-password',
      key: a.secretsKey,
    });

    clock.now += TTL - 1;
    await b.mail.send(mail());
    await b.notifications.deliverDue();
    expect(server.credentials.at(-1)?.password).toBe('old-password');

    clock.now += 2;
    await b.mail.send(mail());
    await b.notifications.deliverDue();
    expect(server.credentials.at(-1)?.password).toBe('new-password');
  });

  it('is rebuilt at once in the process that hears settings.secret.changed@1', async () => {
    const server = await relay();
    const clock = { now: 1_000_000 }; // frozen: only the event can explain a change
    const t = await harness.start({
      settingsModule: { cacheTtlMs: TTL, now: () => clock.now },
      notifications: { transportTtlMs: TTL, now: () => clock.now },
      settings: smtpSettings(server, 'mailer'),
      secrets: { 'notifications.smtp.password': 'first' },
      startWorkers: true, // the event dispatcher delivers the event to the handler
    });
    await t.mail.send(mail());
    await t.notifications.deliverDue();
    await vi.waitFor(() => expect(server.credentials.at(-1)?.password).toBe('first'), {
      timeout: 10_000,
    });

    const settings = t.kernel.services.get('core.settings') as {
      secrets: { setAsSystem(name: string, value: string): Promise<unknown> };
    };
    await settings.secrets.setAsSystem('notifications.smtp.password', 'second');
    await vi.waitFor(
      async () => {
        await t.mail.send(mail());
        await t.notifications.deliverDue();
        expect(server.credentials.at(-1)?.password).toBe('second');
      },
      { timeout: 20_000, interval: 500 },
    );
  }, 40_000);
});
