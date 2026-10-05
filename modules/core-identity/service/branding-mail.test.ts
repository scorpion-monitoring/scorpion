// The name and sender in mails come from the branding settings of core.settings (ADR-0018), not
// from identity's own settings or from the code. Delivered through a real (test) relay, because the
// sender is chosen at send time: it is not stored on the delivery row.
import {
  makeAuthMethod,
  makeSetting,
  startSmtpServer,
  type TestSmtpServer,
} from '@scorpion/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { hashPassword } from './password.ts';

const identity = useIdentity();

const relays: TestSmtpServer[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.stop().catch(() => undefined);
});

async function start(branding?: Record<string, unknown>) {
  const smtp = await startSmtpServer();
  relays.push(smtp);
  const started = await identity.start({
    notificationSettings: {
      emailTransport: 'smtp',
      smtp: { host: '127.0.0.1', port: smtp.port, tls: 'none', timeoutSeconds: 2 },
    },
  });
  if (branding) {
    await makeSetting(started.kernel.pool, 'core.settings', { branding });
  }
  const user = await makeMember(started.kernel.pool, {
    username: 'alice',
    email: 'alice@example.org',
    emailVerified: false,
  });
  await makeAuthMethod(started.kernel.pool, user, {
    passwordHash: await hashPassword('correct horse battery'),
  });
  return { ...started, smtp };
}

/** Asks for a reset, sends it through the relay and returns what the relay received. */
async function resetMailFor(
  started: Awaited<ReturnType<typeof start>>,
  email = 'alice@example.org',
) {
  await started.identity.recovery.requestReset({ email });
  await started.notifications.deliverDue();
  expect(started.smtp.received).toHaveLength(1);
  const received = started.smtp.received[0]!;
  return { from: received.from, to: received.to, data: received.data };
}

describe('mails and branding', () => {
  it('use the product name and the placeholder sender when nothing is configured', async () => {
    const started = await start();
    const mail = await resetMailFor(started);
    expect(mail.from).toBe('no-reply@localhost');
    expect(mail.data).toContain('Subject: Reset your Scorpion password');
  });

  it('use the instance name and sender of the branding settings', async () => {
    const started = await start({ instanceName: 'Registry X', mailFrom: 'registry@example.org' });
    const mail = await resetMailFor(started);
    expect(mail.from).toBe('registry@example.org');
    expect(mail.data).toContain('Subject: Reset your Registry X password');
    expect(mail.data).toContain('Registry X');
    expect(mail.data).not.toContain('Scorpion');
  });

  it('keep working for a database that stored the name under core.identity before 0.4.0 (migration 0002 of core.settings moved it)', async () => {
    // The migration itself is tested in core-settings; here the result is what a mail shows.
    const started = await start({ instanceName: 'Moved Name', mailFrom: 'moved@example.org' });
    const mail = await resetMailFor(started);
    expect(mail.from).toBe('moved@example.org');
    expect(mail.data).toContain('Moved Name');
  });

  it("ignore instanceName and mailFrom in identity's own stored settings (the schema no longer knows them)", async () => {
    const started = await start();
    await makeSetting(started.kernel.pool, 'core.identity', {
      instanceName: 'Stale',
      mailFrom: 'stale@example.org',
    });
    const user = await makeMember(started.kernel.pool, {
      username: 'bob',
      email: 'bob@example.org',
      emailVerified: false,
    });
    await makeAuthMethod(started.kernel.pool, user, {
      passwordHash: await hashPassword('correct horse battery'),
    });
    const mail = await resetMailFor(started, 'bob@example.org');
    expect(mail.from).toBe('no-reply@localhost');
    expect(mail.data).not.toContain('Stale');
  });

  it('puts the instance name, contact address and the German catalogue in the mail when the account prefers German', async () => {
    const started = await start({
      instanceName: 'Registry X',
      mailFrom: 'registry@example.org',
      contactEmail: 'help@example.org',
    });
    await started.identity.recovery.requestReset({ email: 'alice@example.org', locale: 'de' });
    await started.notifications.deliverDue();
    const data = started.smtp.received[0]!.data;
    expect(data).toContain('Subject: =?UTF-8?');
    // Quoted-printable text part: the German heading, and the contact line in the footer.
    expect(data).toMatch(/Passwort/);
    expect(data).toContain('help@example.org');
  });
});
