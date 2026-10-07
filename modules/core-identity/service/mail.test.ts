// The mails core.identity queues, through the real core.notifications: which mail goes to whom, in
// which language, that it is queued in the same transaction as the work (a rollback sends nothing),
// and that registering with a taken address looks like registering with a new one.
import { Conflict } from '@scorpion/contracts';
import { makePreference, makeRoleAssignment, makeUser, type Mailbox } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { failOutbox } from '../test/mail.ts';
import { makeMember, useIdentity } from '../test/harness.ts';
import { settingsSchema } from './settings.ts';

const identity = useIdentity();
const PASSWORD = 'correct horse battery';
const input = { username: 'alice', email: 'alice@example.org', password: PASSWORD };

const actorOf = (user: { id: string; username: string }, sessionId?: string) =>
  ({
    kind: 'user',
    userId: user.id,
    username: user.username,
    roles: [],
    via: 'session',
    sessionId,
  }) as const;

async function withAdmins(
  ...admins: { username: string; email: string | null; locale?: string }[]
) {
  const started = await identity.start();
  const made = [];
  for (const admin of admins) {
    const user = await makeUser(started.kernel.pool, {
      username: admin.username,
      email: admin.email,
      status: 'active',
    });
    await makeRoleAssignment(started.kernel.pool, user, 'admin');
    if (admin.locale) {
      await makePreference(started.kernel.pool, user, 'notifications.locale', admin.locale);
    }
    made.push(user);
  }
  return { ...started, admins: made };
}

const kinds = async (mail: Mailbox) => (await mail.all()).map((m) => [m.template, m.to]);

describe('registering: the new address', () => {
  it('queues the welcome mail, the confirmation link and one mail per administrator', async () => {
    const { identity: id, mail } = await withAdmins(
      { username: 'root', email: 'root@example.org' },
      { username: 'second', email: 'second@example.org' },
    );
    const user = (await id.accounts.register(input))!;

    const queued = await mail.all();
    expect(queued.map((m) => [m.template, m.to]).sort()).toEqual(
      [
        ['identity.welcome', 'alice@example.org'],
        ['identity.email-verification', 'alice@example.org'],
        ['identity.registration-request', 'root@example.org'],
        ['identity.registration-request', 'second@example.org'],
      ].sort(),
    );
    const welcome = queued.find((m) => m.template === 'identity.welcome')!;
    expect(welcome).toMatchObject({ userId: user.id, sensitive: false, status: 'queued' });
    expect(welcome.text).toContain('usually within 1 to 2 business days');
    const request = queued.find((m) => m.to === 'root@example.org')!;
    expect(request.subject).toBe('Registration request from alice');
    expect(request.text).toContain('alice (alice@example.org)');
    expect(request.text).toContain('/admin/users/pending');
  });

  it('mails each administrator in their own language, and the new person in the one the request carried', async () => {
    const { identity: id, mail } = await withAdmins(
      { username: 'root', email: 'root@example.org', locale: 'de' },
      { username: 'second', email: 'second@example.org' },
    );
    await id.accounts.register({ ...input, locale: 'de' });
    const bySubject = Object.fromEntries((await mail.all()).map((m) => [m.to, m.subject]));
    expect(bySubject['root@example.org']).toBe('Registrierungsanfrage von alice');
    expect(bySubject['second@example.org']).toBe('Registration request from alice');
    expect((await mail.of('identity.welcome'))[0]).toMatchObject({
      locale: 'de',
      subject: expect.stringContaining('Willkommen') as unknown,
    });
  });

  it('ignores a language that is not shipped and one that is only a regional tag', async () => {
    const { identity: id, mail } = await withAdmins();
    await id.accounts.register({ ...input, locale: 'fr' });
    await id.accounts.register({
      ...input,
      username: 'bob',
      email: 'bob@example.org',
      locale: 'de-AT',
    });
    const welcomes = await mail.of('identity.welcome');
    expect(welcomes.map((m) => [m.to, m.locale])).toEqual([
      ['alice@example.org', 'en'],
      ['bob@example.org', 'de'],
    ]);
  });

  it('skips an administrator with no address, a pending one and a deleted one', async () => {
    const started = await withAdmins({ username: 'root', email: 'root@example.org' });
    const { kernel, identity: id, mail } = started;
    for (const [username, overrides] of [
      ['noaddress', { email: null, status: 'active' }],
      ['pendingadmin', { email: 'p@example.org', status: 'pending' }],
      ['goneadmin', { email: 'g@example.org', status: 'active', deleted: true }],
    ] as const) {
      const user = await makeUser(kernel.pool, { username, ...overrides });
      await makeRoleAssignment(kernel.pool, user, 'admin');
    }
    await id.accounts.register(input);
    expect((await mail.of('identity.registration-request')).map((m) => m.to)).toEqual([
      'root@example.org',
    ]);
  });

  it('sends no administrator mail when a policy activates the account at once, and the welcome mail shows a sign-in link', async () => {
    const started = await identity.start({
      settings: { get: () => Promise.resolve(settingsSchema.parse({ approvalPolicy: 'auto' })) },
      extraModule: {
        id: 'test.auto',
        manifest: {
          id: 'test.auto',
          version: '1.0.0',
          contributes: {
            'auth.approvalPolicy': [{ id: 'auto', decide: () => ({ status: 'active' }) }],
          },
        },
      },
    });
    const admin = await makeUser(started.kernel.pool, {
      email: 'root@example.org',
      status: 'active',
    });
    await makeRoleAssignment(started.kernel.pool, admin, 'admin');
    await started.identity.accounts.register(input);
    expect((await started.mail.templates()).sort()).toEqual([
      'identity.email-verification',
      'identity.welcome',
    ]);
    expect(await started.mail.of('identity.registration-request')).toEqual([]);
    expect((await started.mail.of('identity.welcome'))[0]!.text).toContain('You can sign in now');
  });

  it('queues nothing, and creates no account, when the event cannot be written (rollback)', async () => {
    const {
      kernel,
      identity: id,
      mail,
    } = await withAdmins({ username: 'root', email: 'root@example.org' });
    await failOutbox(kernel);
    await expect(id.accounts.register(input)).rejects.toThrow();
    // The mails are queued before the event, so they were inserted and then rolled back with it.
    expect(await mail.all()).toEqual([]);
    expect(
      (await kernel.pool.query("select 1 from identity_user where username = 'alice'")).rows,
    ).toEqual([]);
    expect((await kernel.pool.query('select 1 from identity_mail_token')).rows).toEqual([]);
  });

  it('spends no mail on the new person when the address has had its share, and still tells the administrators', async () => {
    const {
      identity: id,
      kernel,
      mail,
    } = await withAdmins({ username: 'root', email: 'root@example.org' });
    // The budget of the address is gone (3 an hour).
    await kernel.pool.query(
      'insert into kernel_rate_bucket (key, tokens, allowed, updated_at) values ($1, 0, false, now()) on conflict (key) do update set tokens = 0',
      [await bucketKey('alice@example.org')],
    );
    const user = await id.accounts.register(input);
    expect(user).toMatchObject({ username: 'alice' });
    expect(await kinds(mail)).toEqual([['identity.registration-request', 'root@example.org']]);
  });
});

/** The rate-limiter key of an address's mail budget (ADR 0012: the hash of the lower-cased address). */
async function bucketKey(address: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return `identity.mail:${createHash('sha256').update(address.toLowerCase()).digest('hex')}`;
}

describe('registering with a taken address (register without revealing)', () => {
  async function owner(started: Awaited<ReturnType<typeof identity.start>>, overrides = {}) {
    const user = await makeMember(started.kernel.pool, {
      username: 'owner',
      email: 'alice@example.org',
      ...overrides,
    });
    await started.kernel.pool.query("update identity_user set status = 'active' where id = $1", [
      user.id,
    ]);
    return user;
  }

  it('creates nothing, answers like the new path, and mails the owner a notice', async () => {
    const started = await withAdmins({ username: 'root', email: 'root@example.org' });
    const holder = await owner(started);
    const result = await started.identity.accounts.register(input);
    expect(result).toBeUndefined(); // the route answers 202 for this and for a created account
    expect(await kinds(started.mail)).toEqual([['identity.register-attempt', 'alice@example.org']]);
    const notice = (await started.mail.all())[0]!;
    expect(notice).toMatchObject({ userId: holder.id, sensitive: false });
    expect(notice.text).toContain('/forgot-password');
    expect(notice.text).toContain('/login');
    expect(notice.text).not.toContain('#token=');
    // No account, no auth method, no token, no event, and no mail to the administrators.
    expect(
      (await started.kernel.pool.query("select 1 from identity_user where username = 'alice'"))
        .rows,
    ).toEqual([]);
    expect((await started.kernel.pool.query('select 1 from identity_mail_token')).rows).toEqual([]);
    expect(
      (await started.kernel.pool.query("select 1 from kernel_outbox where name like 'identity.%'"))
        .rows,
    ).toEqual([]);
  });

  it('is case-insensitive about the address, and the taken username is still a 409', async () => {
    const started = await withAdmins();
    await owner(started);
    await expect(
      started.identity.accounts.register({ ...input, email: 'ALICE@EXAMPLE.ORG' }),
    ).resolves.toBeUndefined();
    await expect(
      started.identity.accounts.register({
        ...input,
        username: 'owner',
        email: 'free@example.org',
      }),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('mails a pending account’s owner too, but not the owner of a rejected (soft-deleted) account', async () => {
    const started = await withAdmins();
    const { kernel, identity: id, mail } = started;
    const pending = await makeMember(kernel.pool, {
      username: 'pend',
      email: 'pending@example.org',
      status: 'pending',
    });
    await makeMember(kernel.pool, {
      username: 'rejd',
      email: 'rejected@example.org',
      status: 'rejected',
      deleted: true,
    });
    void pending;
    await id.accounts.register({ ...input, username: 'xone', email: 'pending@example.org' });
    await id.accounts.register({ ...input, username: 'xtwo', email: 'rejected@example.org' });
    expect(await kinds(mail)).toEqual([['identity.register-attempt', 'pending@example.org']]);
  });

  it('spends the address’s mail budget on both paths, by the same amount', async () => {
    const started = await withAdmins();
    const { kernel, identity: id } = started;
    await owner(started, { email: 'taken@example.org', username: 'owner' });
    await id.accounts.register({ ...input, username: 'new1', email: 'fresh@example.org' });
    await id.accounts.register({ ...input, username: 'new2', email: 'taken@example.org' });
    const tokensLeft = async (address: string) =>
      Number(
        (
          await kernel.pool.query<{ tokens: number }>(
            'select tokens from kernel_rate_bucket where key = $1',
            [await bucketKey(address)],
          )
        ).rows[0]!.tokens,
      );
    const fresh = await tokensLeft('fresh@example.org');
    const taken = await tokensLeft('taken@example.org');
    expect(Math.round(fresh)).toBe(2);
    expect(Math.round(taken)).toBe(Math.round(fresh));
  });

  it('stops mailing the owner when the address has had its share, and answers the same', async () => {
    const started = await withAdmins();
    await owner(started);
    for (let i = 0; i < 6; i += 1) {
      await expect(started.identity.accounts.register(input)).resolves.toBeUndefined();
    }
    expect(await started.mail.of('identity.register-attempt')).toHaveLength(3);
  });

  it('queues nothing when the notice cannot be stored (the owner is not mailed, nothing else changes)', async () => {
    const started = await withAdmins();
    await owner(started);
    await started.kernel.pool.query(
      `create function notify_test_fail() returns trigger language plpgsql as $$ begin raise exception 'down'; end $$;
       create trigger notify_test_fail before insert on notify_delivery for each row execute function notify_test_fail();`,
    );
    await expect(started.identity.accounts.register(input)).rejects.toThrow();
    expect(await started.mail.all()).toEqual([]);
  });
});

describe('approving and rejecting', () => {
  async function pending(locale?: string) {
    const started = await identity.start();
    const admin = await makeUser(started.kernel.pool, { status: 'active' });
    await makeRoleAssignment(started.kernel.pool, admin, 'admin');
    const applicant = await makeUser(started.kernel.pool, {
      username: 'carol',
      email: 'carol@example.org',
      status: 'pending',
    });
    if (locale)
      await makePreference(started.kernel.pool, applicant, 'notifications.locale', locale);
    return { ...started, admin, applicant };
  }

  it('approving queues the approved mail, with a sign-in link, in the person’s language', async () => {
    const { identity: id, mail, admin, applicant } = await pending('de');
    await id.approval.approve(actorOf(admin), applicant.id);
    expect(await mail.all()).toMatchObject([
      {
        template: 'identity.approved',
        to: 'carol@example.org',
        userId: applicant.id,
        locale: 'de',
        subject: 'Ihr Konto bei Scorpion wurde freigegeben',
      },
    ]);
    expect((await mail.all())[0]!.text).toContain('/login');
  });

  it('rejecting queues the rejected mail with the contact address of the instance', async () => {
    const { identity: id, mail, admin, applicant, kernel } = await pending();
    await kernel.pool.query(
      `insert into settings_setting (module_id, value, version) values ('core.settings', '{"branding":{"contactEmail":"help@example.org"}}', 1)`,
    );
    await id.approval.reject(actorOf(admin), applicant.id);
    const [rejected] = await mail.all();
    expect(rejected).toMatchObject({
      template: 'identity.rejected',
      to: 'carol@example.org',
      locale: 'en',
    });
    expect(rejected!.text).toContain('write to help@example.org');
  });

  it('sends no mail to an account without an address, and still decides', async () => {
    const started = await pending();
    const noAddress = await makeUser(started.kernel.pool, {
      username: 'dan',
      email: null,
      status: 'pending',
    });
    expect(await started.identity.approval.approve(actorOf(started.admin), noAddress.id)).toBe(
      'active',
    );
    expect(await started.mail.all()).toEqual([]);
  });

  it('approving rolls back with its mail when the event cannot be written: pending, no role, nothing queued', async () => {
    const { identity: id, mail, admin, applicant, kernel } = await pending();
    await failOutbox(kernel);
    await expect(id.approval.approve(actorOf(admin), applicant.id)).rejects.toThrow();
    expect(await mail.all()).toEqual([]);
    expect(
      (await kernel.pool.query('select status from identity_user where id = $1', [applicant.id]))
        .rows,
    ).toEqual([{ status: 'pending' }]);
    expect(
      (
        await kernel.pool.query('select 1 from authz_role_assignment where user_id = $1', [
          applicant.id,
        ])
      ).rows,
    ).toEqual([]);
  });

  it('rejecting rolls back with its mail when the event cannot be written: still pending, nothing queued', async () => {
    const { identity: id, mail, admin, applicant, kernel } = await pending();
    await failOutbox(kernel);
    await expect(id.approval.reject(actorOf(admin), applicant.id)).rejects.toThrow();
    expect(await mail.all()).toEqual([]);
    expect(
      (
        await kernel.pool.query('select status, deleted_at from identity_user where id = $1', [
          applicant.id,
        ])
      ).rows,
    ).toEqual([{ status: 'pending', deleted_at: null }]);
  });

  it('sends no mail when the approval is refused (own account, unknown role, not pending)', async () => {
    const { identity: id, mail, admin, applicant } = await pending();
    await expect(id.approval.approve(actorOf(applicant), applicant.id)).rejects.toThrow();
    await expect(
      id.approval.approve(actorOf(admin), applicant.id, { role: 'nope' }),
    ).rejects.toThrow();
    expect(await mail.all()).toEqual([]);
  });
});

describe('changing the address in the profile', () => {
  it('queues the confirmation mail in the same transaction as the change, and a rollback queues none', async () => {
    const started = await identity.start();
    const alice = await makeMember(started.kernel.pool, {
      username: 'alice',
      email: 'old@example.org',
    });
    const { sessionId } = await started.identity.sessions.create(alice.id);
    await failOutbox(started.kernel);
    await expect(
      started.identity.profile.update(actorOf(alice, sessionId), { email: 'new@example.org' }),
    ).rejects.toThrow('outbox');
    expect(await started.mail.all()).toEqual([]);
    expect((await started.kernel.pool.query('select 1 from identity_mail_token')).rows).toEqual([]);
  });

  it('mails in the person’s preferred language, and sends none for an address another account holds', async () => {
    const started = await identity.start();
    const alice = await makeMember(started.kernel.pool, {
      username: 'alice',
      email: 'old@example.org',
    });
    await makeMember(started.kernel.pool, { username: 'bobby', email: 'held@example.org' });
    await makePreference(started.kernel.pool, alice, 'notifications.locale', 'de');
    const { sessionId } = await started.identity.sessions.create(alice.id);
    await started.identity.profile.update(actorOf(alice, sessionId), { email: 'new@example.org' });
    await started.identity.profile.update(actorOf(alice, sessionId), { email: 'held@example.org' });
    expect(await started.mail.all()).toMatchObject([
      { template: 'identity.email-verification', to: 'new@example.org', locale: 'de' },
    ]);
  });
});
