// The hourly cleanup on real Postgres with a controllable clock: what it removes, what it must not
// touch, what a purge takes with it and what it frees, and the rollback of a failed run.
import { randomUUID } from 'node:crypto';
import { defineModule, listJobRuns } from '@scorpion/kernel';
import {
  makeAuthMethod,
  makeRoleAssignment,
  makeSession,
  makeToken,
  makeUser,
  type Queryable,
} from '@scorpion/testing';
import { describe, expect, it, vi } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { DEFAULT_RETENTION, daysToMs } from './settings.ts';

const PURGE_RETENTION_MS = daysToMs(DEFAULT_RETENTION.purgeAfterDays);
const TOKEN_GRACE_MS = daysToMs(DEFAULT_RETENTION.tokenGraceDays);
const PURGE_BATCH = DEFAULT_RETENTION.purgeBatch;

const identity = useIdentity();
const DAY = 24 * 3600 * 1000;

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
const count = async (kernel: { pool: Pool }, table: string) =>
  rows(kernel, `select count(*)::int as n from ${table}`).then((r) => r[0]!.n as number);
const ago = (ms: number, from = Date.now()) => new Date(from - ms);

async function start(options: Parameters<typeof identity.start>[0] = {}) {
  const started = await identity.start(options);
  return { ...started, cleanup: started.identity.cleanup };
}
const insertLoginState = (kernel: { pool: Pool }, expiresAt: Date, linkUserId?: string) =>
  kernel.pool.query(
    `insert into identity_login_state (id, provider_id, state_hash, nonce_hash, binding_hash, link_user_id, expires_at)
     values ($1, 'stub', $2, 'n', 'b', $3, $4)`,
    [randomUUID(), randomUUID(), linkUserId ?? null, expiresAt],
  );
const insertFirstRun = (kernel: { pool: Pool }, expiresAt: Date) =>
  kernel.pool.query(
    'insert into identity_first_run_token (id, secret_hash, expires_at) values ($1, $2, $3)',
    [randomUUID(), randomUUID(), expiresAt],
  );

describe('what it removes', () => {
  it('removes expired and revoked sessions, expired login states, spent mail tokens and expired first-run tokens', async () => {
    const { kernel, cleanup } = await start();
    await kernel.pool.query('delete from identity_first_run_token'); // the one issued at start-up
    const user = await makeUser(kernel.pool);
    await makeSession(kernel.pool, user, { expiresAt: ago(DAY) });
    await makeSession(kernel.pool, user, { revoked: true });
    await insertLoginState(kernel, ago(60_000));
    await insertFirstRun(kernel, ago(60_000));
    await kernel.pool.query(
      `insert into identity_mail_token (id, user_id, purpose, secret_hash, expires_at, used_at) values
         ($1, $2, 'password-reset', 'used', now() + interval '1 hour', now()),
         ($3, $2, 'password-reset', 'expired', now() - interval '1 minute', null)`,
      [randomUUID(), user.id, randomUUID()],
    );

    expect(await cleanup.run()).toEqual({
      sessions: 2,
      loginStates: 1,
      mailTokens: 2,
      accessTokens: 0,
      firstRunTokens: 1,
      purgedUsers: 0,
    });
    for (const table of [
      'identity_session',
      'identity_login_state',
      'identity_mail_token',
      'identity_first_run_token',
    ]) {
      expect(await count(kernel, table)).toBe(0);
    }
    expect(await count(kernel, 'identity_user')).toBe(1);
  });

  it('removes an access token a month after it expired or was revoked, and not before', async () => {
    const { kernel, cleanup } = await start();
    const user = await makeUser(kernel.pool);
    const expired = await makeToken(kernel.pool, user, { expiresAt: ago(TOKEN_GRACE_MS + DAY) });
    const recentlyExpired = await makeToken(kernel.pool, user, { expiresAt: ago(DAY) });
    const revoked = await makeToken(kernel.pool, user, { revoked: true });
    await kernel.pool.query(
      "update identity_token set revoked_at = now() - interval '31 days' where id = $1",
      [(await makeToken(kernel.pool, user, { revoked: true })).row.id],
    );

    expect((await cleanup.run()).accessTokens).toBe(2); // the long-expired one and the long-revoked one
    const left = await rows(kernel, 'select id from identity_token');
    expect(left.map((r) => r.id).sort()).toEqual([recentlyExpired.row.id, revoked.row.id].sort());
    expect(expired.row.id).toBeDefined();
  });
});

describe('what it must not touch', () => {
  it('leaves every live row alone', async () => {
    const { kernel, cleanup } = await start();
    const user = await makeUser(kernel.pool);
    const other = await makeUser(kernel.pool, { status: 'pending' });
    await makeAuthMethod(kernel.pool, user);
    await makeSession(kernel.pool, user);
    await makeToken(kernel.pool, user);
    await makeToken(kernel.pool, user, { expiresAt: new Date(Date.now() + DAY) });
    await insertLoginState(kernel, new Date(Date.now() + 5 * 60_000), user.id);
    await insertFirstRun(kernel, new Date(Date.now() + 3600_000));
    await kernel.pool.query(
      `insert into identity_mail_token (id, user_id, purpose, secret_hash, expires_at)
       values ($1, $2, 'password-reset', 'live', now() + interval '1 hour')`,
      [randomUUID(), user.id],
    );
    // A user deleted a week ago is inside the retention period, and an old live user is never purged.
    const recent = await makeUser(kernel.pool, { deleted: true, status: 'rejected' });
    await kernel.pool.query("update identity_user set created_at = now() - interval '5 years'");
    const before = await Promise.all(
      [
        'identity_user',
        'identity_auth_method',
        'identity_session',
        'identity_token',
        'identity_login_state',
        'identity_first_run_token',
        'identity_mail_token',
      ].map(async (table) => [table, await count(kernel, table)] as const),
    );

    expect(await cleanup.run()).toEqual({
      sessions: 0,
      loginStates: 0,
      mailTokens: 0,
      accessTokens: 0,
      firstRunTokens: 0,
      purgedUsers: 0,
    });
    for (const [table, n] of before) expect(await count(kernel, table)).toBe(n);
    expect(other.id).not.toBe(recent.id);
  });

  it('works on an empty database', async () => {
    const { cleanup } = await start();
    expect(await cleanup.run()).toMatchObject({ purgedUsers: 0, sessions: 0 });
  });
});

describe('the purge of soft-deleted accounts', () => {
  async function deletedAt(
    kernel: { pool: Queryable },
    username: string,
    daysAgo: number,
    status = 'rejected',
  ) {
    const user = await makeUser(kernel.pool, {
      username,
      email: `${username}@example.org`,
      status: status as 'rejected',
    });
    await makeAuthMethod(kernel.pool, user);
    await kernel.pool.query('update identity_user set deleted_at = $2 where id = $1', [
      user.id,
      ago(daysAgo * DAY),
    ]);
    return user;
  }

  it('removes an account after the retention period, with everything that hangs on it, and emits the event', async () => {
    const { kernel, cleanup } = await start();
    const gone = await deletedAt(kernel, 'gone', 31);
    const kept = await deletedAt(kernel, 'kept', 29);
    await makeSession(kernel.pool, gone, { revoked: true });
    await makeToken(kernel.pool, gone);
    await insertLoginState(kernel, new Date(Date.now() + 60_000), gone.id);
    await kernel.pool.query(
      `insert into identity_mail_token (id, user_id, purpose, secret_hash, expires_at)
       values ($1, $2, 'password-reset', 'x', now() + interval '1 hour')`,
      [randomUUID(), gone.id],
    );

    expect((await cleanup.run()).purgedUsers).toBe(1);

    expect(
      (await rows(kernel, 'select username from identity_user')).map((r) => r.username),
    ).toEqual(['kept']);
    for (const table of [
      'identity_session',
      'identity_token',
      'identity_login_state',
      'identity_mail_token',
    ]) {
      expect(await count(kernel, table)).toBe(0);
    }
    expect(await rows(kernel, 'select user_id from identity_auth_method')).toEqual([
      { user_id: kept.id },
    ]);
    expect(
      await rows(kernel, "select payload from kernel_outbox where name = 'identity.user.purged@1'"),
    ).toEqual([{ payload: { userId: gone.id, username: 'gone' } }]);
  });

  it('keeps a username and an address reserved until the purge, and frees both after it', async () => {
    const { kernel, identity: id, cleanup } = await start();
    await deletedAt(kernel, 'applicant', 40);
    const again = {
      username: 'applicant',
      email: 'applicant@example.org',
      auth: { provider: 'local' as const, password: 'correct horse battery' },
    };
    // Not yet purged (the run has not happened): still reserved.
    await expect(id.users.createUser(again)).rejects.toThrow(/already/);
    await cleanup.run();
    await expect(id.users.createUser(again)).resolves.toMatchObject({
      username: 'applicant',
      status: 'pending',
    });
  });

  it('purges a rejected applicant like any other soft-deleted account, but never a live one', async () => {
    const { kernel, cleanup } = await start();
    await deletedAt(kernel, 'rejected-one', 90, 'rejected');
    await deletedAt(kernel, 'deleted-active', 90, 'active');
    const live = await makeUser(kernel.pool, { username: 'live-user' });
    expect((await cleanup.run()).purgedUsers).toBe(2);
    expect(
      (await rows(kernel, 'select username from identity_user')).map((r) => r.username),
    ).toEqual([live.username]);
  });

  it('takes at most one batch per run and finishes on the next', async () => {
    const { kernel, cleanup } = await start();
    const old = ago(PURGE_RETENTION_MS + DAY);
    await kernel.pool.query(
      `insert into identity_user (id, username, status, deleted_at)
       select gen_random_uuid(), 'bulk-' || g, 'rejected', $1 from generate_series(1, $2) g`,
      [old, PURGE_BATCH + 5],
    );
    expect((await cleanup.run()).purgedUsers).toBe(PURGE_BATCH);
    expect((await cleanup.run()).purgedUsers).toBe(5);
    expect(await count(kernel, 'identity_user')).toBe(0);
  });
});

describe('a failed run', () => {
  it('changes nothing: the expired rows and the accounts are all still there (rollback)', async () => {
    const { kernel, cleanup } = await start();
    const user = await makeUser(kernel.pool, {
      username: 'doomed',
      deleted: true,
      status: 'rejected',
    });
    await kernel.pool.query("update identity_user set deleted_at = now() - interval '60 days'");
    await makeSession(kernel.pool, user, { expiresAt: ago(DAY) });
    await insertLoginState(kernel, ago(60_000));
    await kernel.pool.query(`
      create function identity_test_no_purge() returns trigger language plpgsql as
        $$ begin raise exception 'purge refused'; end $$;
      create trigger identity_test_no_purge before delete on identity_user
        for each row execute function identity_test_no_purge();`);

    await expect(cleanup.run()).rejects.toThrow();

    expect(await count(kernel, 'identity_session')).toBe(1);
    expect(await count(kernel, 'identity_login_state')).toBe(1);
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(
      await rows(kernel, "select 1 from kernel_outbox where name = 'identity.user.purged@1'"),
    ).toEqual([]);
  });
});

describe('the job', () => {
  // A module that depends on core.identity may enqueue its jobs; the cron tick is hourly, so the
  // test asks for a run instead of waiting for it.
  const enqueuer = defineModule<{ run(): Promise<string> }>({
    id: 'test.enqueuer',
    version: '1.0.0',
    services: (ctx) => ({ run: () => ctx.jobs.enqueue('core.identity.cleanup') }),
  });

  it('is declared hourly with retries, and a run through the jobs facade cleans up', async () => {
    const { kernel, manifest } = await start({
      jobs: { pollingIntervalSeconds: 0.5 },
      extraModule: { id: 'test.enqueuer', manifest: enqueuer },
    });
    expect(manifest.jobs).toEqual([
      expect.objectContaining({
        name: 'core.identity.cleanup',
        schedule: '0 * * * *',
        retry: { limit: 2, delaySeconds: 60 },
        timeoutSeconds: 300,
      }) as unknown,
    ]);
    const user = await makeUser(kernel.pool);
    await makeSession(kernel.pool, user, { expiresAt: ago(DAY) });
    const live = await makeSession(kernel.pool, user);

    await kernel.startWorkers();
    await (kernel.services.get('test.enqueuer') as { run(): Promise<string> }).run();
    await vi.waitFor(
      async () => {
        const runs = await listJobRuns(kernel.db, { jobName: 'core.identity.cleanup' });
        expect(runs.map((run) => run.status)).toEqual(['succeeded']);
      },
      { timeout: 30_000, interval: 250 },
    );
    expect((await rows(kernel, 'select id from identity_session')).map((r) => r.id)).toEqual([
      live.row.id,
    ]);
  }, 60_000);
});

describe('role assignments and the purge (ADR 0014)', () => {
  const assignments = (kernel: { pool: Pool }) =>
    rows(kernel, 'select user_id from authz_role_assignment order by user_id');

  it('removes the role assignments of a purged account, and only theirs', async () => {
    const { kernel, cleanup } = await start();
    const gone = await makeUser(kernel.pool, {
      username: 'gone',
      deleted: true,
      status: 'rejected',
    });
    const kept = await makeUser(kernel.pool, { username: 'kept' });
    await kernel.pool.query(
      "update identity_user set deleted_at = now() - interval '60 days' where id = $1",
      [gone.id],
    );
    await makeRoleAssignment(kernel.pool, gone, 'user');
    await makeRoleAssignment(kernel.pool, gone, 'reviewer');
    await makeRoleAssignment(kernel.pool, kept, 'user');
    // A soft-deleted account within the retention period keeps its roles too.
    const recent = await makeUser(kernel.pool, {
      username: 'recent',
      deleted: true,
      status: 'rejected',
    });
    await makeRoleAssignment(kernel.pool, recent, 'user');

    expect((await cleanup.run()).purgedUsers).toBe(1);

    expect((await assignments(kernel)).map((r) => r.user_id).sort()).toEqual(
      [kept.id, recent.id].sort(),
    );
    // No event for authz: the purge calls it directly (authz cannot subscribe, ADR 0003).
    expect(await rows(kernel, "select 1 from kernel_outbox where name like 'authz.%'")).toEqual([]);
  });

  it('is not blocked by role assignments: there is no foreign key from them to the user', async () => {
    const { kernel, cleanup } = await start();
    const gone = await makeUser(kernel.pool, { deleted: true, status: 'rejected' });
    await kernel.pool.query("update identity_user set deleted_at = now() - interval '60 days'");
    await makeRoleAssignment(kernel.pool, gone, 'admin');
    await expect(cleanup.run()).resolves.toMatchObject({ purgedUsers: 1 });
    expect(await assignments(kernel)).toEqual([]);
  });

  it('rolls the removal of the assignments back together with a purge that fails', async () => {
    const { kernel, cleanup } = await start();
    const doomed = await makeUser(kernel.pool, {
      username: 'doomed',
      deleted: true,
      status: 'rejected',
    });
    await kernel.pool.query("update identity_user set deleted_at = now() - interval '60 days'");
    await makeRoleAssignment(kernel.pool, doomed, 'user');
    await kernel.pool.query(`
      create function identity_test_no_purge() returns trigger language plpgsql as
        $$ begin raise exception 'purge refused'; end $$;
      create trigger identity_test_no_purge before delete on identity_user
        for each row execute function identity_test_no_purge();`);

    await expect(cleanup.run()).rejects.toThrow();

    expect(await assignments(kernel)).toEqual([{ user_id: doomed.id }]);
    expect(await count(kernel, 'identity_user')).toBe(1);
  });

  it('rolls the purge back when the assignments cannot be removed', async () => {
    const { kernel, cleanup } = await start();
    const doomed = await makeUser(kernel.pool, {
      username: 'doomed',
      deleted: true,
      status: 'rejected',
    });
    await kernel.pool.query("update identity_user set deleted_at = now() - interval '60 days'");
    await makeRoleAssignment(kernel.pool, doomed, 'user');
    await kernel.pool.query(`
      create function identity_test_keep() returns trigger language plpgsql as
        $$ begin raise exception 'assignment stays'; end $$;
      create trigger identity_test_keep before delete on authz_role_assignment
        for each row execute function identity_test_keep();`);

    await expect(cleanup.run()).rejects.toThrow();

    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(await assignments(kernel)).toEqual([{ user_id: doomed.id }]);
    expect(
      await rows(kernel, "select 1 from kernel_outbox where name = 'identity.user.purged@1'"),
    ).toEqual([]);
  });
});
