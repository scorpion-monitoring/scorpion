// M4 sprint 2 acceptance, through the real pipeline, real workers and a real relay: registering puts the
// welcome and the administrator mails in Mailpit with the sender and instance name of the branding settings;
// with the relay stopped the mails stay queued, are retried and arrive when it returns; a reset token lives
// in the mail only; a taken address gets the same answer as a new one and its owner the notice.
import net from 'node:net';
import {
  startMailpit,
  startSmtpServer,
  tablesContaining,
  type StartedMailpit,
} from '@scorpion/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
let mailpit: StartedMailpit;
beforeAll(async () => {
  mailpit = await startMailpit();
}, 120_000);
afterAll(async () => {
  await mailpit?.stop();
});

const BRANDING = {
  instanceName: 'Atlas Registry',
  mailFrom: 'registry@atlas.example',
  contactEmail: 'help@atlas.example',
};
const FAST = { pollingIntervalSeconds: 1 };

/** An instance whose mail goes to Mailpit, with workers and the wake-up listener running. */
async function startWithMailpit(extra: Parameters<typeof app.start>[0] = {}) {
  await mailpit.clear();
  return app.start({
    tokenCacheTtlMs: 0,
    startWorkers: true,
    jobs: FAST,
    notifications: { listen: true },
    branding: BRANDING,
    notificationSettings: {
      emailTransport: 'smtp',
      smtp: { host: mailpit.smtpHost, port: mailpit.smtpPort, tls: 'none', timeoutSeconds: 5 },
    },
    ...extra,
  });
}

describe('registering, through the real pipeline', () => {
  it('puts the welcome mail and the administrator mail in Mailpit, from the sender and with the instance name of the branding', async () => {
    const { post, signedIn, mail } = await startWithMailpit();
    await signedIn('admin', { email: 'admin@example.org', roles: ['admin'] });

    const reply = await post('/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
    });
    expect(reply.status).toBe(202);

    const received = await mailpit.waitForMessages(3);
    expect(received.map((m) => m.to[0]).sort()).toEqual([
      'admin@example.org',
      'alice@example.org',
      'alice@example.org',
    ]);
    for (const message of received) {
      expect(message.from.address).toBe('registry@atlas.example');
      expect(message.text).toContain('Atlas Registry');
      expect(message.html).toContain('Atlas Registry');
      expect(message.text).toContain('help@atlas.example');
    }
    const welcome = received.find((m) => m.subject.startsWith('Welcome'))!;
    expect(welcome.subject).toBe('Welcome to Atlas Registry');
    expect(welcome.text).toContain('1 to 2 business days');
    expect(received.find((m) => m.to[0] === 'admin@example.org')!.subject).toBe(
      'Registration request from alice',
    );
    // Delivered: every row is sent through the smtp transport.
    await expect
      .poll(async () => (await mail.all()).map((m) => m.status), { timeout: 10_000 })
      .toEqual(['sent', 'sent', 'sent']);
  });

  it('sends the mails in German when the request asked for it', async () => {
    const { post } = await startWithMailpit();
    await post('/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD, locale: 'de' },
    });
    const received = await mailpit.waitForMessages(2);
    expect(received.map((m) => m.subject).sort()).toEqual([
      'E-Mail-Adresse für Atlas Registry bestätigen',
      'Willkommen bei Atlas Registry',
    ]);
  });
});

describe('a taken address', () => {
  it('gets the same answer as a new one, and its owner the notice in Mailpit', async () => {
    const { post, signedIn } = await startWithMailpit();
    await signedIn('owner', { email: 'alice@example.org' });
    const fresh = await post('/auth/register', {
      body: { username: 'fresh', email: 'fresh@example.org', password: PASSWORD },
    });
    const taken = await post('/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
    });
    expect([taken.status, taken.body]).toEqual([fresh.status, fresh.body]);
    expect(taken.body).toEqual({ accepted: true });

    const received = await mailpit.waitForMessages(3);
    const notice = received.find((m) => m.to[0] === 'alice@example.org')!;
    expect(notice.subject).toBe('Someone tried to register on Atlas Registry with your address');
    expect(notice.text).not.toContain('#token=');
    // The new address got a welcome and a confirmation link; the owner of the taken one only the notice.
    expect(received.filter((m) => m.to[0] === 'fresh@example.org')).toHaveLength(2);
    expect(received.filter((m) => m.to[0] === 'alice@example.org')).toHaveLength(1);
  });
});

describe('a password reset, through the real pipeline', () => {
  it('has the token in the mail only: the log, every table and the responses are clean once it is sent', async () => {
    const { post, get, signedIn, kernel, mail, logText } = await startWithMailpit();
    const session = await signedIn('alice', { email: 'alice@example.org' });

    const asked = await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    expect(asked.status).toBe(202);
    const [message] = await mailpit.waitForMessages(1);
    expect(message!.subject).toBe('Reset your Atlas Registry password');
    const token = decodeURIComponent(/#token=(srt_[A-Za-z0-9_-]{43})/.exec(message!.text)![1]!);
    expect(message!.html).toContain(token);

    // Sent: the stored body is gone, and the token lives nowhere in the database.
    await expect
      .poll(async () => (await mail.all()).map((m) => [m.status, m.text]), { timeout: 10_000 })
      .toEqual([['sent', '']]);
    expect(await tablesContaining(kernel.pool, token)).toEqual([]);

    const done = await post('/auth/password-reset/confirm', {
      body: { token, password: 'another long passphrase' },
    });
    expect(done.status).toBe(204);
    expect((await get('/auth/me', { cookie: session.cookie })).status).toBe(401);

    const log = logText();
    expect(log).toContain('"msg"');
    for (const secret of [
      token,
      token.slice(4),
      '#token=',
      'alice@example.org',
      'another long passphrase',
    ]) {
      expect(log).not.toContain(secret);
      expect(JSON.stringify(asked.body)).not.toContain(secret);
      expect(JSON.stringify(done.body ?? '')).not.toContain(secret);
    }
    expect(await tablesContaining(kernel.pool, token)).toEqual([]);
  });
});

describe('when the relay is down', () => {
  it('keeps the mails queued, retries them, and delivers them when the relay returns', async () => {
    const relay = await startSmtpServer();
    try {
      const { post, signedIn, mail, kernel, notifications } = await app.start({
        tokenCacheTtlMs: 0,
        branding: BRANDING,
        notificationSettings: {
          emailTransport: 'smtp',
          smtp: { host: '127.0.0.1', port: relay.port, tls: 'none', timeoutSeconds: 2 },
        },
      });
      await signedIn('admin', { email: 'admin@example.org', roles: ['admin'] });
      await relay.stop();

      const reply = await post('/auth/register', {
        body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
      });
      expect(reply.status).toBe(202); // the request never waited for the relay
      expect(await mail.all()).toHaveLength(3);

      // A pass while the relay is down: every mail stays queued with a growing attempt count and a code.
      expect(await notifications.deliverDue()).toMatchObject({ claimed: 3, retried: 3, sent: 0 });
      expect(await mail.all()).toMatchObject([
        { status: 'queued' },
        { status: 'queued' },
        { status: 'queued' },
      ]);
      const due = async () =>
        void (await kernel.pool.query(
          "update notify_delivery set next_attempt_at = now() where status = 'queued'",
        ));
      await due();
      expect(await notifications.deliverDue()).toMatchObject({ claimed: 3, retried: 3 });
      expect(
        (await kernel.pool.query('select attempts, last_error from notify_delivery')).rows,
      ).toEqual([
        { attempts: 2, last_error: 'ESOCKET' },
        { attempts: 2, last_error: 'ESOCKET' },
        { attempts: 2, last_error: 'ESOCKET' },
      ]);

      // The relay returns; the next pass delivers all three.
      await relay.restart();
      await due();
      expect(await notifications.deliverDue()).toMatchObject({ claimed: 3, sent: 3, retried: 0 });
      expect(relay.received.map((m) => m.to[0]).sort()).toEqual([
        'admin@example.org',
        'alice@example.org',
        'alice@example.org',
      ]);
      expect((await mail.all()).map((m) => m.status)).toEqual(['sent', 'sent', 'sent']);
    } finally {
      await relay.stop().catch(() => undefined);
    }
  });

  it('answers at once while a relay that never answers holds the delivery (the request only inserts a row)', async () => {
    // A server that accepts the connection and says nothing: a send waits for its timeout.
    const sockets = new Set<net.Socket>();
    const silent = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const port = (silent.address() as net.AddressInfo).port;
    try {
      const { post, signedIn, mail } = await app.start({
        tokenCacheTtlMs: 0,
        startWorkers: true,
        jobs: FAST,
        notifications: { listen: true },
        notificationSettings: {
          emailTransport: 'smtp',
          smtp: { host: '127.0.0.1', port, tls: 'none', timeoutSeconds: 30 },
        },
      });
      await signedIn('alice', { email: 'alice@example.org' });
      const timed = async (email: string) => {
        const started = performance.now();
        const reply = await post('/auth/password-reset', { body: { email } });
        return { status: reply.status, ms: performance.now() - started };
      };
      const known = await timed('alice@example.org');
      const unknown = await timed('ghost@example.org');
      // Wait until the worker holds the first mail on the silent relay, then ask again.
      await expect.poll(() => sockets.size, { timeout: 10_000 }).toBeGreaterThan(0);
      const during = await timed('alice@example.org');
      expect([known.status, unknown.status, during.status]).toEqual([202, 202, 202]);
      for (const ms of [known.ms, unknown.ms, during.ms]) expect(ms).toBeLessThan(2_000);
      expect((await mail.all())[0]).toMatchObject({
        status: expect.stringMatching(/sending|queued/) as unknown,
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
