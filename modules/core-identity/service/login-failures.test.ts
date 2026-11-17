// The audit of sign-ins on real Postgres (ASVS 6.3.1; ADR 0026, M12a): a success is an event in the transaction that makes the session,
// and the failures of one name are counted per window, never one row per attempt, and become one event when the window closes. There is no
// lockout (the throttle tests keep that). The table holds no name and no address; the event holds a count, a window and a key, never a name.
import { Unauthorized } from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { failOutbox } from '../test/mail.ts';
import { accountKey, windowStart } from './login-throttle.ts';
import { FLUSH_BATCH, NAME_KEY_LENGTH } from './login-failures.ts';
import { hashPassword } from './password.ts';
import { settingsSchema, type IdentitySettings } from './settings.ts';

const identity = useIdentity();
const PASSWORD = 'correct horse battery';
const WRONG = 'wrong horse battery';
const IP = '203.0.113.7';
const WINDOW = 600;
const T0 = new Date('2026-10-06T12:00:00Z'); // the start of a 10-minute window
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const settingsWith = (extra: { auditMaxUnknownNames?: number } = {}): IdentitySettings => ({
  get: () =>
    Promise.resolve(
      settingsSchema.parse({
        // Plenty of free attempts: these tests count failures, the throttle has its own.
        loginThrottle: {
          freeAttempts: 1000,
          freeAttemptsPerAccount: 10_000,
          auditWindowSeconds: WINDOW,
          ...extra,
        },
      }),
    ),
});

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
const events = (kernel: { pool: Pool }, name: string) =>
  rows(kernel, 'select payload from kernel_outbox where name = $1 order by occurred_at, id', [
    name,
  ]).then((found) => found.map((row) => row.payload as Record<string, unknown>));

async function start(extra: { auditMaxUnknownNames?: number } = {}) {
  const started = await identity.start({ settings: settingsWith(extra) });
  const alice = await makeUser(started.kernel.pool, {
    username: 'alice',
    email: 'alice@example.org',
    status: 'active',
  });
  await makeAuthMethod(started.kernel.pool, alice, { passwordHash: await hashPassword(PASSWORD) });
  const login = (
    username: string,
    password: string,
    options: { clientIp?: string; now?: Date } = {},
  ) =>
    started.identity.accounts.login({ username, password }, undefined, {
      clientIp: IP,
      now: T0,
      ...options,
    });
  const fail = (username: string, options: { clientIp?: string; now?: Date } = {}) =>
    login(username, WRONG, options).then(
      () => 'ok',
      (error: unknown) => (error instanceof Unauthorized ? 'refused' : String(error)),
    );
  return { ...started, alice, login, fail };
}

describe('windowStart', () => {
  it.each([
    ['2026-10-06T12:00:00Z', 600, '2026-10-06T12:00:00Z'],
    ['2026-10-06T12:09:59.999Z', 600, '2026-10-06T12:00:00Z'],
    ['2026-10-06T12:10:00Z', 600, '2026-10-06T12:10:00Z'],
    ['2026-10-06T12:34:56Z', 3600, '2026-10-06T12:00:00Z'],
    ['2026-10-06T23:59:59Z', 86_400, '2026-10-06T00:00:00Z'],
    ['2026-10-07T00:00:00Z', 86_400, '2026-10-07T00:00:00Z'],
  ])('%s in a window of %i seconds starts at %s', (now, seconds, start) => {
    expect(windowStart(new Date(now), seconds)).toEqual(new Date(start));
  });
});

describe('a successful sign-in is on the trail [ASVS-6.3.1]', () => {
  it('emits identity.session.created@1 with the person and the method, and no session id, in the transaction of the session', async () => {
    const { kernel, login, alice } = await start();
    const session = await login('alice', PASSWORD);
    const [event, ...more] = await events(kernel, 'identity.session.created@1');
    expect(more).toEqual([]);
    expect(event).toEqual({ userId: alice.id, username: 'alice', method: 'password', ip: IP });
    expect(JSON.stringify(event)).not.toContain(session.sessionId);
    expect(await rows(kernel, 'select 1 from identity_session')).toHaveLength(1);
  });

  it('makes no session and no event when the event cannot be written (rollback)', async () => {
    const { kernel, login } = await start();
    await failOutbox(kernel);
    await expect(login('alice', PASSWORD)).rejects.toThrow();
    expect(await rows(kernel, 'select 1 from identity_session')).toEqual([]);
    expect(await rows(kernel, 'select 1 from kernel_outbox')).toEqual([]);
  });

  it('is not written for a failure, and a failure makes no session event', async () => {
    const { kernel, fail } = await start();
    expect(await fail('alice')).toBe('refused');
    expect(await events(kernel, 'identity.session.created@1')).toEqual([]);
  });
});

describe('failed sign-ins are counted, not listed [ASVS-6.3.1]', () => {
  it('turns 1,000 failures against one name from one address into one row, and then one event', async () => {
    const { kernel, fail, identity: id, alice } = await start();
    for (let i = 0; i < 1000; i++) expect(await fail('alice')).toBe('refused');
    const stored = await rows(
      kernel,
      'select key_hash, failures, user_id, window_seconds from identity_login_failure',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      key_hash: accountKey('alice'),
      failures: 1000,
      user_id: alice.id,
      window_seconds: WINDOW,
    });
    // An open window writes nothing to the trail.
    expect(await id.loginFailures.flush(at(WINDOW - 1))).toEqual({ windows: 0, failures: 0 });
    expect(await events(kernel, 'identity.login.failed@1')).toEqual([]);

    expect(await id.loginFailures.flush(at(WINDOW))).toEqual({ windows: 1, failures: 1000 });
    expect(await events(kernel, 'identity.login.failed@1')).toEqual([
      {
        userId: alice.id,
        nameKey: accountKey('alice').slice(0, NAME_KEY_LENGTH),
        context: 'sign-in',
        count: 1000,
        windowStart: T0.toISOString(),
        windowSeconds: WINDOW,
      },
    ]);
    expect(await rows(kernel, 'select 1 from identity_login_failure')).toEqual([]);
    // Nothing is written twice.
    expect(await id.loginFailures.flush(at(WINDOW * 2))).toEqual({ windows: 0, failures: 0 });
    expect(await events(kernel, 'identity.login.failed@1')).toHaveLength(1);
  }, 120_000);

  it('writes a number of rows that follows the number of names, not of attempts: 1,000 failures over 25 names are 25 rows and 25 events', async () => {
    const { kernel, fail, identity: id } = await start();
    for (let i = 0; i < 1000; i++) await fail(i % 25 === 0 ? 'alice' : `guess-${i % 25}`);
    expect(await rows(kernel, 'select 1 from identity_login_failure')).toHaveLength(25);
    expect(await id.loginFailures.flush(at(WINDOW))).toEqual({ windows: 25, failures: 1000 });
    expect(await events(kernel, 'identity.login.failed@1')).toHaveLength(25);
  }, 120_000);

  it('opens a window of its own for each stretch of time: two windows are two events, and a name that is no account has no user id', async () => {
    const { kernel, fail, identity: id } = await start();
    await fail('nobody-here', { now: at(10) });
    await fail('nobody-here', { now: at(20) });
    await fail('nobody-here', { now: at(WINDOW + 5) });
    expect(await id.loginFailures.flush(at(WINDOW * 3))).toEqual({ windows: 2, failures: 3 });
    const found = await events(kernel, 'identity.login.failed@1');
    expect(found.map((event) => [event.count, event.windowStart])).toEqual([
      [2, T0.toISOString()],
      [1, at(WINDOW).toISOString()],
    ]);
    for (const event of found) {
      expect(event.userId).toBeNull();
      expect(event.nameKey).toBe(accountKey('nobody-here').slice(0, NAME_KEY_LENGTH));
      // Never the name, the address or the password that was tried.
      expect(JSON.stringify(event)).not.toMatch(/nobody-here|203\.0\.113|wrong horse/);
    }
  });

  it('holds no name, no address and no password in the table', async () => {
    const { kernel, fail } = await start();
    await fail('Alice');
    await fail('nobody-here');
    const dump = JSON.stringify(await rows(kernel, 'select * from identity_login_failure'));
    expect(dump).not.toMatch(/alice|nobody-here|203\.0\.113|wrong horse/i);
  });

  it('counts a name in any case as one name', async () => {
    const { kernel, fail } = await start();
    await fail('alice');
    await fail(' ALICE ');
    expect(await rows(kernel, 'select failures from identity_login_failure')).toEqual([
      { failures: 2 },
    ]);
  });

  it('is not counted for a good sign-in', async () => {
    const { kernel, login } = await start();
    await login('alice', PASSWORD);
    expect(await rows(kernel, 'select 1 from identity_login_failure')).toEqual([]);
  });

  // M12a sprint 5 findings. The test that stood here said a wrong current password is not counted; that was the gap, not a rule.
  it('counts a wrong current password of a signed-in session as its own context, with the account as the actor, and keeps the throttle', async () => {
    const { kernel, alice, actorOf, identity: id } = await start();
    const actor = await actorOf(alice);
    for (let i = 0; i < 3; i++)
      await expect(
        id.recovery.changePassword(actor, {
          currentPassword: WRONG,
          newPassword: 'another long passphrase 42',
        }),
      ).rejects.toMatchObject({ status: 422 });
    expect(
      await rows(kernel, 'select context, failures, user_id from identity_login_failure'),
    ).toEqual([{ context: 'password-change', failures: 3, user_id: alice.id }]);
    // The same failures are in the throttle, written in the same transaction.
    expect(await rows(kernel, 'select 1 from identity_login_throttle')).not.toEqual([]);
    const windowOf = windowStart(new Date(), WINDOW);
    expect(await id.loginFailures.flush(new Date(windowOf.getTime() + WINDOW * 1000))).toEqual({
      windows: 1,
      failures: 3,
    });
    const [event, ...more] = await events(kernel, 'identity.login.failed@1');
    expect(more).toEqual([]);
    expect(event).toEqual({
      userId: alice.id,
      nameKey: accountKey('alice').slice(0, NAME_KEY_LENGTH),
      context: 'password-change',
      count: 3,
      windowStart: windowOf.toISOString(),
      windowSeconds: WINDOW,
    });
  });

  it('counts a wrong password at a re-authentication in a row of its own, apart from the sign-ins of the same name', async () => {
    const { kernel, fail, alice, actorOf, identity: id } = await start();
    const actor = await actorOf(alice);
    await fail('alice', { now: new Date() });
    await expect(id.accounts.reauthenticate(actor, { password: WRONG })).rejects.toMatchObject({
      status: 422,
    });
    expect(
      await rows(kernel, 'select context, failures from identity_login_failure order by context'),
    ).toEqual([
      { context: 're-authentication', failures: 1 },
      { context: 'sign-in', failures: 1 },
    ]);
    // A right password counts nothing.
    await id.accounts.reauthenticate(actor, { password: PASSWORD });
    expect(await rows(kernel, 'select 1 from identity_login_failure')).toHaveLength(2);
  });

  it('caps the rows of names that are no account per window: past the cap the rest is counted together as one row, with no failure lost', async () => {
    const { kernel, fail, identity: id } = await start({ auditMaxUnknownNames: 10 });
    for (let i = 0; i < 60; i++) await fail(`spray-${i}`);
    // A name that has its row keeps counting alone, also after the cap is reached.
    await fail('spray-0');
    const found = await rows(
      kernel,
      'select key_hash, failures from identity_login_failure order by failures desc, key_hash',
    );
    expect(found).toHaveLength(11);
    expect(found.filter((row) => row.key_hash === 'overflow')).toEqual([
      { key_hash: 'overflow', failures: 50 },
    ]);
    expect(found.reduce((total, row) => total + Number(row.failures), 0)).toBe(61);
    expect(await id.loginFailures.flush(at(WINDOW))).toEqual({ windows: 11, failures: 61 });
    const written = await events(kernel, 'identity.login.failed@1');
    expect(written).toHaveLength(11);
    expect(written.find((event) => event.nameKey === 'overflow')).toMatchObject({
      userId: null,
      count: 50,
      context: 'sign-in',
    });
    expect(JSON.stringify(written)).not.toMatch(/spray-|203\.0\.113/);
  });

  it('does not let a spray of unknown names crowd out an account, and starts again in the next window', async () => {
    const { kernel, fail } = await start({ auditMaxUnknownNames: 10 });
    for (let i = 0; i < 30; i++) await fail(`spray-${i}`);
    await fail('alice');
    await fail('nobody-new', { now: at(WINDOW + 1) });
    const byWindow = await rows(
      kernel,
      'select window_start, key_hash, user_id from identity_login_failure order by window_start, key_hash',
    );
    expect(byWindow.filter((row) => row.user_id !== null)).toHaveLength(1);
    expect(byWindow.filter((row) => row.key_hash === accountKey('nobody-new'))).toHaveLength(1);
    expect(byWindow.filter((row) => row.key_hash === 'overflow')).toHaveLength(1);
  });

  it('rolls the whole counted failure back, the overflow row too, when the throttle cannot be written (rollback)', async () => {
    const { kernel, fail } = await start({ auditMaxUnknownNames: 10 });
    for (let i = 0; i < 12; i++) await fail(`spray-${i}`);
    const before = await rows(
      kernel,
      'select key_hash, failures from identity_login_failure order by key_hash',
    );
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'disk on fire'; end $$;
      create trigger identity_test_fail before update on identity_login_throttle
        for each row execute function identity_test_fail();`);
    // `spray-11` is past the cap: its failure would go to the overflow row, in the transaction of the throttle that fails
    await fail('spray-11');
    await fail('spray-1');
    expect(
      await rows(kernel, 'select key_hash, failures from identity_login_failure order by key_hash'),
    ).toEqual(before);
  });

  it('keeps the count and the throttle record together: when the throttle cannot be written, neither changes (rollback)', async () => {
    const { kernel, fail } = await start();
    await fail('alice');
    const before = await rows(kernel, 'select failures from identity_login_failure');
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'disk on fire'; end $$;
      create trigger identity_test_fail before update on identity_login_throttle
        for each row execute function identity_test_fail();`);
    expect(await fail('alice')).not.toBe('refused');
    expect(await rows(kernel, 'select failures from identity_login_failure')).toEqual(before);
  });

  it('writes no event and keeps the row when the event cannot be written (rollback)', async () => {
    const { kernel, fail, identity: id } = await start();
    await fail('alice');
    await failOutbox(kernel);
    await expect(id.loginFailures.flush(at(WINDOW))).rejects.toThrow();
    expect(await rows(kernel, 'select failures from identity_login_failure')).toEqual([
      { failures: 1 },
    ]);
    expect(await rows(kernel, 'select 1 from kernel_outbox')).toEqual([]);
  });

  it('is safe to run on two nodes at once: every window becomes one event', async () => {
    const { kernel, fail, identity: id } = await start();
    for (let i = 0; i < 12; i++) await fail(`guess-${i}`);
    const done = await Promise.all([
      id.loginFailures.flush(at(WINDOW)),
      id.loginFailures.flush(at(WINDOW)),
    ]);
    expect(done.reduce((total, result) => total + result.windows, 0)).toBe(12);
    expect(await events(kernel, 'identity.login.failed@1')).toHaveLength(12);
  });

  it('takes a large backlog in batches', async () => {
    const { kernel, identity: id } = await start();
    const total = FLUSH_BATCH + 7;
    await kernel.pool.query(
      `insert into identity_login_failure (key_hash, window_start, window_seconds, failures)
       select md5(g::text), $1::timestamptz, $2, 1 from generate_series(1, $3) g`,
      [T0.toISOString(), WINDOW, total],
    );
    expect(await id.loginFailures.flush(at(WINDOW))).toEqual({ windows: total, failures: total });
    expect(await rows(kernel, 'select 1 from identity_login_failure')).toEqual([]);
  });

  it('leaves the throttle as it was: still no lockout, and a good sign-in after failures works', async () => {
    const { login, fail } = await start();
    for (let i = 0; i < 20; i++) await fail('alice');
    expect((await login('alice', PASSWORD)).user.username).toBe('alice');
  });
});
