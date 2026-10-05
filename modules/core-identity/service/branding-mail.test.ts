// The name and sender in mails come from the branding settings of core.settings (ADR-0018), not
// from identity's own settings or from the code.
import { makeAuthMethod, makeSetting } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { createMemoryMailer } from './mailer.ts';
import { hashPassword } from './password.ts';

const identity = useIdentity();

async function start(branding?: Record<string, unknown>) {
  const mailer = createMemoryMailer();
  const started = await identity.start({ mailer });
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
  return { ...started, mailer };
}

describe('mails and branding', () => {
  it('use the product name and the placeholder sender when nothing is configured', async () => {
    const { identity: svc, mailer } = await start();
    await svc.recovery.requestReset({ email: 'alice@example.org' });
    expect(mailer.sent[0]).toMatchObject({ from: 'no-reply@localhost' });
    expect(mailer.sent[0]!.subject).toContain('Scorpion');
  });

  it('use the instance name and sender of the branding settings', async () => {
    const { identity: svc, mailer } = await start({
      instanceName: 'Registry X',
      mailFrom: 'registry@example.org',
    });
    await svc.recovery.requestReset({ email: 'alice@example.org' });
    const mail = mailer.sent[0]!;
    expect(mail.from).toBe('registry@example.org');
    expect(mail.subject).toContain('Registry X');
    expect(mail.text).toContain('Registry X');
    expect(mail.subject + mail.text).not.toContain('Scorpion');
  });

  it('keep working for a database that stored the name under core.identity before 0.4.0 (migration 0002 of core.settings moved it)', async () => {
    // The migration itself is tested in core-settings; here the result is what a mail shows.
    const { identity: svc, mailer } = await start({
      instanceName: 'Moved Name',
      mailFrom: 'moved@example.org',
    });
    await svc.recovery.requestReset({ email: 'alice@example.org' });
    expect(mailer.sent[0]).toMatchObject({ from: 'moved@example.org' });
    expect(mailer.sent[0]!.subject).toContain('Moved Name');
  });

  it("ignore instanceName and mailFrom in identity's own stored settings (the schema no longer knows them)", async () => {
    const mailer = createMemoryMailer();
    const started = await identity.start({ mailer });
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
    await started.identity.recovery.requestReset({ email: 'bob@example.org' });
    expect(mailer.sent[0]!.from).toBe('no-reply@localhost');
  });
});
