// Creating accounts from OIDC logins and linking identities: provisioning, what a first sign-in does
// when an account holds the address, linking from the profile, and the rollback of the writes.
import { ANONYMOUS, Conflict, Forbidden, Unauthorized } from '@scorpion/contracts';
import { makeAuthMethod } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { makeMember } from '../test/harness.ts';
import { failOutbox, tokenFrom } from '../test/mail.ts';
import { hashMailToken } from './mail-tokens.ts';
import { count, flow, fresh, rows, sessionActorFor, settingsWith, start } from '../test/oidc.ts';

describe('the first login (provisioning)', () => {
  it('creates a pending user and its identity, emits registered@1, and starts no session [ASVS-7.6.2]', async () => {
    const { kernel, identity: id } = await start();
    const input = await flow(
      id,
      fresh({ preferredUsername: 'Maria Curie', email: 'maria@example.org' }),
    );
    await expect(id.oidc.complete(input)).rejects.toBeInstanceOf(Forbidden);

    const [user] = await rows(kernel, 'select * from identity_user');
    expect(user).toMatchObject({
      username: 'maria-curie',
      email: 'maria@example.org',
      status: 'pending',
    });
    expect(user!.email_verified_at).toBeInstanceOf(Date);
    // Nothing marks this account as an administrator, and nothing can: the column is written by bootstrap only.
    expect(Object.values(user!).filter((value) => value === true)).toEqual([]);
    expect(
      await rows(kernel, 'select provider, subject, password_hash from identity_auth_method'),
    ).toEqual([{ provider: 'stub', subject: expect.any(String) as unknown, password_hash: null }]);
    expect(await count(kernel, 'identity_session')).toBe(0);
    expect(await rows(kernel, 'select name, payload from kernel_outbox')).toEqual([
      {
        name: 'identity.user.registered@1',
        payload: { userId: user!.id, username: 'maria-curie', status: 'pending' },
      },
    ]);
  });

  it('starts a session when the approval policy activates the account', async () => {
    const seen: unknown[] = [];
    const policy = {
      id: 'test.auto',
      version: '1.0.0',
      contributes: {
        'auth.approvalPolicy': [
          {
            id: 'auto',
            decide: (registration: unknown) => {
              seen.push(registration);
              return { status: 'active' };
            },
          },
        ],
      },
    };
    const { kernel, identity: id } = await start({
      settings: settingsWith({ approvalPolicy: 'auto' }),
      extraModule: { id: 'test.auto', manifest: policy },
    });
    const done = await id.oidc.complete(
      await flow(id, fresh({ preferredUsername: 'quick', email: 'q@example.org' })),
    );
    expect(done).toMatchObject({
      kind: 'login',
      sessionId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as string,
    });
    expect(seen).toEqual([
      { username: 'quick', email: 'q@example.org', emailVerified: true, provider: 'stub' },
    ]);
    expect(await count(kernel, 'identity_session')).toBe(1);
    // The account holds the default role from the start: the role is given by the system, in the
    // transaction that created the account.
    expect(await rows(kernel, 'select name, payload from kernel_outbox order by id')).toEqual([
      {
        name: 'authz.role.assigned@1',
        payload: expect.objectContaining({ roleKey: 'user', actorId: null }) as unknown,
      },
      {
        name: 'identity.user.registered@1',
        payload: expect.objectContaining({ username: 'quick', status: 'active' }) as unknown,
      },
    ]);
    expect(
      await rows(
        kernel,
        `select r.key from authz_role_assignment a join authz_role r on r.id = a.role_id`,
      ),
    ).toEqual([{ key: 'user' }]);
  });

  it('keeps no address, and trusts no claim, when the provider does not vouch for the email', async () => {
    const { kernel, identity: id } = await start();
    for (const emailVerified of [false, 'true', 1, undefined]) {
      const login = fresh({ email: 'claimed@example.org', emailVerified });
      await expect(id.oidc.complete(await flow(id, login))).rejects.toBeInstanceOf(Forbidden);
    }
    const users = await rows(kernel, 'select email, email_verified_at from identity_user');
    expect(users).toHaveLength(4);
    for (const u of users) expect(u).toEqual({ email: null, email_verified_at: null });
  });

  it('gives a second person with the same preferred name a different, stable username', async () => {
    const { kernel, identity: id } = await start();
    await expect(
      id.oidc.complete(await flow(id, fresh({ preferredUsername: 'sam' }))),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      id.oidc.complete(await flow(id, fresh({ preferredUsername: 'sam' }))),
    ).rejects.toBeInstanceOf(Forbidden);
    const names = (
      await rows(kernel, 'select username from identity_user order by created_at')
    ).map((r) => r.username);
    expect(names[0]).toBe('sam');
    expect(names[1]).toMatch(/^sam-[0-9a-f]{4}$/);
  });

  it('is a 409 when the username cannot be made unique, never a 500', async () => {
    const { kernel, identity: id } = await start();
    const login = fresh({ preferredUsername: 'taken' });
    const { usernameCandidates } = await import('./username.ts');
    for (const name of usernameCandidates('taken', 'stub', login.subject!)) {
      await makeMember(kernel.pool, { username: name });
    }
    await expect(id.oidc.complete(await flow(id, login))).rejects.toBeInstanceOf(Conflict);
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
  });

  it('never sets the bootstrap marker and does not end the first-run bootstrap while the account is pending', async () => {
    const { kernel, identity: id } = await start();
    await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toBeInstanceOf(Forbidden);
    // The install still has no active user, so its first-run token (issued at start-up) stays good.
    expect(
      await rows(
        kernel,
        'select 1 from identity_first_run_token where redeemed_at is null and expires_at > now()',
      ),
    ).toHaveLength(1);
    expect(await count(kernel, 'identity_user')).toBe(1);
  });

  describe('rollback', () => {
    it('leaves no user, no identity and no event when writing the identity fails', async () => {
      const { kernel, identity: id } = await start();
      await kernel.pool.query(`
        create function identity_test_fail() returns trigger language plpgsql as
          $$ begin raise exception 'disk on fire'; end $$;
        create trigger identity_test_fail before insert on identity_auth_method
          for each row execute function identity_test_fail();`);
      await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toThrow();
      expect(await count(kernel, 'identity_user')).toBe(0);
      expect(await count(kernel, 'identity_auth_method')).toBe(0);
      expect(await count(kernel, 'kernel_outbox')).toBe(0);
      expect(await count(kernel, 'identity_session')).toBe(0);
    });

    it('leaves no user and no identity when the event cannot be written', async () => {
      const { kernel, identity: id } = await start();
      await kernel.pool.query(`
        create function identity_test_fail() returns trigger language plpgsql as
          $$ begin raise exception 'outbox on fire'; end $$;
        create trigger identity_test_fail before insert on kernel_outbox
          for each row execute function identity_test_fail();`);
      await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toThrow();
      expect(await count(kernel, 'identity_user')).toBe(0);
      expect(await count(kernel, 'identity_auth_method')).toBe(0);
    });
  });
});

// A first sign-in whose verified address an account holds no longer links and no longer signs in
// (ADR 0026, ASVS 6.8.1): the account's own mailbox is asked instead. The confirmation is tested in
// oidc-link.test.ts.
describe('a first sign-in with an address that an account holds', () => {
  const holds = (
    kernel: Parameters<typeof count>[0],
    over: Parameters<typeof makeMember>[1] = {},
  ) => makeMember(kernel.pool, { email: 'ann@example.org', emailVerified: true, ...over });

  it('links nothing and signs nobody in, and mails a link to the account that holds the address [ASVS-6.8.1]', async () => {
    const { kernel, identity: id, mail } = await start();
    const user = await holds(kernel);
    const done = await id.oidc.complete(await flow(id, fresh({ email: 'ANN@example.org' })));

    expect(done).toEqual({ kind: 'check-mail' });
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
    expect(await count(kernel, 'identity_session')).toBe(0);
    // One mail, to the address the account has (not the provider's spelling), carrying the link.
    const sent = await mail.of('identity.oidc-link');
    expect(sent.map((m) => m.to)).toEqual(['ann@example.org']);
    expect(sent[0]!.text).toContain('Stub provider');
    expect(sent[0]!.text).toMatch(/\/link-sign-in#token=sol_[A-Za-z0-9_-]{43}/);
    // The event says a link was asked for, and nothing was linked.
    expect(await rows(kernel, 'select name, payload from kernel_outbox')).toEqual([
      {
        name: 'identity.authMethod.linkRequested@1',
        payload: { userId: user.id, username: user.username, provider: 'stub' },
      },
    ]);
  });

  it('stores only a hash of the token, for the account, the provider and the subject, for 10 minutes', async () => {
    const { kernel, identity: id, mail } = await start();
    const user = await holds(kernel);
    const login = fresh({ email: 'ann@example.org', subject: 'attacker-sub' });
    await id.oidc.complete(await flow(id, login));

    const token = tokenFrom((await mail.of('identity.oidc-link'))[0]);
    const [row] = await rows(
      kernel,
      `select user_id, purpose, secret_hash, email, provider, subject,
              extract(epoch from expires_at - created_at)::int as seconds
         from identity_mail_token`,
    );
    expect(row).toMatchObject({
      user_id: user.id,
      purpose: 'oidc-link',
      email: null,
      provider: 'stub',
      subject: 'attacker-sub',
      seconds: 600,
    });
    expect(row!.secret_hash).toBe(hashMailToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('never takes over an account whose address nobody confirmed, and links nothing', async () => {
    const { kernel, identity: id } = await start();
    await holds(kernel, { emailVerified: false });
    const done = await id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' })));
    expect(done).toEqual({ kind: 'check-mail' });
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
    expect(await count(kernel, 'identity_session')).toBe(0);
  });

  it('gives the same answer whatever the matching account is, and mails only the ones that can use it [ASVS-6.8.1]', async () => {
    // [state of the account, whether a mail goes out]
    const cases: [string, Parameters<typeof makeMember>[1], boolean][] = [
      ['active and confirmed', {}, true],
      ['active, address not confirmed', { emailVerified: false }, true],
      ['pending', { status: 'pending' }, true],
      ['rejected', { status: 'rejected', deleted: true }, false],
      ['deleted', { deleted: true }, false],
    ];
    for (const [name, over, mailed] of cases) {
      const { kernel, identity: id, mail } = await start();
      await holds(kernel, over);
      const done = await id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' })));
      expect(done, name).toEqual({ kind: 'check-mail' });
      expect(await mail.of('identity.oidc-link'), name).toHaveLength(mailed ? 1 : 0);
      expect(await count(kernel, 'identity_auth_method'), name).toBe(0);
      expect(await count(kernel, 'identity_session'), name).toBe(0);
    }
  });

  it('spends the mail budget of the address, and answers the same when it is spent', async () => {
    const { kernel, identity: id, mail } = await start();
    await holds(kernel);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const done = await id.oidc.complete(
        await flow(id, fresh({ email: 'ann@example.org', subject: `s-${attempt}` })),
      );
      expect(done).toEqual({ kind: 'check-mail' });
    }
    // 3 mails an hour for the address; the other two attempts looked the same and sent nothing.
    expect(await mail.of('identity.oidc-link')).toHaveLength(3);
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
  });

  it('keeps one outstanding link per account: a new attempt replaces the older token', async () => {
    const { kernel, identity: id, mail } = await start();
    await holds(kernel);
    await id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org', subject: 'one' })));
    await id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org', subject: 'two' })));
    expect(await rows(kernel, 'select subject from identity_mail_token')).toEqual([
      { subject: 'two' },
    ]);
    expect(await mail.of('identity.oidc-link')).toHaveLength(2);
  });

  it('sends no mail for an address the provider did not vouch for, and links nothing', async () => {
    const { kernel, identity: id, mail } = await start();
    await holds(kernel);
    await expect(
      id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org', emailVerified: false }))),
    ).rejects.toBeInstanceOf(Forbidden); // a new, pending account without an address
    expect(await mail.of('identity.oidc-link')).toEqual([]);
    expect(await count(kernel, 'identity_user')).toBe(2);
    expect(await count(kernel, 'identity_auth_method')).toBe(1);
  });

  it('still creates a pending account for an address that no account holds', async () => {
    const { kernel, identity: id, mail } = await start();
    await holds(kernel);
    await expect(
      id.oidc.complete(await flow(id, fresh({ email: 'someone-else@example.org' }))),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await count(kernel, 'identity_user')).toBe(2);
    expect(await mail.of('identity.oidc-link')).toEqual([]);
  });

  it('does not touch an identity that is known: it signs in as before', async () => {
    const { kernel, identity: id } = await start();
    const user = await holds(kernel);
    await makeAuthMethod(kernel.pool, user, { provider: 'stub', subject: 'known-sub' });
    const done = await id.oidc.complete(await flow(id, fresh({ subject: 'known-sub' })));
    expect(done).toMatchObject({ kind: 'login' });
  });

  describe('rollback', () => {
    it('stores no token and sends no mail when the event cannot be written', async () => {
      const { kernel, identity: id, mail } = await start();
      await holds(kernel);
      await failOutbox(kernel);
      await expect(
        id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' }))),
      ).rejects.toThrow();
      expect(await count(kernel, 'identity_mail_token')).toBe(0);
      expect(await mail.of('identity.oidc-link')).toEqual([]);
      expect(await count(kernel, 'identity_auth_method')).toBe(0);
    });
  });
});

describe('linking from the profile', () => {
  it('adds the identity to the signed-in user, emits linked@1, and starts no session', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeMember(kernel.pool);
    const input = await flow(
      id,
      fresh({ subject: 'profile-sub', email: 'other@example.org' }),
      await sessionActorFor(id, user),
    );
    expect(await id.oidc.complete(input)).toEqual({ kind: 'linked' });
    expect(
      await rows(
        kernel,
        "select user_id, subject from identity_auth_method where provider = 'stub'",
      ),
    ).toEqual([{ user_id: user.id, subject: 'profile-sub' }]);
    // The caller's own session is the only one: linking starts none.
    expect(await count(kernel, 'identity_session')).toBe(1);
    expect(await rows(kernel, 'select name, payload from kernel_outbox')).toEqual([
      {
        name: 'identity.authMethod.linked@1',
        payload: { userId: user.id, username: user.username, provider: 'stub', via: 'profile' },
      },
    ]);
  });

  it('can then be used to sign in', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeMember(kernel.pool);
    await id.oidc.complete(
      await flow(id, fresh({ subject: 'profile-sub' }), await sessionActorFor(id, user)),
    );
    const done = await id.oidc.complete(await flow(id, fresh({ subject: 'profile-sub' })));
    const resolved = await id.sessions.resolve((done as { sessionId: string }).sessionId);
    expect(resolved?.userId).toBe(user.id);
  });

  it('refuses an anonymous caller (401) and a token caller (403), and stores no state', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeMember(kernel.pool);
    await expect(id.oidc.startLink(ANONYMOUS, 'stub')).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      id.oidc.startLink(
        {
          kind: 'user',
          userId: user.id,
          username: user.username,
          roles: [],
          via: 'token',
          scopes: [],
        },
        'stub',
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await count(kernel, 'identity_login_state')).toBe(0);
  });

  it('is a 409 when the identity belongs to another user [ASVS-10.5.2]', async () => {
    const { kernel, identity: id } = await start();
    const owner = await makeMember(kernel.pool);
    await makeAuthMethod(kernel.pool, owner, { provider: 'stub', subject: 'shared-sub' });
    const thief = await makeMember(kernel.pool);
    await expect(
      id.oidc.complete(
        await flow(id, fresh({ subject: 'shared-sub' }), await sessionActorFor(id, thief)),
      ),
    ).rejects.toBeInstanceOf(Conflict);
    expect(
      await rows(kernel, "select user_id from identity_auth_method where provider = 'stub'"),
    ).toEqual([{ user_id: owner.id }]);
  });

  it('is a 409 when the user already has this provider', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeMember(kernel.pool);
    await makeAuthMethod(kernel.pool, user, { provider: 'stub', subject: 'first' });
    await expect(
      id.oidc.complete(
        await flow(id, fresh({ subject: 'second' }), await sessionActorFor(id, user)),
      ),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('links nothing for a user who was deleted after starting', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeMember(kernel.pool);
    const input = await flow(id, fresh(), await sessionActorFor(id, user));
    await kernel.pool.query('update identity_user set deleted_at = now() where id = $1', [user.id]);
    await expect(id.oidc.complete(input)).rejects.toBeInstanceOf(Unauthorized);
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
  });
});
