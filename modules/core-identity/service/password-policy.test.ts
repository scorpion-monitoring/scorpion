// The rules of a new password (ASVS 6.1.2, 6.2.4, 6.2.11, 6.2.12) at every place a password is set:
// register, reset, change, first-run token and create-admin. The breach service is a stub that
// knows the passwords a test gives it; only the adapter's own tests speak HTTP.
import { Invalid } from '@scorpion/contracts';
import { createStubPwnedPasswords, pwnedPasswordFailures } from '@scorpion/integrations';
import { makeAuthMethod, makeSetting, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { createAdminCommand } from './create-admin-command.ts';
import { useIdentity } from '../test/harness.ts';
import { tokenFrom } from '../test/mail.ts';
import { hashPassword } from './password.ts';
import { settingsSchema, type IdentitySettings } from './settings.ts';

const identity = useIdentity();
const GOOD = 'correct horse battery';
const LEAKED = 'hunter2-leaked-long';
const NEW_GOOD = 'another long passphrase';

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string) =>
  (await kernel.pool.query(sql)).rows as Record<string, unknown>[];
const settingsOf = (
  values: Partial<ReturnType<typeof settingsSchema.parse>>,
): IdentitySettings => ({ get: () => Promise.resolve(settingsSchema.parse(values)) });

const fields = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Invalid);
  return (error as Invalid).errors?.map((e) => e.path);
};

async function start(options: Parameters<typeof identity.start>[0] = {}) {
  const pwned = createStubPwnedPasswords({ breached: [LEAKED] });
  const shown: string[] = [];
  const started = await identity.start({ pwned, announce: (t) => shown.push(t), ...options });
  const withPassword = async (overrides: Parameters<typeof makeUser>[1] = {}) => {
    // No role: `actorOf` gives the role `user` when a test needs a session.
    const user = await makeUser(started.kernel.pool, { emailVerified: false, ...overrides });
    await makeAuthMethod(started.kernel.pool, user, { passwordHash: await hashPassword(GOOD) });
    return user;
  };
  return { ...started, pwned, shown, withPassword };
}

describe('a breached password', () => {
  it('is refused on register with a 422 on the password field, before anything is spent or written [ASVS-6.2.4]', async () => {
    const { kernel, identity: id, mail } = await start();
    const path = await fields(
      id.accounts.register({ username: 'carol', email: 'carol@example.org', password: LEAKED }),
    );
    expect(path).toEqual(['password']);
    expect(await rows(kernel, 'select 1 from identity_user')).toEqual([]);
    expect(await mail.all()).toEqual([]);
    // The mail budget of the address was not spent either.
    expect(await rows(kernel, 'select 1 from kernel_rate_bucket')).toEqual([]);
  });

  it('is refused on register for a taken address as well, so the two paths answer alike', async () => {
    const { identity: id, withPassword } = await start();
    await withPassword({ username: 'alice', email: 'alice@example.org' });
    expect(
      await fields(
        id.accounts.register({ username: 'carol', email: 'alice@example.org', password: LEAKED }),
      ),
    ).toEqual(['password']);
  });

  it('is refused on reset, and the link stays usable [ASVS-6.2.12]', async () => {
    const { identity: id, mail, withPassword } = await start();
    await withPassword({ username: 'alice', email: 'alice@example.org' });
    await id.recovery.requestReset({ email: 'alice@example.org' });
    const token = tokenFrom((await mail.all())[0]);

    expect(await fields(id.recovery.confirmReset({ token, password: LEAKED }))).toEqual([
      'password',
    ]);
    await expect(id.recovery.confirmReset({ token, password: NEW_GOOD })).resolves.toBeUndefined();
  });

  it('is refused on change, on the newPassword field, and nothing changes', async () => {
    const { kernel, identity: id, actorOf, withPassword } = await start();
    const user = await withPassword({ username: 'alice', email: 'alice@example.org' });
    const before = await rows(kernel, 'select password_hash from identity_auth_method');
    const actor = await actorOf(user);

    expect(
      await fields(
        id.recovery.changePassword(actor, { currentPassword: GOOD, newPassword: LEAKED }),
      ),
    ).toEqual(['newPassword']);
    expect(await rows(kernel, 'select password_hash from identity_auth_method')).toEqual(before);
  });

  it('is refused for the first-run token, which stays usable, and for create-admin', async () => {
    const { kernel, identity: id, shown } = await start();
    await kernel.pool.query('delete from identity_first_run_token');
    shown.length = 0; // the token that start-up printed is gone now
    await id.bootstrap.issueFirstRunToken();
    const token = /sfr_[A-Za-z0-9_-]{43}/.exec(shown.join('\n'))![0];
    const admin = { username: 'root', email: 'root@example.org' };

    expect(
      await fields(id.bootstrap.redeemFirstRunToken({ ...admin, password: LEAKED, token })),
    ).toEqual(['password']);
    expect(await fields(id.bootstrap.createAdmin({ ...admin, password: LEAKED }))).toEqual([
      'password',
    ]);
    expect(await rows(kernel, 'select 1 from identity_user')).toEqual([]);
    // The refusal did not use the token up.
    await expect(
      id.bootstrap.redeemFirstRunToken({ ...admin, password: GOOD, token }),
    ).resolves.toMatchObject({ username: 'root' });
  });

  it('is refused by `scorpion create-admin`, which names the field and not the password', async () => {
    const { identity: id } = await start();
    const out: string[] = [];
    const code = await createAdminCommand(() => id.bootstrap).run(
      ['--username', 'root', '--email', 'root@example.org'],
      {
        out: (text) => out.push(text),
        err: (text) => out.push(text),
        readSecret: () => Promise.resolve(LEAKED),
      },
    );
    expect(code).toBe(1);
    expect(out.join('\n')).toMatch(/password/);
    expect(out.join('\n')).not.toContain(LEAKED);
  });

  it('does not tell how often it was seen, and names no part of the password', async () => {
    const { identity: id } = await start();
    const error = (await id.accounts
      .register({ username: 'carol', email: 'carol@example.org', password: LEAKED })
      .catch((e: unknown) => e)) as Invalid;
    expect(JSON.stringify(error.errors)).not.toMatch(/\d/);
    expect(JSON.stringify(error)).not.toContain(LEAKED);
  });
});

describe('the breach check', () => {
  it('accepts a password the service does not know, and asked it exactly as received', async () => {
    const { identity: id, pwned } = await start();
    const padded = `  ${NEW_GOOD} `;
    await id.accounts.register({ username: 'carol', email: 'carol@example.org', password: padded });
    expect(pwned.asked).toEqual([padded]);
  });

  it('accepts the password, logs a warning without it, and counts the failure when the service does not answer', async () => {
    const logLines: string[] = [];
    const pwned = createStubPwnedPasswords({ unavailable: true });
    const { identity: id } = await start({ pwned, logLines });
    const before = pwnedPasswordFailures();

    await expect(
      id.accounts.register({ username: 'carol', email: 'carol@example.org', password: LEAKED }),
    ).resolves.toMatchObject({ username: 'carol' });

    expect(pwnedPasswordFailures()).toBe(before + 1);
    const log = logLines.join('');
    expect(log).toContain('breach check is unavailable');
    expect(log).not.toContain(LEAKED);
  });

  it('is skipped, and the service not asked, when passwordBreachCheck is off', async () => {
    const { identity: id, pwned } = await start({
      settings: settingsOf({ passwordBreachCheck: false }),
    });
    await expect(
      id.accounts.register({ username: 'carol', email: 'carol@example.org', password: LEAKED }),
    ).resolves.toMatchObject({ username: 'carol' });
    expect(pwned.asked).toEqual([]);
  });

  it('is on by default', async () => {
    const { identity: id, pwned } = await start();
    await id.accounts.register({ username: 'carol', email: 'carol@example.org', password: GOOD });
    expect(pwned.asked).toEqual([GOOD]);
  });
});

describe('context words', () => {
  it('refuses the documented project words, whole or inside the password [ASVS-6.1.2]', async () => {
    const { identity: id } = await start();
    const attempts = ['scorpion', 'NFDI', 'de.NBI', 'IPK', 'my-Scorpion-password', 'x ipk y z'];
    for (const [index, password] of attempts.entries()) {
      const error = await id.accounts
        .register({ username: `user${index}`, email: `u${index}@example.org`, password })
        .catch((e: unknown) => e);
      expect(error, password).toBeInstanceOf(Invalid);
    }
  });

  it('refuses the instance name, the host, the username and the email address of the person [ASVS-6.2.11]', async () => {
    const { kernel, identity: id } = await start({
      env: { ORIGIN: 'https://monitoring.example.org' },
    });
    await makeSetting(kernel.pool, 'core.settings', { branding: { instanceName: 'Plant Atlas' } });

    const register = (password: string) =>
      id.accounts.register({ username: 'feser-m', email: 'manuel.feser@example.org', password });
    for (const password of [
      'plant atlas 2024',
      'my-ATLAS-key',
      'monitoring.example.org',
      'the monitoring horse',
      'feser-m',
      'feser-m-1234',
      'MANUEL.FESER',
      'manuel xyz abc',
    ]) {
      expect(await fields(register(password)), password).toEqual(['password']);
    }
    // Not whole words.
    await expect(register('atlases and manuals')).resolves.toMatchObject({ username: 'feser-m' });
  });

  it('refuses the names of the account on reset and on change', async () => {
    const { identity: id, mail, actorOf, withPassword } = await start();
    const user = await withPassword({ username: 'alice-w', email: 'alice.wonder@example.org' });
    await id.recovery.requestReset({ email: 'alice.wonder@example.org' });
    const token = tokenFrom((await mail.all())[0]);

    expect(await fields(id.recovery.confirmReset({ token, password: 'alice-w-2024!' }))).toEqual([
      'password',
    ]);
    expect(
      await fields(
        id.recovery.changePassword(await actorOf(user), {
          currentPassword: GOOD,
          newPassword: 'wonder-wonder-wonder',
        }),
      ),
    ).toEqual(['newPassword']);
  });

  it('refuses them on first-run and create-admin', async () => {
    const { identity: id } = await start();
    expect(
      await fields(
        id.bootstrap.createAdmin({
          username: 'root-user',
          email: 'root@example.org',
          password: 'root-user-1',
        }),
      ),
    ).toEqual(['password']);
  });
});
