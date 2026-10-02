import { Conflict, Invalid, Unauthorized } from '@scorpion/contracts';
import { makeRoleAssignment, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentity } from '../test/harness.ts';
import { verifyPassword } from './password.ts';

const identity = useIdentity();

const admin = { username: 'root', email: 'root@example.org', password: 'correct horse battery' };
type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];

async function start(options: Parameters<typeof identity.start>[0] = {}) {
  const shown: string[] = [];
  const started = await identity.start({ announce: (text) => shown.push(text), ...options });
  // Start-up (system.ready) has already issued a token on this empty database; start from nothing.
  await started.kernel.pool.query('delete from identity_first_run_token');
  shown.length = 0;
  return { ...started, shown, bootstrap: started.identity.bootstrap };
}
/** Who holds the Admin role, with who gave it (`null`: the system). */
const adminHolders = (kernel: { pool: Pool }) =>
  rows(
    kernel,
    `select u.username, a.assigned_by from authz_role_assignment a
       join authz_role r on r.id = a.role_id and r.key = 'admin'
       left join identity_user u on u.id = a.user_id order by u.username`,
  );
const tokenIn = (shown: string[]) => /sfr_[A-Za-z0-9_-]{43}/.exec(shown.join('\n'))?.[0];

describe('createAdmin', () => {
  it('creates an active user with a password and the Admin role, and emits events without the password', async () => {
    const { kernel, bootstrap, identity: id, authz } = await start();
    const created = await bootstrap.createAdmin(admin);

    expect(created).toMatchObject({ username: 'root', status: 'active', emailVerified: false });
    const [row] = await rows(kernel, 'select status from identity_user');
    expect(row).toEqual({ status: 'active' });
    // Given by the system: no human made this administrator.
    expect(await adminHolders(kernel)).toEqual([{ username: 'root', assigned_by: null }]);
    await expect(
      authz.require(
        { kind: 'user', userId: created.id, username: 'root', roles: [], via: 'session' },
        'core.authz.role.manage',
      ),
    ).resolves.toBeUndefined();
    const [method] = await rows(kernel, 'select password_hash from identity_auth_method');
    expect(await verifyPassword(method!.password_hash as string, admin.password)).toBe(true);
    expect(await id.users.findByUsername('root')).toMatchObject({ id: created.id });

    const events = await rows(kernel, 'select name, payload from kernel_outbox order by name');
    expect(events).toEqual([
      {
        name: 'authz.role.assigned@1',
        payload: { userId: created.id, roleKey: 'admin', actorId: null },
      },
      {
        name: 'identity.admin.created@1',
        payload: { userId: created.id, username: 'root', origin: 'cli' },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(admin.password);
  });

  it('gives the Admin role to the user it creates and to nobody else', async () => {
    const { kernel, bootstrap } = await start();
    await makeUser(kernel.pool);
    await bootstrap.createAdmin(admin);
    expect(await adminHolders(kernel)).toEqual([{ username: 'root', assigned_by: null }]);
    expect(await rows(kernel, 'select 1 from identity_user')).toHaveLength(2);
  });

  it.each([
    ['no password', { username: 'root', email: 'root@example.org' }],
    ['a short password', { ...admin, password: 'short' }],
    ['a bad email address', { ...admin, email: 'nope' }],
    ['an upper-case username', { ...admin, username: 'Root' }],
    ['no email address', { username: 'root', password: admin.password }],
    ['a field that is not part of it', { ...admin, status: 'pending' }],
    ['something that is not an object', 'root'],
  ])('refuses %s with Invalid and writes nothing', async (_name, input) => {
    const { kernel, bootstrap } = await start();
    await expect(bootstrap.createAdmin(input)).rejects.toBeInstanceOf(Invalid);
    expect(await rows(kernel, 'select 1 from identity_user')).toEqual([]);
  });

  it('refuses a taken name or address with Conflict', async () => {
    const { bootstrap } = await start();
    await bootstrap.createAdmin(admin);
    await expect(bootstrap.createAdmin(admin)).rejects.toBeInstanceOf(Conflict);
    await expect(
      bootstrap.createAdmin({ ...admin, username: 'other' }), // same address
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('rolls back the user, the Admin role and the end of the token when an event cannot be written', async () => {
    const { kernel, bootstrap } = await start();
    await bootstrap.issueFirstRunToken();
    await failOutbox(kernel);

    await expect(bootstrap.createAdmin(admin)).rejects.toThrow();

    expect(await rows(kernel, 'select 1 from identity_user')).toEqual([]);
    expect(await rows(kernel, 'select 1 from identity_auth_method')).toEqual([]);
    expect(await rows(kernel, 'select 1 from authz_role_assignment')).toEqual([]);
    expect(await rows(kernel, 'select redeemed_at from identity_first_run_token')).toEqual([
      { redeemed_at: null },
    ]);
  });

  it('rolls the user back when the Admin role cannot be given', async () => {
    const { kernel, bootstrap } = await start();
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'assignment on fire'; end $$;
      create trigger identity_test_fail before insert on authz_role_assignment
        for each row execute function identity_test_fail();`);
    await expect(bootstrap.createAdmin(admin)).rejects.toThrow();
    expect(await rows(kernel, 'select 1 from identity_user')).toEqual([]);
    expect(await rows(kernel, 'select 1 from identity_auth_method')).toEqual([]);
    expect(await rows(kernel, 'select 1 from kernel_outbox')).toEqual([]);
  });

  it('ends an outstanding first-run token', async () => {
    const { kernel, bootstrap, shown } = await start();
    await bootstrap.issueFirstRunToken();
    const token = tokenIn(shown)!;
    await bootstrap.createAdmin(admin);
    expect(await rows(kernel, 'select redeemed_at from identity_first_run_token')).toEqual([
      { redeemed_at: expect.any(Date) as unknown },
    ]);
    await expect(
      bootstrap.redeemFirstRunToken({
        ...admin,
        username: 'second',
        email: 'b@example.org',
        token,
      }),
    ).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe('issueFirstRunToken', () => {
  it('shows a token once, stores only its hash, and gives it an expiry', async () => {
    const { kernel, bootstrap, shown } = await start();
    expect(await bootstrap.issueFirstRunToken()).toBe(true);

    expect(shown).toHaveLength(1);
    const token = tokenIn(shown)!;
    expect(token).toBeDefined();
    expect(shown.join('').split(token)).toHaveLength(2); // exactly once
    const [row] = await rows(kernel, 'select * from identity_first_run_token');
    expect(row!.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token.slice(4));
    const ttl = (row!.expires_at as Date).getTime() - (row!.created_at as Date).getTime();
    expect(ttl).toBe(60 * 60 * 1000);
  });

  it('shows nothing a second time while a token is outstanding, and says so without the secret', async () => {
    const { bootstrap, shown } = await start();
    await bootstrap.issueFirstRunToken();
    expect(await bootstrap.issueFirstRunToken()).toBe(false);
    expect(shown).toHaveLength(1);
  });

  it('issues one token when two processes start together', async () => {
    const { kernel, bootstrap, shown } = await start();
    const results = await Promise.all([1, 2, 3, 4].map(() => bootstrap.issueFirstRunToken()));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(shown).toHaveLength(1);
    expect(await rows(kernel, 'select 1 from identity_first_run_token')).toHaveLength(1);
  });

  it('issues a new one once the old one has expired', async () => {
    const { bootstrap, shown } = await start({ firstRunTtlMs: 1 });
    await bootstrap.issueFirstRunToken();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await bootstrap.issueFirstRunToken()).toBe(true);
    expect(shown).toHaveLength(2);
    expect(tokenIn([shown[0]!])).not.toBe(tokenIn([shown[1]!]));
  });

  it('issues nothing when somebody holds the Admin role', async () => {
    const { kernel, bootstrap, shown } = await start();
    await makeRoleAssignment(kernel.pool, await makeUser(kernel.pool), 'admin');
    expect(await bootstrap.issueFirstRunToken()).toBe(false);
    expect(shown).toEqual([]);
  });

  it('is not put off by users who do not hold the Admin role, whatever their status or other roles', async () => {
    const { kernel, bootstrap } = await start();
    await makeUser(kernel.pool); // active, no role
    await makeRoleAssignment(kernel.pool, await makeUser(kernel.pool), 'user');
    await makeRoleAssignment(kernel.pool, await makeUser(kernel.pool), 'reviewer');
    await makeUser(kernel.pool, { status: 'pending' });
    await makeUser(kernel.pool, { status: 'rejected', deleted: true });
    await makeUser(kernel.pool, { deleted: true });
    expect(await bootstrap.issueFirstRunToken()).toBe(true);
  });

  it('is issued at start-up (system.ready) and shown only to the announcer, never to the log', async () => {
    const lines: string[] = [];
    const shown: string[] = [];
    const databaseUrl = await identity.server().createDatabase();
    const boot = async () => {
      const { kernel } = await identity.start({
        databaseUrl,
        announce: (text) => shown.push(text),
        logLines: lines,
      });
      await kernel.stop();
    };

    await boot();
    const token = tokenIn(shown)!;
    expect(token).toBeDefined();
    await boot(); // a restart with the token outstanding shows nothing new
    expect(shown).toHaveLength(1);
    expect(lines.join('')).not.toContain(token);
    expect(lines.join('')).not.toContain(token.slice(4));
    expect(lines.join('')).toContain('a first-run token is outstanding'); // said, without the secret
  });
});

describe('redeemFirstRunToken', () => {
  async function issued() {
    const started = await start();
    await started.bootstrap.issueFirstRunToken();
    return { ...started, token: tokenIn(started.shown)! };
  }

  it('creates the first administrator, uses the token up, and emits the event', async () => {
    const { kernel, bootstrap, token } = await issued();
    const created = await bootstrap.redeemFirstRunToken({ ...admin, token });

    expect(created).toMatchObject({ username: 'root', status: 'active' });
    expect(await adminHolders(kernel)).toEqual([{ username: 'root', assigned_by: null }]);
    expect(
      (await rows(kernel, 'select name, payload from kernel_outbox order by name')).map(
        (e) => e.name,
      ),
    ).toEqual(['authz.role.assigned@1', 'identity.admin.created@1']);
    expect(
      (await rows(kernel, "select payload from kernel_outbox where name like 'identity.%'"))[0]!
        .payload,
    ).toMatchObject({ origin: 'first-run' });
    // Single use.
    await expect(
      bootstrap.redeemFirstRunToken({
        ...admin,
        username: 'second',
        email: 'b@example.org',
        token,
      }),
    ).rejects.toBeInstanceOf(Unauthorized);
    expect(await rows(kernel, 'select 1 from identity_user')).toHaveLength(1);
  });

  it('answers the same for a token that is unknown, used, expired or malformed', async () => {
    const { kernel, bootstrap, token } = await issued();
    await kernel.pool.query(
      `update identity_first_run_token set expires_at = now() - interval '1 second'`,
    );
    const messages = new Set<string>();
    for (const attempt of [
      token, // expired
      `sfr_${'A'.repeat(43)}`, // unknown
      'garbage',
      `sfr_${'A'.repeat(42)}`,
    ]) {
      const error = await bootstrap
        .redeemFirstRunToken({ ...admin, token: attempt })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Unauthorized);
      messages.add((error as Error).message);
    }
    expect(messages.size).toBe(1);
    expect(await rows(kernel, 'select 1 from identity_user')).toEqual([]);
  });

  it('leaves the token usable when the account cannot be created (a taken name)', async () => {
    const { kernel, bootstrap, token } = await issued();
    await makeUser(kernel.pool, { status: 'pending', username: 'root' });
    await expect(bootstrap.redeemFirstRunToken({ ...admin, token })).rejects.toBeInstanceOf(
      Conflict,
    );
    expect(await rows(kernel, 'select redeemed_at from identity_first_run_token')).toEqual([
      { redeemed_at: null },
    ]);
    await expect(
      bootstrap.redeemFirstRunToken({ ...admin, username: 'root2', token }),
    ).resolves.toMatchObject({ username: 'root2' });
  });

  it('works although other users exist, as long as none holds the Admin role', async () => {
    const { kernel, bootstrap, token } = await issued();
    await makeRoleAssignment(kernel.pool, await makeUser(kernel.pool), 'user');
    await expect(bootstrap.redeemFirstRunToken({ ...admin, token })).resolves.toMatchObject({
      username: 'root',
    });
  });

  it('refuses once somebody holds the Admin role, even with a good token, and keeps the token unused', async () => {
    const { kernel, bootstrap, token } = await issued();
    await makeRoleAssignment(kernel.pool, await makeUser(kernel.pool), 'admin');
    await expect(bootstrap.redeemFirstRunToken({ ...admin, token })).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(await rows(kernel, 'select redeemed_at from identity_first_run_token')).toEqual([
      { redeemed_at: null },
    ]);
  });

  it('refuses bad input with Invalid, and a weak password does not use the token up', async () => {
    const { kernel, bootstrap, token } = await issued();
    await expect(
      bootstrap.redeemFirstRunToken({ ...admin, password: 'short', token }),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(bootstrap.redeemFirstRunToken({ token })).rejects.toBeInstanceOf(Invalid);
    expect(await rows(kernel, 'select redeemed_at from identity_first_run_token')).toEqual([
      { redeemed_at: null },
    ]);
  });

  it('lets exactly one of two parallel redemptions win', async () => {
    const { kernel, bootstrap, token } = await issued();
    const results = await Promise.allSettled([
      bootstrap.redeemFirstRunToken({ ...admin, token }),
      bootstrap.redeemFirstRunToken({ ...admin, username: 'root2', email: 'b@example.org', token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await rows(kernel, 'select 1 from identity_user')).toHaveLength(1);
  });

  it('rolls back everything, token included, when the event cannot be written', async () => {
    const { kernel, bootstrap, token } = await issued();
    await failOutbox(kernel);
    await expect(bootstrap.redeemFirstRunToken({ ...admin, token })).rejects.toThrow();
    expect(await rows(kernel, 'select 1 from identity_user')).toEqual([]);
    expect(await rows(kernel, 'select redeemed_at from identity_first_run_token')).toEqual([
      { redeemed_at: null },
    ]);
  });
});

async function failOutbox(kernel: { pool: Pool }) {
  await kernel.pool.query(`
    create function identity_test_fail() returns trigger language plpgsql as
      $$ begin raise exception 'outbox on fire'; end $$;
    create trigger identity_test_fail before insert on kernel_outbox
      for each row execute function identity_test_fail();`);
}
