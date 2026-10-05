// core.identity reads its settings from core.settings (ADR 0017): the values an administrator saved
// replace the defaults and nothing else. Each number that used to be a constant is a setting whose
// default is that constant (README, "Settings").
import { makeAuthMethod, makeToken, makeUser } from '@scorpion/testing';
import { Forbidden } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { makeMember, useIdentity } from '../test/harness.ts';
import { hashPassword } from './password.ts';
import { createMemoryMailer } from './mailer.ts';

const identity = useIdentity();
const DAY = 24 * 3600 * 1000;
const PASSWORD = 'correct horse battery';

async function start(options: Parameters<typeof identity.start>[0] = {}) {
  const mailer = createMemoryMailer();
  const started = await identity.start({ mailer, ...options });
  const admin = await started.actorOf(
    await makeUser(started.kernel.pool, { username: 'root' }),
    'admin',
  );
  /** What an administrator does through the settings API, at the service. */
  const save = async (values: Record<string, unknown>) => {
    const current = await started.settingsStore.settings.get(admin, 'core.identity');
    return started.settingsStore.settings.update(admin, 'core.identity', {
      version: current.version,
      values,
    });
  };
  return { ...started, mailer, admin, save };
}

const count = async (
  pool: { query: (sql: string) => Promise<{ rows: unknown[] }> },
  table: string,
) => ((await pool.query(`select count(*)::int as n from ${table}`)).rows[0] as { n: number }).n;

describe('the settings an administrator saved', () => {
  it('turn local accounts off for the module that reads them, with no restart', async () => {
    const { identity: id, save } = await start();
    const input = { username: 'alice', email: 'alice@example.org', password: PASSWORD };
    await save({ localAccounts: false });
    await expect(id.accounts.register(input)).rejects.toBeInstanceOf(Forbidden);
    await save({ localAccounts: true });
    await expect(id.accounts.register(input)).resolves.toBeDefined();
  });

  it('fall back to the default for a stored key the schema rejects, and keep the rest', async () => {
    const { identity: id, kernel } = await start({ settingsCacheTtlMs: 0 }); // written behind the cache's back
    await kernel.pool.query(
      `insert into settings_setting (module_id, value) values ('core.identity', $1)`,
      [JSON.stringify({ localAccounts: false, retention: 'forever' })],
    );
    // retention is dropped (its default holds); localAccounts keeps its stored value
    await expect(
      id.accounts.register({ username: 'bob', email: 'bob@example.org', password: PASSWORD }),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('retention', () => {
  it('purges accounts after the saved number of days instead of 30', async () => {
    const { kernel, identity: id, save } = await start();
    await makeUser(kernel.pool, { username: 'gone', status: 'rejected', deleted: true });
    await kernel.pool.query(
      "update identity_user set deleted_at = now() - interval '3 days' where username = 'gone'",
    );
    expect((await id.cleanup.run()).purgedUsers).toBe(0); // 30 days by default
    await save({ retention: { purgeAfterDays: 2 } });
    expect((await id.cleanup.run()).purgedUsers).toBe(1);
    expect(await count(kernel.pool, 'identity_user')).toBe(1); // only the administrator is left
  });

  it('keeps accounts longer when the setting says so', async () => {
    const { kernel, identity: id, save } = await start();
    await makeUser(kernel.pool, { username: 'gone', status: 'rejected', deleted: true });
    await kernel.pool.query(
      "update identity_user set deleted_at = now() - interval '40 days' where username = 'gone'",
    );
    await save({ retention: { purgeAfterDays: 60 } });
    expect((await id.cleanup.run()).purgedUsers).toBe(0);
  });

  it('removes an expired token after the saved grace instead of 30 days', async () => {
    const { kernel, identity: id, save } = await start();
    const user = await makeMember(kernel.pool);
    await makeToken(kernel.pool, user, { expiresAt: new Date(Date.now() - 5 * DAY) });
    expect((await id.cleanup.run()).accessTokens).toBe(0);
    await save({ retention: { tokenGraceDays: 3 } });
    expect((await id.cleanup.run()).accessTokens).toBe(1);
  });

  it('purges at most the saved batch per run', async () => {
    const { kernel, identity: id, save } = await start();
    await save({ retention: { purgeBatch: 2 } });
    await kernel.pool.query(
      `insert into identity_user (id, username, status, deleted_at)
       select gen_random_uuid(), 'bulk-' || g, 'rejected', now() - interval '40 days' from generate_series(1, 5) g`,
    );
    expect((await id.cleanup.run()).purgedUsers).toBe(2);
    expect((await id.cleanup.run()).purgedUsers).toBe(2);
    expect((await id.cleanup.run()).purgedUsers).toBe(1);
  });

  it('refuses nonsense in the settings, so the job can never be switched into a bad state', async () => {
    const { save } = await start();
    for (const retention of [
      { purgeBatch: 0 },
      { purgeAfterDays: 0 },
      { tokenGraceDays: -1 },
      { purgeBatch: 1e6 },
    ]) {
      await expect(save({ retention })).rejects.toMatchObject({ status: 422 });
    }
  });
});

describe('mail budgets', () => {
  it('limit the mails to one address to the saved burst', async () => {
    const { kernel, identity: id, mailer, save } = await start();
    const user = await makeMember(kernel.pool, {
      email: 'alice@example.org',
      emailVerified: false,
    });
    await makeAuthMethod(kernel.pool, user, { passwordHash: await hashPassword(PASSWORD) });
    await save({ mailBudgets: { perAddress: { burst: 1, perHour: 0.5 } } });
    for (let i = 0; i < 4; i++) await id.recovery.requestReset({ email: 'alice@example.org' });
    expect(mailer.sent).toHaveLength(1);
  });

  it('limit the confirmation mails of one user to the saved burst', async () => {
    const { kernel, identity: id, save } = await start();
    const user = await makeMember(kernel.pool, {
      email: 'alice@example.org',
      emailVerified: false,
    });
    await save({ mailBudgets: { perUser: { burst: 1, perHour: 0.5 } } });
    const actor = {
      kind: 'user',
      userId: user.id,
      username: user.username,
      roles: [],
      via: 'session',
    } as const;
    await id.recovery.resendVerification(actor);
    await expect(id.recovery.resendVerification(actor)).rejects.toMatchObject({ status: 429 });
  });
});
