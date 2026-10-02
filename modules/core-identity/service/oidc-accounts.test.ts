// Creating accounts from OIDC logins and linking identities: provisioning, linking by a verified
// email, linking from the profile, and the rollback of the writes.
import { ANONYMOUS, Conflict, Forbidden, Unauthorized } from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { createMemoryMailer } from './mailer.ts';
import { tokenFrom } from '../test/mail.ts';
import { count, flow, fresh, rows, sessionActor, settingsWith, start } from '../test/oidc.ts';

describe('the first login (provisioning)', () => {
  it('creates a pending user and its identity, emits registered@1, and starts no session', async () => {
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
    expect(await rows(kernel, 'select payload from kernel_outbox')).toEqual([
      { payload: expect.objectContaining({ username: 'quick', status: 'active' }) as unknown },
    ]);
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
      await makeUser(kernel.pool, { username: name });
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

describe('linking by a verified email', () => {
  it('adds the identity to the account whose verified address matches, and signs it in', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool, { email: 'ann@example.org', emailVerified: true });
    const done = await id.oidc.complete(await flow(id, fresh({ email: 'ANN@example.org' })));
    expect(done).toMatchObject({ kind: 'login' });
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect((await rows(kernel, 'select user_id, provider from identity_auth_method'))[0]).toEqual({
      user_id: user.id,
      provider: 'stub',
    });
    expect(await rows(kernel, 'select name, payload from kernel_outbox')).toEqual([
      {
        name: 'identity.authMethod.linked@1',
        payload: { userId: user.id, username: user.username, provider: 'stub', via: 'email' },
      },
    ]);
  });

  it('never takes over an account whose address nobody confirmed (409), and links nothing', async () => {
    const { kernel, identity: id } = await start();
    await makeUser(kernel.pool, { email: 'ann@example.org', emailVerified: false });
    const error = await id.oidc
      .complete(await flow(id, fresh({ email: 'ann@example.org' })))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Conflict);
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
    expect(await count(kernel, 'identity_session')).toBe(0);
  });

  it('takes over a password account only after its owner confirmed the address by mail (sprint 5)', async () => {
    const mailer = createMemoryMailer();
    const { kernel, identity: id } = await start({ mailer });
    const user = await id.accounts.register({
      username: 'ann',
      email: 'ann@example.org',
      password: 'correct horse battery',
    });
    await kernel.pool.query("update identity_user set status = 'active'");
    // Before the confirmation the address proves nothing: the same 409 as for any unconfirmed one.
    await expect(
      id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' }))),
    ).rejects.toBeInstanceOf(Conflict);

    await id.recovery.confirmEmail({ token: tokenFrom(mailer.sent[0]) });
    const done = await id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' })));
    expect(done).toMatchObject({ kind: 'login' });
    expect(
      await rows(kernel, "select user_id from identity_auth_method where provider = 'stub'"),
    ).toEqual([{ user_id: user.id }]);
  });

  it('never links by an address the provider did not vouch for', async () => {
    const { kernel, identity: id } = await start();
    await makeUser(kernel.pool, { email: 'ann@example.org', emailVerified: true });
    await expect(
      id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org', emailVerified: false }))),
    ).rejects.toBeInstanceOf(Forbidden); // a new, pending account without an address
    expect(await count(kernel, 'identity_user')).toBe(2);
    expect(
      await rows(kernel, "select user_id from identity_auth_method where provider = 'stub'"),
    ).toHaveLength(1);
  });

  it('does not link to a rejected or deleted account, and says nothing about it', async () => {
    for (const over of [{ status: 'rejected' as const, deleted: true }, { deleted: true }]) {
      const { kernel, identity: id } = await start();
      await makeUser(kernel.pool, { email: 'ann@example.org', emailVerified: true, ...over });
      await expect(
        id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' }))),
      ).rejects.toBeInstanceOf(Unauthorized);
      expect(await count(kernel, 'identity_auth_method')).toBe(0);
    }
  });

  it('links a pending account but gives it no session', async () => {
    const { kernel, identity: id } = await start();
    await makeUser(kernel.pool, {
      email: 'ann@example.org',
      emailVerified: true,
      status: 'pending',
    });
    await expect(
      id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' }))),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await count(kernel, 'identity_auth_method')).toBe(1);
    expect(await count(kernel, 'identity_session')).toBe(0);
  });

  it('rolls the link back when its event cannot be written', async () => {
    const { kernel, identity: id } = await start();
    await makeUser(kernel.pool, { email: 'ann@example.org', emailVerified: true });
    await kernel.pool.query(`
      create function identity_test_fail() returns trigger language plpgsql as
        $$ begin raise exception 'outbox on fire'; end $$;
      create trigger identity_test_fail before insert on kernel_outbox
        for each row execute function identity_test_fail();`);
    await expect(
      id.oidc.complete(await flow(id, fresh({ email: 'ann@example.org' }))),
    ).rejects.toThrow();
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
    expect(await count(kernel, 'identity_session')).toBe(0);
  });
});

describe('linking from the profile', () => {
  it('adds the identity to the signed-in user, emits linked@1, and starts no session', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool);
    const input = await flow(
      id,
      fresh({ subject: 'profile-sub', email: 'other@example.org' }),
      sessionActor(user),
    );
    expect(await id.oidc.complete(input)).toEqual({ kind: 'linked' });
    expect(
      await rows(
        kernel,
        "select user_id, subject from identity_auth_method where provider = 'stub'",
      ),
    ).toEqual([{ user_id: user.id, subject: 'profile-sub' }]);
    expect(await count(kernel, 'identity_session')).toBe(0);
    expect(await rows(kernel, 'select name, payload from kernel_outbox')).toEqual([
      {
        name: 'identity.authMethod.linked@1',
        payload: { userId: user.id, username: user.username, provider: 'stub', via: 'profile' },
      },
    ]);
  });

  it('can then be used to sign in', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool);
    await id.oidc.complete(await flow(id, fresh({ subject: 'profile-sub' }), sessionActor(user)));
    const done = await id.oidc.complete(await flow(id, fresh({ subject: 'profile-sub' })));
    const resolved = await id.sessions.resolve((done as { sessionId: string }).sessionId);
    expect(resolved?.userId).toBe(user.id);
  });

  it('refuses an anonymous caller (401) and a token caller (403), and stores no state', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool);
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

  it('is a 409 when the identity belongs to another user', async () => {
    const { kernel, identity: id } = await start();
    const owner = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, owner, { provider: 'stub', subject: 'shared-sub' });
    const thief = await makeUser(kernel.pool);
    await expect(
      id.oidc.complete(await flow(id, fresh({ subject: 'shared-sub' }), sessionActor(thief))),
    ).rejects.toBeInstanceOf(Conflict);
    expect(
      await rows(kernel, "select user_id from identity_auth_method where provider = 'stub'"),
    ).toEqual([{ user_id: owner.id }]);
  });

  it('is a 409 when the user already has this provider', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, user, { provider: 'stub', subject: 'first' });
    await expect(
      id.oidc.complete(await flow(id, fresh({ subject: 'second' }), sessionActor(user))),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('links nothing for a user who was deleted after starting', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool);
    const input = await flow(id, fresh(), sessionActor(user));
    await kernel.pool.query('update identity_user set deleted_at = now() where id = $1', [user.id]);
    await expect(id.oidc.complete(input)).rejects.toBeInstanceOf(Unauthorized);
    expect(await count(kernel, 'identity_auth_method')).toBe(0);
  });
});
