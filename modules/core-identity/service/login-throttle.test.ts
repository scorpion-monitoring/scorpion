// The throttle on failed password attempts (ASVS 6.3.1; ADR 0026) on real Postgres, with an injected
// clock: exponential delay per account and network, a higher limit per account alone, a ceiling, no
// lockout, the same answers for a name that does not exist, and what a rollback leaves behind.
import { Forbidden, Unauthorized } from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { TooManyRequests } from './errors.ts';
import { delaySeconds, throttleKeys } from './login-throttle.ts';
import { hashPassword } from './password.ts';
import { settingsSchema, type IdentitySettings } from './settings.ts';

const identity = useIdentity();
const PASSWORD = 'correct horse battery';
const WRONG = 'wrong horse battery';
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.9';
const T0 = new Date('2026-10-06T12:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const throttleSettings = {
  freeAttempts: 2,
  freeAttemptsPerAccount: 4,
  baseDelaySeconds: 10,
  maxDelaySeconds: 60,
  forgetAfterSeconds: 3600,
};
const settingsOf = (loginThrottle: Partial<typeof throttleSettings> = {}): IdentitySettings => ({
  get: () =>
    Promise.resolve(
      settingsSchema.parse({ loginThrottle: { ...throttleSettings, ...loginThrottle } }),
    ),
});

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string) =>
  (await kernel.pool.query(sql)).rows as Record<string, unknown>[];

async function start(loginThrottle: Partial<typeof throttleSettings> = {}) {
  const started = await identity.start({ settings: settingsOf(loginThrottle) });
  const user = await makeUser(started.kernel.pool, {
    username: 'alice',
    email: 'alice@example.org',
    status: 'active',
  });
  await makeAuthMethod(started.kernel.pool, user, { passwordHash: await hashPassword(PASSWORD) });
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
  /** What the caller learns from a failed login: the class, the status, the text and the wait. */
  const outcome = (
    promise: Promise<unknown>,
  ): Promise<{ kind: string; status?: number; message?: string; retryAfter?: number }> =>
    promise.then(
      () => ({ kind: 'ok' }),
      (error: unknown) => ({
        kind: (error as Error).constructor.name,
        status: (error as { status?: number }).status,
        message: (error as Error).message,
        retryAfter: (error as { retryAfterSeconds?: number }).retryAfterSeconds,
      }),
    );
  return { ...started, user, login, outcome };
}

describe('delaySeconds', () => {
  const throttle = { ...settingsSchema.parse({}).loginThrottle, ...throttleSettings };
  it.each([
    [1, 0],
    [2, 0], // the free attempts
    [3, 10],
    [4, 20],
    [5, 40],
    [6, 60], // 80, held at the ceiling
    [7, 60],
    [100, 60],
    [100_000, 60], // never an overflow
  ])(
    'after failure %i the key is blocked for %i seconds (2 free, 10 s, ceiling 60 s)',
    (n, seconds) => {
      expect(delaySeconds(n, 2, throttle)).toBe(seconds);
    },
  );
});

describe('throttleKeys', () => {
  it('keys a name in any case and with spaces alike, and the address makes a second key', () => {
    expect(throttleKeys(' Alice ', IP)).toEqual(throttleKeys('alice', IP));
    expect(throttleKeys('alice', IP)).toHaveLength(2);
    expect(throttleKeys('alice')).toHaveLength(1);
    expect(throttleKeys('alice', IP)[1]).toBe(throttleKeys('alice')[0]);
    expect(throttleKeys('alice', IP)[0]).not.toBe(throttleKeys('alice', OTHER_IP)[0]);
  });
});

describe('failed logins', () => {
  it('slow an account down after the free attempts, with Retry-After, and double the delay up to the ceiling [ASVS-6.3.1]', async () => {
    const { login, outcome } = await start();
    // Two free failures, then the third blocks the account on this network for 10 seconds.
    expect((await outcome(login('alice', WRONG))).kind).toBe('Unauthorized');
    expect((await outcome(login('alice', WRONG))).kind).toBe('Unauthorized');
    expect((await outcome(login('alice', WRONG))).kind).toBe('Unauthorized');

    const waits: (number | undefined)[] = [];
    let clock = 0;
    for (let n = 0; n < 5; n += 1) {
      const blocked = await outcome(login('alice', WRONG, { now: at(clock) }));
      expect(blocked).toMatchObject({ kind: 'TooManyRequests', status: 429 });
      waits.push(blocked.retryAfter);
      clock += blocked.retryAfter!; // wait it out exactly, then fail again
      expect((await outcome(login('alice', WRONG, { now: at(clock) }))).kind).toBe('Unauthorized');
    }
    expect(waits).toEqual([10, 20, 40, 60, 60]);
  });

  it('answer 429 before the password is looked at: the right password gets 429 during a block, and no session', async () => {
    const { kernel, login, outcome } = await start();
    for (let n = 0; n < 3; n += 1) await outcome(login('alice', WRONG));

    expect(await outcome(login('alice', PASSWORD, { now: at(5) }))).toMatchObject({
      kind: 'TooManyRequests',
      retryAfter: 5,
    });
    expect(await rows(kernel, 'select 1 from identity_session')).toEqual([]);
  });

  it('do not extend a block that is already running: waiting is all that works', async () => {
    const { kernel, login, outcome } = await start();
    for (let n = 0; n < 3; n += 1) await outcome(login('alice', WRONG));
    const before = await rows(
      kernel,
      'select key_hash, failures, blocked_until from identity_login_throttle order by key_hash',
    );

    for (let n = 0; n < 6; n += 1) {
      expect((await outcome(login('alice', WRONG, { now: at(n) }))).kind).toBe('TooManyRequests');
    }
    expect(
      await rows(
        kernel,
        'select key_hash, failures, blocked_until from identity_login_throttle order by key_hash',
      ),
    ).toEqual(before);
  });

  it('never lock an account: the victim logs in once the delay is over, and the counters are forgotten', async () => {
    const { kernel, login, outcome } = await start();
    for (let n = 0; n < 8; n += 1) await outcome(login('alice', WRONG, { now: at(n * 100) }));

    // The eighth failure came at 700 s: the account waits at the ceiling, and it is only a wait.
    const blocked = await outcome(login('alice', PASSWORD, { now: at(701) }));
    expect(blocked).toMatchObject({ kind: 'TooManyRequests', retryAfter: 59 });
    await expect(
      login('alice', PASSWORD, { now: at(701 + blocked.retryAfter! + 1) }),
    ).resolves.toMatchObject({
      user: { username: 'alice' },
    });
    expect(await rows(kernel, 'select 1 from identity_login_throttle')).toEqual([]);
  });

  it('count per account and network: an attacker blocked on one network does not block the person on another', async () => {
    const { login, outcome } = await start();
    for (let n = 0; n < 3; n += 1) await outcome(login('alice', WRONG, { clientIp: IP }));
    expect((await outcome(login('alice', PASSWORD, { clientIp: IP }))).kind).toBe(
      'TooManyRequests',
    );

    await expect(login('alice', PASSWORD, { clientIp: OTHER_IP })).resolves.toMatchObject({
      user: { username: 'alice' },
    });
  });

  it('count per account alone as well, with a higher limit: many networks together still slow the account', async () => {
    const { login, outcome } = await start();
    // Four free failures for the account from four networks; each network used one attempt.
    for (let n = 1; n <= 4; n += 1) {
      expect((await outcome(login('alice', WRONG, { clientIp: `192.0.2.${n}` }))).kind).toBe(
        'Unauthorized',
      );
    }
    // The fifth is over the account's limit and blocks it for everybody.
    expect((await outcome(login('alice', WRONG, { clientIp: '192.0.2.5' }))).kind).toBe(
      'Unauthorized',
    );
    const blocked = await outcome(login('alice', PASSWORD, { clientIp: '192.0.2.99' }));
    expect(blocked).toMatchObject({ kind: 'TooManyRequests', retryAfter: 10 });
    // And it is only a wait.
    await expect(
      login('alice', PASSWORD, { clientIp: '192.0.2.99', now: at(11) }),
    ).resolves.toMatchObject({ user: { username: 'alice' } });
  });

  it('answer the same for a name that does not exist: class, status, text and wait [ASVS-6.3.1]', async () => {
    const { login, outcome } = await start();
    const run = async (username: string) => {
      const seen = [];
      for (let n = 0; n < 4; n += 1)
        seen.push(await outcome(login(username, WRONG, { now: at(n) })));
      seen.push(await outcome(login(username, PASSWORD, { now: at(5) })));
      return seen;
    };
    const known = await run('alice');
    const unknown = await run('nobody-here');
    expect(unknown).toEqual(known);
    expect(known.map((o) => o.kind)).toEqual([
      'Unauthorized',
      'Unauthorized',
      'Unauthorized',
      'TooManyRequests',
      'TooManyRequests',
    ]);
  });

  it('cost about the same for a name that exists and one that does not', async () => {
    // Generous limits, so nothing is blocked and every attempt does the whole work.
    const { login, outcome } = await start({
      freeAttempts: 1000,
      freeAttemptsPerAccount: 1000,
    });
    const time = async (username: string, n: number) => {
      const started = performance.now();
      await outcome(login(username, WRONG, { clientIp: `192.0.2.${n % 250}` }));
      return performance.now() - started;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let n = 0; n < 11; n += 1) {
      known.push(await time('alice', n));
      unknown.push(await time('nobody-here', n));
    }
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    const ratio = median(known) / median(unknown);
    expect(ratio).toBeGreaterThan(1 / 3);
    expect(ratio).toBeLessThan(3);
  });

  it('are stored as hashes: no name and no address in the table', async () => {
    const { kernel, login, outcome } = await start();
    await outcome(login('alice', WRONG));
    await outcome(login('Mallory-Not-A-User', WRONG, { clientIp: OTHER_IP }));
    const found = await rows(kernel, 'select * from identity_login_throttle');
    expect(found.length).toBe(4);
    const dump = JSON.stringify(found).toLowerCase();
    for (const secret of ['alice', 'mallory', IP, OTHER_IP, WRONG]) {
      expect(dump).not.toContain(secret.toLowerCase());
    }
    for (const row of found) expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('start counting again after a quiet hour', async () => {
    const { kernel, login, outcome } = await start();
    for (let n = 0; n < 3; n += 1) await outcome(login('alice', WRONG));
    expect((await outcome(login('alice', WRONG, { now: at(3601) }))).kind).toBe('Unauthorized');
    expect(
      await rows(kernel, 'select failures, blocked_until from identity_login_throttle'),
    ).toEqual([
      { failures: 1, blocked_until: null },
      { failures: 1, blocked_until: null },
    ]);
  });

  it('are not counted for an account that is waiting for approval and gave the right password', async () => {
    const { kernel, login, outcome } = await start();
    const pending = await makeUser(kernel.pool, { username: 'bob', status: 'pending' });
    await makeAuthMethod(kernel.pool, pending, { passwordHash: await hashPassword(PASSWORD) });

    for (let n = 0; n < 5; n += 1) {
      expect((await outcome(login('bob', PASSWORD))).kind).toBe('Forbidden');
    }
    expect(await rows(kernel, 'select 1 from identity_login_throttle')).toEqual([]);
  });

  it('are counted for a rejected account like any other refusal', async () => {
    const { kernel, login, outcome } = await start();
    const rejected = await makeUser(kernel.pool, { username: 'dave', status: 'rejected' });
    await makeAuthMethod(kernel.pool, rejected, { passwordHash: await hashPassword(PASSWORD) });
    expect((await outcome(login('dave', PASSWORD))).kind).toBe('Unauthorized');
    expect(await rows(kernel, 'select 1 from identity_login_throttle')).toHaveLength(2);
  });

  it('forget the pair and the account on a good login, and leave other names alone', async () => {
    const { kernel, login, outcome } = await start();
    await outcome(login('alice', WRONG));
    await outcome(login('bob-the-unknown', WRONG));
    expect(await rows(kernel, 'select 1 from identity_login_throttle')).toHaveLength(4);
    await login('alice', PASSWORD);
    expect(await rows(kernel, 'select 1 from identity_login_throttle')).toHaveLength(2);
  });

  describe('rollback', () => {
    it('leaves both counters as they were when blocking the account fails midway', async () => {
      const { kernel, login, outcome } = await start();
      await outcome(login('alice', WRONG));
      await outcome(login('alice', WRONG));
      const before = await rows(
        kernel,
        'select key_hash, failures, blocked_until from identity_login_throttle order by key_hash',
      );
      expect(before.map((row) => row.failures)).toEqual([2, 2]);
      await kernel.pool.query(`
        create function identity_test_fail() returns trigger language plpgsql as
          $$ begin raise exception 'disk on fire'; end $$;
        create trigger identity_test_fail before update of blocked_until on identity_login_throttle
          for each row execute function identity_test_fail();`);

      // The third failure raises the counters and then sets a block; the block cannot be written.
      const failed = await outcome(login('alice', WRONG));
      expect(failed.kind).not.toBe('Unauthorized');
      expect(failed.kind).not.toBe('TooManyRequests');
      expect(
        await rows(
          kernel,
          'select key_hash, failures, blocked_until from identity_login_throttle order by key_hash',
        ),
      ).toEqual(before);
    });

    it('starts no session and keeps the counters when forgetting them fails on a good login', async () => {
      const { kernel, login, outcome } = await start();
      await outcome(login('alice', WRONG));
      await kernel.pool.query(`
        create function identity_test_fail() returns trigger language plpgsql as
          $$ begin raise exception 'disk on fire'; end $$;
        create trigger identity_test_fail before delete on identity_login_throttle
          for each row execute function identity_test_fail();`);

      const failed = await outcome(login('alice', PASSWORD));
      expect(failed.kind).not.toBe('ok');
      expect(await rows(kernel, 'select 1 from identity_session')).toEqual([]);
      expect(await rows(kernel, 'select 1 from identity_login_throttle')).toHaveLength(2);
      expect(await rows(kernel, 'select last_login_at from identity_auth_method')).toEqual([
        { last_login_at: null },
      ]);
    });
  });
});

describe('the password checks of a signed-in session', () => {
  it('are throttled like a login: guessing the current password through a stolen session gets a wait', async () => {
    const { identity: id, user, actorOf } = await start();
    const actor = await actorOf(user);

    // Only the limit of the account alone applies here (4 free attempts in these settings).
    for (let n = 0; n < 4; n += 1) {
      await expect(
        id.recovery.changePassword(actor, {
          currentPassword: WRONG,
          newPassword: 'another long passphrase',
        }),
      ).rejects.toMatchObject({ status: 422 });
    }
    // The fifth failure blocks the account; now even the right password waits.
    await expect(
      id.recovery.changePassword(actor, {
        currentPassword: WRONG,
        newPassword: 'another long passphrase',
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      id.recovery.changePassword(actor, {
        currentPassword: PASSWORD,
        newPassword: 'another long passphrase',
      }),
    ).rejects.toBeInstanceOf(TooManyRequests);
    await expect(id.accounts.reauthenticate(actor, { password: PASSWORD })).rejects.toBeInstanceOf(
      TooManyRequests,
    );
  });
});

describe('cleanup', () => {
  it('deletes counters that are forgotten and block nobody, and keeps a block that is still running', async () => {
    const { kernel, identity: id } = await start();
    await kernel.pool.query(`
      insert into identity_login_throttle (key_hash, failures, last_failure_at, blocked_until) values
        ('old-idle', 3, '2026-10-06T08:00:00Z', null),
        ('old-block-over', 9, '2026-10-06T08:00:00Z', '2026-10-06T08:15:00Z'),
        ('old-block-running', 9, '2026-10-06T08:00:00Z', '2026-10-07T08:00:00Z'),
        ('recent', 1, '2026-10-06T11:59:00Z', null)`);

    const result = await id.cleanup.run(T0);

    expect(result.loginThrottles).toBe(2);
    expect(
      (await rows(kernel, 'select key_hash from identity_login_throttle order by 1')).map(
        (row) => row.key_hash,
      ),
    ).toEqual(['old-block-running', 'recent']);
  });
});

describe('the setting', () => {
  it('has the documented defaults and refuses a ceiling below the first delay', () => {
    expect(settingsSchema.parse({}).loginThrottle).toEqual({
      freeAttempts: 5,
      freeAttemptsPerAccount: 20,
      baseDelaySeconds: 15,
      maxDelaySeconds: 900,
      forgetAfterSeconds: 3600,
    });
    expect(() =>
      settingsSchema.parse({ loginThrottle: { baseDelaySeconds: 60, maxDelaySeconds: 30 } }),
    ).toThrow();
    expect(() =>
      settingsSchema.parse({ loginThrottle: { freeAttempts: 10, freeAttemptsPerAccount: 5 } }),
    ).toThrow();
    expect(() => settingsSchema.parse({ loginThrottle: { unknown: 1 } })).toThrow();
  });

  it('keeps the Unauthorized and Forbidden classes of the login untouched', () => {
    expect(new Unauthorized().status).toBe(401);
    expect(new Forbidden().status).toBe(403);
  });
});
