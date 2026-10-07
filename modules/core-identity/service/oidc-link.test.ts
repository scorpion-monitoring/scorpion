// Confirming a link mailed to the account that holds an address (ADR 0026, ASVS 6.8.1): who may
// confirm, once, within 10 minutes, after a recent authentication, and what a failure leaves behind.
import {
  ANONYMOUS,
  Conflict,
  Forbidden,
  Invalid,
  ReauthenticationRequired,
  Unauthorized,
} from '@scorpion/contracts';
import { mailbox, makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { makeMember } from '../test/harness.ts';
import { failOutbox, tokenFrom } from '../test/mail.ts';
import { count, flow, fresh, rows, sessionActorFor, settingsWith, start } from '../test/oidc.ts';
import { BadRequest } from './oidc-errors.ts';

const MINUTE = 60_000;

/** An account that holds ann@example.org and a link mail that somebody's sign-in asked for. */
async function linkAsked(options: Parameters<typeof start>[0] = {}) {
  const started = await start(options);
  const { kernel, identity: id, mail } = started;
  const owner = await makeMember(kernel.pool, { email: 'ann@example.org', emailVerified: true });
  const login = fresh({ email: 'ann@example.org', subject: 'asserted-sub' });
  await id.oidc.complete(await flow(id, login));
  const token = tokenFrom((await mail.of('identity.oidc-link'))[0]);
  return { ...started, owner, token, login };
}
const linked = (kernel: Parameters<typeof count>[0]) =>
  rows(kernel, "select user_id, subject from identity_auth_method where provider = 'stub'");

describe('confirming the link', () => {
  it('links the identity when the account holder confirms, signed in, and names the provider [ASVS-6.8.1]', async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    const actor = await sessionActorFor(id, owner);

    const done = await id.oidcLink.confirm(actor, { token });

    expect(done).toEqual({ provider: 'stub', name: 'Stub provider' });
    expect(await linked(kernel)).toEqual([{ user_id: owner.id, subject: 'asserted-sub' }]);
    expect(
      await rows(
        kernel,
        "select payload from kernel_outbox where name = 'identity.authMethod.linked@1'",
      ),
    ).toEqual([
      {
        payload: { userId: owner.id, username: owner.username, provider: 'stub', via: 'email' },
      },
    ]);
    // Linking starts no session of its own: the caller's is the only one.
    expect(await count(kernel, 'identity_session')).toBe(1);
    // And now the identity signs in to that account.
    const login = await id.oidc.complete(await flow(id, fresh({ subject: 'asserted-sub' })));
    const resolved = await id.sessions.resolve((login as { sessionId: string }).sessionId);
    expect(resolved?.userId).toBe(owner.id);
  });

  it('links exactly once: the second confirmation is refused', async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    const actor = await sessionActorFor(id, owner);
    await id.oidcLink.confirm(actor, { token });

    await expect(id.oidcLink.confirm(actor, { token })).rejects.toBeInstanceOf(BadRequest);
    expect(await linked(kernel)).toHaveLength(1);
    expect(await rows(kernel, 'select used_at from identity_mail_token')).toEqual([
      { used_at: expect.any(Date) as unknown },
    ]);
  });

  it('lets exactly one of two parallel confirmations win', async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    const actor = await sessionActorFor(id, owner);
    const results = await Promise.allSettled([
      id.oidcLink.confirm(actor, { token }),
      id.oidcLink.confirm(actor, { token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await linked(kernel)).toHaveLength(1);
  });

  it('expires after 10 minutes: refused a moment after, accepted a moment before', async () => {
    const late = await linkAsked();
    const lateActor = await sessionActorFor(late.identity, late.owner);
    await expect(
      late.identity.oidcLink.confirm(
        lateActor,
        { token: late.token },
        new Date(Date.now() + 10 * MINUTE + 5_000),
      ),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(await linked(late.kernel)).toEqual([]);

    const inTime = await linkAsked();
    await expect(
      inTime.identity.oidcLink.confirm(
        await sessionActorFor(inTime.identity, inTime.owner),
        { token: inTime.token },
        new Date(Date.now() + 10 * MINUTE - 5_000),
      ),
    ).resolves.toMatchObject({ provider: 'stub' });
  });

  it("is refused for another account's session, which leaves the link usable for its holder", async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    const other = await makeMember(kernel.pool, { email: 'bob@example.org' });

    await expect(
      id.oidcLink.confirm(await sessionActorFor(id, other), { token }),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(await linked(kernel)).toEqual([]);
    expect(await rows(kernel, 'select used_at from identity_mail_token')).toEqual([
      { used_at: null },
    ]);

    await expect(
      id.oidcLink.confirm(await sessionActorFor(id, owner), { token }),
    ).resolves.toMatchObject({ provider: 'stub' });
  });

  it('is the same 400 for a token that is unknown, malformed, of another purpose or for another account', async () => {
    const { identity: id, owner, kernel } = await linkAsked();
    const actor = await sessionActorFor(id, owner);
    await id.recovery.startVerification(owner.id, 'ann@example.org');
    const verification = tokenFrom(
      (await mailbox(kernel.pool).of('identity.email-verification'))[0],
    );
    for (const token of ['sol_' + 'A'.repeat(43), 'junk', 'x'.repeat(128), verification]) {
      await expect(id.oidcLink.confirm(actor, { token })).rejects.toBeInstanceOf(BadRequest);
    }
  });

  it('answers 422, never 500, for a body that is not valid', async () => {
    const { identity: id, owner } = await linkAsked();
    const actor = await sessionActorFor(id, owner);
    for (const body of [
      undefined,
      null,
      {},
      { token: 5 },
      { token: '' },
      { token: 'x'.repeat(129) },
      { token: 'a', extra: 1 },
      'text',
    ]) {
      await expect(id.oidcLink.confirm(actor, body)).rejects.toBeInstanceOf(Invalid);
    }
  });

  it('needs a recent authentication, and spends nothing without it', async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    // A session whose last sign-in was an hour ago (the window is 5 minutes).
    const stale = await sessionActorFor(id, owner, new Date(Date.now() - 60 * MINUTE));

    await expect(id.oidcLink.confirm(stale, { token })).rejects.toBeInstanceOf(
      ReauthenticationRequired,
    );
    expect(await linked(kernel)).toEqual([]);
    expect(await rows(kernel, 'select used_at from identity_mail_token')).toEqual([
      { used_at: null },
    ]);
    await expect(
      id.oidcLink.confirm(await sessionActorFor(id, owner), { token }),
    ).resolves.toMatchObject({ provider: 'stub' });
  });

  it('is refused to an anonymous caller (401), an access token (403) and a user without the permission (403)', async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    await expect(id.oidcLink.confirm(ANONYMOUS, { token })).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      id.oidcLink.confirm(
        {
          kind: 'user',
          userId: owner.id,
          username: owner.username,
          roles: [],
          via: 'token',
          scopes: [],
        },
        { token },
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    // No role: the real authoriser refuses.
    const nobody = await makeUser(kernel.pool, { status: 'active' });
    await expect(
      id.oidcLink.confirm(await sessionActorFor(id, nobody), { token }),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await linked(kernel)).toEqual([]);
  });

  it('is a 409 when the identity was linked to an account meanwhile, and the token is not used up', async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    const thief = await makeMember(kernel.pool);
    await makeAuthMethod(kernel.pool, thief, { provider: 'stub', subject: 'asserted-sub' });

    await expect(
      id.oidcLink.confirm(await sessionActorFor(id, owner), { token }),
    ).rejects.toBeInstanceOf(Conflict);
    expect(await linked(kernel)).toEqual([{ user_id: thief.id, subject: 'asserted-sub' }]);
    expect(await rows(kernel, 'select used_at from identity_mail_token')).toEqual([
      { used_at: null },
    ]);
  });

  it('is refused when the provider is not configured any more', async () => {
    let configured = true;
    const base = settingsWith();
    const {
      identity: id,
      owner,
      token,
    } = await linkAsked({
      settings: {
        get: async () => ({
          ...(await base.get()),
          oidcProviders: configured ? (await base.get()).oidcProviders : [],
        }),
      },
    });
    configured = false;
    await expect(
      id.oidcLink.confirm(await sessionActorFor(id, owner), { token }),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it('works for an account that has no password: it signs in at its other provider first', async () => {
    const { kernel, identity: id, mail } = await start();
    const owner = await makeMember(kernel.pool, { email: 'ann@example.org', emailVerified: true });
    await makeAuthMethod(kernel.pool, owner, { provider: 'corp', subject: 'corp-sub' });
    await id.oidc.complete(
      await flow(id, fresh({ email: 'ann@example.org', subject: 'stub-sub' })),
    );
    const token = tokenFrom((await mail.of('identity.oidc-link'))[0]);
    expect(
      await rows(kernel, 'select 1 from identity_auth_method where password_hash is not null'),
    ).toEqual([]);

    await expect(
      id.oidcLink.confirm(await sessionActorFor(id, owner), { token }),
    ).resolves.toMatchObject({ provider: 'stub' });
    expect(
      await rows(kernel, 'select provider from identity_auth_method order by provider'),
    ).toEqual([{ provider: 'corp' }, { provider: 'stub' }]);
  });

  it('refuses an account that is deleted or no longer active, and links nothing', async () => {
    const { kernel, identity: id, owner, token } = await linkAsked();
    const actor = await sessionActorFor(id, owner);
    await kernel.pool.query("update identity_user set status = 'rejected'");
    await expect(id.oidcLink.confirm(actor, { token })).rejects.toBeInstanceOf(Unauthorized);
    expect(await linked(kernel)).toEqual([]);
  });

  describe('rollback', () => {
    it('links nothing and keeps the token usable when the event cannot be written', async () => {
      const { kernel, identity: id, owner, token } = await linkAsked();
      const actor = await sessionActorFor(id, owner);
      await failOutbox(kernel);
      await expect(id.oidcLink.confirm(actor, { token })).rejects.toThrow();
      expect(await linked(kernel)).toEqual([]);
      expect(await rows(kernel, 'select used_at from identity_mail_token')).toEqual([
        { used_at: null },
      ]);
    });
  });
});
