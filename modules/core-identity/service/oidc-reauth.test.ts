// Re-authentication at an OIDC provider (ADR 0025): the request asks for a login now (`prompt=login`,
// `max_age=0`), and the callback accepts it only with an `auth_time` that is not older than the
// request and the same `sub` as the caller's own sign-in there. It changes the authentication time of
// one session and nothing else: no session is created or replaced.
import {
  ANONYMOUS,
  Forbidden,
  NotFound,
  ReauthenticationRequired,
  Unauthorized,
} from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { makeMember } from '../test/harness.ts';
import { failOutbox } from '../test/mail.ts';
import {
  count,
  flow,
  idp,
  reauthFlow,
  rows,
  sessionActor,
  sessionActorFor,
  start,
} from '../test/oidc.ts';
import { BadRequest, InvalidIdToken } from './oidc-errors.ts';

const HOUR = 3600_000;
const now = () => Math.floor(Date.now() / 1000);

afterEach(() => {
  idp.faults = {};
});

/** A user who signed in at the stub provider as `subject`, with a session that began two hours ago. */
async function setup() {
  const started = await start({ sessionCacheTtlMs: 0 });
  const { kernel, identity: id } = started;
  const user = await makeMember(kernel.pool, { username: 'olga' });
  await makeAuthMethod(kernel.pool, user, { provider: 'stub', subject: 'olga-at-stub' });
  const created = await id.sessions.create(user.id, undefined, new Date(Date.now() - 2 * HOUR));
  const actor = sessionActor(user, created.sessionId);
  const login = { subject: 'olga-at-stub' };
  const authenticatedAt = async () =>
    (
      await rows(kernel, 'select authenticated_at from identity_session where id = $1', [
        created.sessionId,
      ])
    )[0]!.authenticated_at as Date;
  return { ...started, user, created, actor, login, authenticatedAt };
}

describe('startReauthentication', () => {
  it('asks the provider for a login now: prompt=login and max_age=0, and stores a reauth state for this session', async () => {
    const { kernel, identity: id, actor, user, created } = await setup();
    const started = await id.oidc.startReauthentication(actor, 'stub');
    const q = new URL(started.authorizationUrl).searchParams;
    expect(q.get('prompt')).toBe('login');
    expect(q.get('max_age')).toBe('0');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      await rows(
        kernel,
        'select purpose, link_user_id, reauth_session_id from identity_login_state',
      ),
    ).toEqual([{ purpose: 'reauth', link_user_id: user.id, reauth_session_id: created.sessionId }]);
  });

  it('does not put prompt or max_age on an ordinary login or a link', async () => {
    const { identity: id, user } = await setup();
    const login = new URL((await id.oidc.start('stub')).authorizationUrl).searchParams;
    const fresher = await sessionActorFor(id, user); // a session that was just authenticated
    const link = new URL((await id.oidc.startLink(fresher, 'stub')).authorizationUrl).searchParams;
    for (const q of [login, link]) {
      expect(q.get('prompt')).toBeNull();
      expect(q.get('max_age')).toBeNull();
    }
  });

  it('is a 404 for a provider the account has never signed in with, and for an unknown one', async () => {
    const { kernel, identity: id } = await setup();
    const stranger = await makeMember(kernel.pool, { username: 'sam' });
    const session = await id.sessions.create(stranger.id);
    const actor = sessionActor(stranger, session.sessionId);
    await expect(id.oidc.startReauthentication(actor, 'stub')).rejects.toBeInstanceOf(NotFound);
    await expect(id.oidc.startReauthentication(actor, 'nowhere')).rejects.toBeInstanceOf(NotFound);
    expect(await count(kernel, 'identity_login_state')).toBe(0);
  });

  it('refuses an anonymous caller, a token, a user without the permission and a session without an id (denied)', async () => {
    const { kernel, identity: id, user } = await setup();
    const nobody = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, nobody, { provider: 'stub' });
    const nobodys = await id.sessions.create(nobody.id);
    await expect(id.oidc.startReauthentication(ANONYMOUS, 'stub')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(
      id.oidc.startReauthentication(
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
    await expect(
      id.oidc.startReauthentication(sessionActor(nobody, nobodys.sessionId), 'stub'),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(id.oidc.startReauthentication(sessionActor(user), 'stub')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(await count(kernel, 'identity_login_state')).toBe(0);
  });
});

describe('completing a re-authentication', () => {
  it('sets the authentication time of that session to now, creates no session, and emits the event', async () => {
    const { kernel, identity: id, actor, login, authenticatedAt, user } = await setup();
    await expect(id.sessions.requireRecentAuth(actor)).rejects.toBeInstanceOf(
      ReauthenticationRequired,
    );
    const before = Date.now();

    const done = await id.oidc.complete(await reauthFlow(id, actor, login));

    expect(done).toEqual({ kind: 'reauthenticated' });
    expect((await authenticatedAt()).getTime()).toBeGreaterThanOrEqual(before - 1000);
    await expect(id.sessions.requireRecentAuth(actor)).resolves.toBeUndefined();
    expect(await count(kernel, 'identity_session')).toBe(1);
    expect(await count(kernel, 'identity_login_state')).toBe(0); // single use
    expect(await rows(kernel, 'select name, payload from kernel_outbox')).toEqual([
      {
        name: 'identity.session.reauthenticated@1',
        payload: { userId: user.id, username: 'olga', method: 'oidc' },
      },
    ]);
  });

  it('refuses an auth_time older than the request, from a provider that ignored prompt=login [ASVS-6.8.4]', async () => {
    const { identity: id, actor, login, authenticatedAt } = await setup();
    const was = await authenticatedAt();
    idp.faults = { ignorePrompt: true }; // answers from its single sign-on session ...

    const input = await reauthFlow(id, actor, { ...login, authTime: now() - 3600 }); // ... of an hour ago
    const error = await id.oidc.complete(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidIdToken);
    expect(error).toMatchObject({ reason: 'auth-time-stale', status: 401 });
    expect(await authenticatedAt()).toEqual(was);
    await expect(id.sessions.requireRecentAuth(actor)).rejects.toBeInstanceOf(
      ReauthenticationRequired,
    );
  });

  it.each([
    [
      'no auth_time although max_age was asked',
      { omit: ['auth_time' as const] },
      'auth-time-missing',
    ],
    [
      'a provider that ignores the request and sends none',
      { ignorePrompt: true },
      'auth-time-missing',
    ],
    ['an auth_time 90 seconds before the request', { authTimeOffset: -90 }, 'auth-time-stale'],
    ['an auth_time a day before the request', { authTimeOffset: -86_400 }, 'auth-time-stale'],
  ])('refuses %s', async (_name, faults, reason) => {
    const { identity: id, actor, login, authenticatedAt } = await setup();
    const was = await authenticatedAt();
    idp.faults = faults;
    const error = await id.oidc
      .complete(await reauthFlow(id, actor, login))
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ reason });
    expect(await authenticatedAt()).toEqual(was);
  });

  it.each([
    ['an auth_time of the moment of the request', 0],
    ['an auth_time 30 seconds before it (clock skew)', -30],
    ['an auth_time a little after it', 5],
  ])('accepts %s', async (_name, authTimeOffset) => {
    const { identity: id, actor, login } = await setup();
    idp.faults = { authTimeOffset };
    expect(await id.oidc.complete(await reauthFlow(id, actor, login))).toEqual({
      kind: 'reauthenticated',
    });
  });

  it('refuses another person at the same provider: the sub must be the caller’s own', async () => {
    const { identity: id, actor, authenticatedAt, kernel } = await setup();
    const was = await authenticatedAt();
    const error = await id.oidc
      .complete(await reauthFlow(id, actor, { subject: 'somebody-else' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Unauthorized);
    expect(await authenticatedAt()).toEqual(was);
    expect(await count(kernel, 'kernel_outbox')).toBe(0);
  });

  it('refuses a session that was ended while the provider was asking', async () => {
    const { identity: id, actor, login, created, user, authenticatedAt } = await setup();
    const input = await reauthFlow(id, actor, login);
    await id.sessions.revokeOwn(user.id, created.sessionId);
    const was = await authenticatedAt();
    await expect(id.oidc.complete(input)).rejects.toBeInstanceOf(Unauthorized);
    expect(await authenticatedAt()).toEqual(was);
  });

  it('is single use, and a second callback with the same state is a 400', async () => {
    const { identity: id, actor, login } = await setup();
    const input = await reauthFlow(id, actor, login);
    await id.oidc.complete(input);
    await expect(id.oidc.complete(input)).rejects.toBeInstanceOf(BadRequest);
  });

  it('is bound to the browser that started it', async () => {
    const { identity: id, actor, login, authenticatedAt } = await setup();
    const input = await reauthFlow(id, actor, login);
    const was = await authenticatedAt();
    await expect(id.oidc.complete({ ...input, verifier: undefined })).rejects.toBeInstanceOf(
      BadRequest,
    );
    expect(await authenticatedAt()).toEqual(was);
  });

  it('rolls back: when the event cannot be written the authentication time is not set', async () => {
    const { kernel, identity: id, actor, login, authenticatedAt } = await setup();
    const input = await reauthFlow(id, actor, login);
    const was = await authenticatedAt();
    await failOutbox(kernel);
    await expect(id.oidc.complete(input)).rejects.toThrow();
    expect(await authenticatedAt()).toEqual(was);
  });
});

describe('a state is what the stored row says it is', () => {
  it('a login that happens to finish at a provider never re-authenticates a session, and a re-authentication never signs in', async () => {
    const { kernel, identity: id, actor, login, authenticatedAt } = await setup();
    const was = await authenticatedAt();
    // An ordinary login as the same person: a new session, and the old one is untouched.
    const loggedIn = await id.oidc.complete(await flow(id, login));
    expect(loggedIn).toMatchObject({ kind: 'login' });
    expect(await authenticatedAt()).toEqual(was);
    expect(await count(kernel, 'identity_session')).toBe(2);
    // A re-authentication adds no session.
    await id.oidc.complete(await reauthFlow(id, actor, login));
    expect(await count(kernel, 'identity_session')).toBe(2);
  });
});

describe('linking another provider needs a recent authentication', () => {
  it('starting to link needs a recent authentication, and stores no state without it [ASVS-7.5.1]', async () => {
    const { kernel, identity: id, actor, login } = await setup();

    await expect(id.oidc.startLink(actor, 'stub')).rejects.toBeInstanceOf(ReauthenticationRequired);
    expect(await count(kernel, 'identity_login_state')).toBe(0);

    await id.oidc.complete(await reauthFlow(id, actor, login));
    const started = await id.oidc.startLink(actor, 'stub');
    expect(started.authorizationUrl).toContain(idp.issuer);
    expect(await rows(kernel, 'select purpose from identity_login_state')).toEqual([
      { purpose: 'link' },
    ]);
  });
});
