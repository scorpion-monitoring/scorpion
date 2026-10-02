// Password reset, password change and email verification on real Postgres: what is stored, what
// is mailed, what each refusal looks like, and what a rollback leaves behind.
import {
  ANONYMOUS,
  Conflict,
  Forbidden,
  Invalid,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { failOutbox, tokenFrom } from '../test/mail.ts';
import { useIdentity } from '../test/harness.ts';
import { hashMailToken } from './mail-tokens.ts';
import { TooManyRequests } from './errors.ts';
import { createMemoryMailer } from './mailer.ts';
import { BadRequest } from './oidc-errors.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { settingsSchema, type IdentitySettings } from './settings.ts';

const identity = useIdentity();
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another long passphrase';

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const rows = async (kernel: { pool: Pool }, sql: string, values?: unknown[]) =>
  (await kernel.pool.query(sql, values)).rows as Record<string, unknown>[];
const actorOf = (
  user: { id: string; username: string },
  via: 'session' | 'token' = 'session',
): Actor => ({ kind: 'user', userId: user.id, username: user.username, roles: [], via });
const settingsOf = (
  values: Partial<ReturnType<typeof settingsSchema.parse>>,
): IdentitySettings => ({
  get: () => Promise.resolve(settingsSchema.parse(values)),
});

async function start(options: Parameters<typeof identity.start>[0] = {}) {
  const mailer = createMemoryMailer();
  const started = await identity.start({ mailer, ...options });
  const withPassword = async (overrides: Parameters<typeof makeUser>[1] = {}) => {
    const user = await makeUser(started.kernel.pool, { emailVerified: false, ...overrides });
    await makeAuthMethod(started.kernel.pool, user, { passwordHash: await hashPassword(PASSWORD) });
    return user;
  };
  const { recovery } = started.identity;
  return { ...started, mailer, recovery, withPassword };
}

describe('requestReset', () => {
  it('mails one link to the account behind the address, and stores only a hash of the token', async () => {
    const { kernel, mailer, recovery, withPassword } = await start({
      env: { ORIGIN: 'https://registry.example.org', BASE_PATH: '/a/b' },
    });
    const user = await withPassword({ email: 'alice@example.org' });

    await recovery.requestReset({ email: 'Alice@Example.org' });

    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0]!;
    expect(mail).toMatchObject({ kind: 'password-reset', to: 'Alice@Example.org' });
    expect(mail.text).toContain('https://registry.example.org/a/b/reset-password#token=srt_');
    const token = tokenFrom(mail);
    const stored = await rows(kernel, 'select * from identity_mail_token');
    expect(stored).toEqual([
      expect.objectContaining({
        user_id: user.id,
        purpose: 'password-reset',
        secret_hash: hashMailToken(token),
        used_at: null,
      }) as unknown,
    ]);
    expect(JSON.stringify(stored)).not.toContain(token);
    // The event says who and what, never the token.
    const events = await rows(kernel, 'select name, payload from kernel_outbox');
    expect(events).toEqual([
      {
        name: 'identity.password.resetRequested@1',
        payload: { userId: user.id, username: user.username },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it('is silent for an unknown address and for accounts that cannot use a password', async () => {
    const { kernel, mailer, recovery, withPassword } = await start();
    const pending = await withPassword({ status: 'pending', email: 'pending@example.org' });
    await withPassword({ status: 'rejected', deleted: true, email: 'rejected@example.org' });
    await withPassword({ deleted: true, email: 'deleted@example.org' });
    const oidcOnly = await makeUser(kernel.pool, { email: 'oidc@example.org' });
    await makeAuthMethod(kernel.pool, oidcOnly, { provider: 'stub' });
    expect(pending.status).toBe('pending');

    for (const email of [
      'nobody@example.org',
      'pending@example.org',
      'rejected@example.org',
      'deleted@example.org',
      'oidc@example.org',
    ]) {
      await expect(recovery.requestReset({ email })).resolves.toBeUndefined();
    }
    expect(mailer.sent).toEqual([]);
    expect(await rows(kernel, 'select 1 from identity_mail_token')).toEqual([]);
    expect(await rows(kernel, 'select 1 from kernel_outbox')).toEqual([]);
  });

  it('gives an address three mails an hour, and spends the budget for unknown addresses too', async () => {
    const { kernel, mailer, recovery, withPassword } = await start();
    await withPassword({ email: 'alice@example.org' });
    for (let i = 0; i < 5; i++) await recovery.requestReset({ email: 'alice@example.org' });
    expect(mailer.sent).toHaveLength(3);

    await recovery.requestReset({ email: 'ghost@example.org' });
    const keys = await rows(
      kernel,
      "select key from kernel_rate_bucket where key like 'identity.mail:%'",
    );
    expect(keys).toHaveLength(2); // the known and the unknown address look alike
    expect(JSON.stringify(keys)).not.toContain('alice'); // hashed, not the address
  });

  it('replaces the outstanding link: only the newest one works', async () => {
    const { mailer, recovery, withPassword } = await start();
    await withPassword({ email: 'alice@example.org' });
    await recovery.requestReset({ email: 'alice@example.org' });
    await recovery.requestReset({ email: 'alice@example.org' });
    const [first, second] = mailer.sent.map(tokenFrom);

    await expect(
      recovery.confirmReset({ token: first, password: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(BadRequest);
    await expect(
      recovery.confirmReset({ token: second, password: NEW_PASSWORD }),
    ).resolves.toBeUndefined();
  });

  it('answers the same when the mail transport fails, and logs nothing from the mail', async () => {
    const { kernel, mailer, recovery, withPassword } = await start();
    await withPassword({ email: 'alice@example.org' });
    mailer.failWith(new Error('550 alice@example.org rejected'));
    await expect(recovery.requestReset({ email: 'alice@example.org' })).resolves.toBeUndefined();
    // The token is stored: the mail was the part that failed, and a new request replaces it.
    expect(await rows(kernel, 'select 1 from identity_mail_token')).toHaveLength(1);
  });

  it('is refused (403) when local accounts are off, and a malformed address is a 422', async () => {
    const off = await start({ settings: settingsOf({ localAccounts: false }) });
    await expect(off.recovery.requestReset({ email: 'a@example.org' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    const on = await start();
    for (const email of ['nope', '', undefined, 'a@b.c'.repeat(100)]) {
      await expect(on.recovery.requestReset({ email })).rejects.toBeInstanceOf(Invalid);
    }
    await expect(
      on.recovery.requestReset({ email: 'a@example.org', extra: 1 }),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('writes no token and sends no mail when the event cannot be written (rollback)', async () => {
    const { kernel, mailer, recovery, withPassword } = await start();
    await withPassword({ email: 'alice@example.org' });
    await failOutbox(kernel);
    await expect(recovery.requestReset({ email: 'alice@example.org' })).rejects.toThrow();
    expect(await rows(kernel, 'select 1 from identity_mail_token')).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });
});

describe('confirmReset', () => {
  async function requested() {
    const s = await start({ tokenCacheTtlMs: 0 });
    const user = await s.withPassword({ email: 'alice@example.org' });
    await s.recovery.requestReset({ email: 'alice@example.org' });
    return { ...s, user, token: tokenFrom(s.mailer.sent[0]) };
  }

  it('sets the password, ends every session and every outstanding link, and keeps access tokens', async () => {
    const { kernel, identity: id, recovery, user, token } = await requested();
    const sessionA = await id.sessions.create(user.id);
    const sessionB = await id.sessions.create(user.id);
    const other = await makeUser(kernel.pool);
    const otherSession = await id.sessions.create(other.id);
    const pat = await id.tokens.create(actorOf(user), { name: 'ci' });

    await recovery.confirmReset({ token, password: NEW_PASSWORD });

    const [method] = await rows(
      kernel,
      'select password_hash from identity_auth_method where user_id = $1',
      [user.id],
    );
    expect(await verifyPassword(method!.password_hash as string, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(method!.password_hash as string, PASSWORD)).toBe(false);
    for (const s of [sessionA, sessionB]) expect(await id.sessions.resolve(s.id)).toBeUndefined();
    expect(await id.sessions.resolve(otherSession.id)).toBeDefined(); // somebody else's session is not touched
    expect(await id.tokens.authenticate(pat.token)).toBeDefined(); // ADR 0012: access tokens are not sessions
    expect(
      await rows(
        kernel,
        "select 1 from identity_mail_token where purpose = 'password-reset' and used_at is null",
      ),
    ).toEqual([]);
    expect(
      await rows(
        kernel,
        "select payload from kernel_outbox where name = 'identity.password.reset@1'",
      ),
    ).toEqual([{ payload: { userId: user.id, username: user.username } }]);
    // The new password signs in, the old one does not.
    await expect(
      id.accounts.login({ username: user.username, password: PASSWORD }),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      id.accounts.login({ username: user.username, password: NEW_PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('works once', async () => {
    const { recovery, token } = await requested();
    await recovery.confirmReset({ token, password: NEW_PASSWORD });
    await expect(
      recovery.confirmReset({ token, password: 'a third passphrase' }),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it('is the same 400 for unknown, malformed, expired, used and wrong-purpose tokens', async () => {
    const { kernel, mailer, recovery, user, token } = await requested();
    await recovery.startVerification(user.id, 'alice@example.org');
    const verification = tokenFrom(mailer.sent[1]);
    const expired = await requested();
    await expired.kernel.pool.query(
      "update identity_mail_token set expires_at = now() - interval '1 second'",
    );

    const messages = new Set<string>();
    const refused = [
      [recovery, 'srt_' + 'A'.repeat(43)], // well-formed, unknown
      [recovery, 'not a token'],
      [recovery, verification], // a verification token is not a reset token
      [expired.recovery, expired.token],
    ] as const;
    for (const [service, bad] of refused) {
      const error = await service
        .confirmReset({ token: bad, password: NEW_PASSWORD })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequest);
      messages.add((error as Error).message);
    }
    expect(messages.size).toBe(1);
    // None of that used up the good token.
    await expect(recovery.confirmReset({ token, password: NEW_PASSWORD })).resolves.toBeUndefined();
    void kernel;
  });

  it('rejects a weak password (422) without using up the link', async () => {
    const { recovery, token } = await requested();
    await expect(recovery.confirmReset({ token, password: 'short' })).rejects.toBeInstanceOf(
      Invalid,
    );
    await expect(recovery.confirmReset({ token, password: NEW_PASSWORD })).resolves.toBeUndefined();
  });

  it('refuses a link for an account that is no longer active', async () => {
    const { kernel, recovery, token } = await requested();
    await kernel.pool.query("update identity_user set deleted_at = now(), status = 'rejected'");
    await expect(recovery.confirmReset({ token, password: NEW_PASSWORD })).rejects.toBeInstanceOf(
      BadRequest,
    );
  });

  it('lets exactly one of two parallel requests with the same link win', async () => {
    const { recovery, token } = await requested();
    const results = await Promise.allSettled([
      recovery.confirmReset({ token, password: NEW_PASSWORD }),
      recovery.confirmReset({ token, password: 'a third passphrase' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('changes nothing, and leaves the link usable, when the event cannot be written (rollback)', async () => {
    const { kernel, identity: id, recovery, user, token } = await requested();
    const session = await id.sessions.create(user.id);
    await failOutbox(kernel);
    await expect(recovery.confirmReset({ token, password: NEW_PASSWORD })).rejects.toThrow();

    const [method] = await rows(
      kernel,
      'select password_hash from identity_auth_method where user_id = $1',
      [user.id],
    );
    expect(await verifyPassword(method!.password_hash as string, PASSWORD)).toBe(true);
    expect(await id.sessions.resolve(session.id)).toBeDefined();
    expect(await rows(kernel, 'select used_at from identity_mail_token')).toEqual([
      { used_at: null },
    ]);
  });

  it('is refused (403) when local accounts are off', async () => {
    const { recovery } = await start({ settings: settingsOf({ localAccounts: false }) });
    await expect(
      recovery.confirmReset({ token: 'srt_' + 'A'.repeat(43), password: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('changePassword', () => {
  it('needs the current password, sets the new one and ends every session, the caller’s included', async () => {
    const { kernel, identity: id, recovery, withPassword } = await start({ tokenCacheTtlMs: 0 });
    const user = await withPassword();
    const other = await withPassword();
    const mine = await id.sessions.create(user.id);
    const theirs = await id.sessions.create(other.id);
    const pat = await id.tokens.create(actorOf(user), { name: 'ci' });
    await recovery.requestReset({ email: user.email! });

    await recovery.changePassword(actorOf(user), {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(await id.sessions.resolve(mine.id)).toBeUndefined();
    expect(await id.sessions.resolve(theirs.id)).toBeDefined();
    expect(await id.tokens.authenticate(pat.token)).toBeDefined();
    expect(
      await rows(kernel, "select 1 from identity_mail_token where purpose = 'password-reset'"),
    ).toEqual([]);
    await expect(
      id.accounts.login({ username: user.username, password: PASSWORD }),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      id.accounts.login({ username: user.username, password: NEW_PASSWORD }),
    ).resolves.toBeDefined();
    expect(
      await rows(
        kernel,
        "select payload from kernel_outbox where name = 'identity.password.changed@1'",
      ),
    ).toEqual([{ payload: { userId: user.id, username: user.username } }]);
  });

  it('refuses a wrong current password (422) and changes nothing', async () => {
    const { identity: id, recovery, withPassword } = await start();
    const user = await withPassword();
    const session = await id.sessions.create(user.id);
    const error = await recovery
      .changePassword(actorOf(user), {
        currentPassword: 'wrong password',
        newPassword: NEW_PASSWORD,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Invalid);
    expect(JSON.stringify((error as Invalid).errors)).not.toContain('wrong password');
    expect(await id.sessions.resolve(session.id)).toBeDefined();
    await expect(
      id.accounts.login({ username: user.username, password: PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('refuses a weak new password (422), an anonymous caller (401), a token caller (403) and an account without a password (409)', async () => {
    const { kernel, recovery, withPassword } = await start();
    const user = await withPassword();
    const input = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };
    await expect(
      recovery.changePassword(actorOf(user), { ...input, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(recovery.changePassword(ANONYMOUS, input)).rejects.toBeInstanceOf(Unauthorized);
    await expect(recovery.changePassword(actorOf(user, 'token'), input)).rejects.toBeInstanceOf(
      Forbidden,
    );
    const oidcOnly = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, oidcOnly, { provider: 'stub' });
    await expect(recovery.changePassword(actorOf(oidcOnly), input)).rejects.toBeInstanceOf(
      Conflict,
    );
  });

  it('is refused (403) when local accounts are off', async () => {
    const { recovery, withPassword } = await start({
      settings: settingsOf({ localAccounts: false }),
    });
    const user = await withPassword();
    await expect(
      recovery.changePassword(actorOf(user), {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('keeps the old password and the sessions when the event cannot be written (rollback)', async () => {
    const { kernel, identity: id, recovery, withPassword } = await start();
    const user = await withPassword();
    const session = await id.sessions.create(user.id);
    await failOutbox(kernel);
    await expect(
      recovery.changePassword(actorOf(user), {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow();
    expect(await id.sessions.resolve(session.id)).toBeDefined();
    const [method] = await rows(
      kernel,
      'select password_hash from identity_auth_method where user_id = $1',
      [user.id],
    );
    expect(await verifyPassword(method!.password_hash as string, PASSWORD)).toBe(true);
  });
});

describe('email verification', () => {
  it('is started by registering: one mail, and the link confirms the address once', async () => {
    const { identity: id, mailer, recovery } = await start();
    const user = await id.accounts.register({
      username: 'alice',
      email: 'alice@example.org',
      password: PASSWORD,
    });
    expect(user.emailVerified).toBe(false);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ kind: 'email-verification', to: 'alice@example.org' });
    const token = tokenFrom(mailer.sent[0]);

    await recovery.confirmEmail({ token });

    expect((await id.users.findById(user.id))?.emailVerified).toBe(true);
    await expect(recovery.confirmEmail({ token })).rejects.toBeInstanceOf(BadRequest);
  });

  it('still registers when the mail cannot be sent, and when no transport is configured', async () => {
    const { identity: id, mailer } = await start();
    mailer.failWith(new Error('down'));
    await expect(
      id.accounts.register({ username: 'alice', email: 'alice@example.org', password: PASSWORD }),
    ).resolves.toMatchObject({ username: 'alice' });
    const bare = await identity.start(); // no mailer: refuses to send
    await expect(
      bare.identity.accounts.register({
        username: 'bob',
        email: 'bob@example.org',
        password: PASSWORD,
      }),
    ).resolves.toMatchObject({ username: 'bob' });
  });

  it('confirms a new address and only then replaces the old one', async () => {
    const { identity: id, mailer, recovery, withPassword } = await start();
    const user = await withPassword({ email: 'old@example.org', emailVerified: true });

    await recovery.startVerification(user.id, 'new@example.org');
    expect(mailer.sent.map((m) => m.to)).toEqual(['new@example.org']);
    expect(await id.users.findById(user.id)).toMatchObject({
      email: 'old@example.org',
      emailVerified: true,
    });

    await recovery.confirmEmail({ token: tokenFrom(mailer.sent[0]) });
    expect(await id.users.findById(user.id)).toMatchObject({
      email: 'new@example.org',
      emailVerified: true,
    });
  });

  it('refuses the link when another account has taken the address meanwhile, or the account is gone', async () => {
    const { kernel, mailer, recovery, withPassword } = await start();
    const user = await withPassword({ email: 'old@example.org' });
    await recovery.startVerification(user.id, 'new@example.org');
    await makeUser(kernel.pool, { email: 'New@Example.org' });
    await expect(
      recovery.confirmEmail({ token: tokenFrom(mailer.sent[0]) }),
    ).rejects.toBeInstanceOf(BadRequest);

    const gone = await withPassword({ email: 'gone@example.org' });
    await recovery.startVerification(gone.id, 'gone@example.org');
    await kernel.pool.query(
      "update identity_user set deleted_at = now(), status = 'rejected' where id = $1",
      [gone.id],
    );
    await expect(
      recovery.confirmEmail({ token: tokenFrom(mailer.sent[1]) }),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it('is the same 400 for unknown, malformed, expired and reset tokens', async () => {
    const { kernel, mailer, recovery, withPassword } = await start();
    const user = await withPassword({ email: 'alice@example.org' });
    await recovery.requestReset({ email: 'alice@example.org' });
    const reset = tokenFrom(mailer.sent[0]);
    await recovery.startVerification(user.id, 'alice@example.org');
    const expired = tokenFrom(mailer.sent[1]);
    await kernel.pool.query(
      "update identity_mail_token set expires_at = now() - interval '1 second' where purpose = 'email-verification'",
    );

    const messages = new Set<string>();
    for (const token of ['sev_' + 'A'.repeat(43), 'junk', reset, expired]) {
      const error = await recovery.confirmEmail({ token }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequest);
      messages.add((error as Error).message);
    }
    expect(messages.size).toBe(1);
    await expect(recovery.confirmEmail({ token: '' })).rejects.toBeInstanceOf(Invalid);
  });

  it('leaves the address unconfirmed when the event cannot be written (rollback)', async () => {
    const { kernel, mailer, recovery, withPassword } = await start();
    const user = await withPassword({ email: 'alice@example.org' });
    await recovery.startVerification(user.id, 'alice@example.org');
    await failOutbox(kernel);
    await expect(recovery.confirmEmail({ token: tokenFrom(mailer.sent[0]) })).rejects.toThrow();
    expect(await rows(kernel, 'select email_verified_at from identity_user')).toEqual([
      { email_verified_at: null },
    ]);
    expect(await rows(kernel, 'select used_at from identity_mail_token')).toEqual([
      { used_at: null },
    ]);
  });

  it('mails a fresh link on request, five times an hour, and not for a confirmed address', async () => {
    const { mailer, recovery, withPassword } = await start();
    const user = await withPassword({ email: 'alice@example.org' });
    await recovery.resendVerification(actorOf(user));
    expect(mailer.sent).toHaveLength(1);

    const confirmed = await withPassword({ email: 'bob@example.org', emailVerified: true });
    await expect(recovery.resendVerification(actorOf(confirmed))).rejects.toBeInstanceOf(Conflict);
    await expect(recovery.resendVerification(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    await expect(recovery.resendVerification(actorOf(user, 'token'))).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('answers 429 to the sixth request for a link within an hour (a limit of the caller, not of an address)', async () => {
    const { recovery, withPassword } = await start();
    const user = await withPassword({ email: 'alice@example.org' });
    for (let i = 0; i < 5; i++) await recovery.resendVerification(actorOf(user));
    await expect(recovery.resendVerification(actorOf(user))).rejects.toBeInstanceOf(
      TooManyRequests,
    );
  });

  it('resends to the address that waits for confirmation, not the current one', async () => {
    const { mailer, recovery, withPassword } = await start();
    const user = await withPassword({ email: 'old@example.org', emailVerified: true });
    await recovery.startVerification(user.id, 'new@example.org', { send: false });
    await recovery.resendVerification(actorOf(user));
    expect(mailer.sent.map((m) => m.to)).toEqual(['new@example.org']);
  });
});
