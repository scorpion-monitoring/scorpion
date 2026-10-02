// The OIDC service on real Postgres against a stub provider: starting, completing a login for a
// known identity, the single-use state, and a provider that misbehaves.
import { createHash } from 'node:crypto';
import { Forbidden, NotFound, Unauthorized } from '@scorpion/contracts';
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import type { IdentityInternals } from '../module.ts';
import { count, flow, fresh, identity, idp, rows, settingsWith, start } from '../test/oidc.ts';
import { BadRequest, InvalidIdToken, ProviderUnavailable } from './oidc-errors.ts';
import type { CompleteInput } from './oidc.ts';

describe('start', () => {
  it('builds a PKCE S256 URL with state and nonce, and keeps no secret in the table', async () => {
    const { kernel, identity: id } = await start();
    const started = await id.oidc.start('stub');
    const url = new URL(started.authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${idp.issuer}/authorize`);
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe(idp.clientId);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('scope')).toBe('openid email profile');
    expect(q.get('redirect_uri')).toBe(
      `${kernel.config.ORIGIN}/api/internal/auth/oidc/stub/callback`,
    );
    const challenge = createHash('sha256').update(started.cookie.value).digest('base64url');
    expect(q.get('code_challenge')).toBe(challenge);
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.cookie).toEqual({
      value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as string,
      maxAgeSeconds: 600,
    });

    const [row] = await rows(kernel, 'select * from identity_login_state');
    expect(row).toMatchObject({ provider_id: 'stub', link_user_id: null });
    const dump = JSON.stringify(row);
    for (const secret of [q.get('state')!, q.get('nonce')!, started.cookie.value]) {
      expect(dump).not.toContain(secret);
    }
    const lifetime = (row!.expires_at as Date).getTime() - (row!.created_at as Date).getTime();
    expect(Math.abs(lifetime - 10 * 60 * 1000)).toBeLessThan(5_000);
  });

  it('puts ORIGIN and BASE_PATH into the redirect URI and the landing page', async () => {
    const { identity: id } = await start({
      env: { ORIGIN: 'https://scorpion.example.org', BASE_PATH: '/a/b' },
    });
    const started = await id.oidc.start('stub');
    expect(new URL(started.authorizationUrl).searchParams.get('redirect_uri')).toBe(
      'https://scorpion.example.org/a/b/api/internal/auth/oidc/stub/callback',
    );
    expect(id.oidc.landing).toBe('/a/b/');
    expect((await start()).identity.oidc.landing).toBe('/');
  });

  it('gives every start its own state, nonce and verifier', async () => {
    const { identity: id } = await start();
    const a = await id.oidc.start('stub');
    const b = await id.oidc.start('stub');
    expect(a.cookie.value).not.toBe(b.cookie.value);
    expect(new URL(a.authorizationUrl).searchParams.get('state')).not.toBe(
      new URL(b.authorizationUrl).searchParams.get('state'),
    );
  });

  it('is a 404 for an unknown provider, and for every provider when none is configured', async () => {
    const { identity: id } = await start();
    await expect(id.oidc.start('nope')).rejects.toBeInstanceOf(NotFound);
    const off = await identity.start();
    await expect(off.identity.oidc.start('stub')).rejects.toBeInstanceOf(NotFound);
  });

  it('is a 502 when the provider cannot be reached, and leaves no state behind', async () => {
    idp.fail.discovery = true;
    try {
      const { kernel, identity: id } = await start();
      await expect(id.oidc.start('stub')).rejects.toBeInstanceOf(ProviderUnavailable);
      expect(await count(kernel, 'identity_login_state')).toBe(0);
    } finally {
      idp.fail.discovery = false;
    }
  });

  it('is independent of the localAccounts setting', async () => {
    const { identity: id } = await start({ settings: settingsWith({ localAccounts: false }) });
    await expect(id.oidc.start('stub')).resolves.toBeDefined();
  });
});

describe('a known identity', () => {
  async function known(status: 'active' | 'pending' | 'rejected', deleted = false) {
    const ctx = await start();
    const user = await makeUser(ctx.kernel.pool, { status, deleted });
    await makeAuthMethod(ctx.kernel.pool, user, { provider: 'stub', subject: 'known-sub' });
    return { ...ctx, user };
  }

  it('signs in an active user, once per user, and stamps the login time', async () => {
    const { kernel, identity: id, user } = await known('active');
    const first = await id.oidc.complete(await flow(id, fresh({ subject: 'known-sub' })));
    const second = await id.oidc.complete(await flow(id, fresh({ subject: 'known-sub' })));
    expect(first).toMatchObject({ kind: 'login' });
    expect(second).toMatchObject({ kind: 'login' });
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(await count(kernel, 'identity_session')).toBe(2);
    const [method] = await rows(
      kernel,
      "select last_login_at from identity_auth_method where provider = 'stub'",
    );
    expect(method!.last_login_at).toBeInstanceOf(Date);
    const resolved = await id.sessions.resolve((first as { sessionId: string }).sessionId);
    expect(resolved?.userId).toBe(user.id);
  });

  it('ends the session the browser held when a new one begins', async () => {
    const { identity: id, user } = await known('active');
    const old = await id.sessions.create(user.id);
    const input = {
      ...(await flow(id, fresh({ subject: 'known-sub' }))),
      previousSessionId: old.id,
    };
    await id.oidc.complete(input);
    expect(await id.sessions.resolve(old.id)).toBeUndefined();
  });

  it('refuses a pending account (403) and a rejected or deleted one (401), with no session', async () => {
    for (const [status, deleted, error] of [
      ['pending', false, Forbidden],
      ['rejected', true, Unauthorized],
      ['active', true, Unauthorized],
    ] as const) {
      const { kernel, identity: id } = await known(status, deleted);
      await expect(
        id.oidc.complete(await flow(id, fresh({ subject: 'known-sub' }))),
      ).rejects.toBeInstanceOf(error);
      expect(await count(kernel, 'identity_session')).toBe(0);
    }
  });

  it('says the same thing to a rejected account and a deleted one', async () => {
    const messages: string[] = [];
    for (const [status, deleted] of [
      ['rejected', true],
      ['active', true],
    ] as const) {
      const { identity: id } = await known(status, deleted);
      const error = await id.oidc
        .complete(await flow(id, fresh({ subject: 'known-sub' })))
        .catch((e: unknown) => e);
      messages.push((error as Error).message);
    }
    expect(new Set(messages).size).toBe(1);
  });
});

describe('the login state', () => {
  const expectBad = async (id: IdentityInternals, input: CompleteInput) => {
    const error = await id.oidc.complete(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequest);
    expect((error as BadRequest).status).toBe(400);
  };

  it('is single use: a replayed callback is a 400 and creates nothing more', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, user, { provider: 'stub', subject: 'known-sub' });
    const input = await flow(id, fresh({ subject: 'known-sub' }));
    await id.oidc.complete(input);
    await expectBad(id, input);
    expect(await count(kernel, 'identity_session')).toBe(1);
    expect(await count(kernel, 'identity_login_state')).toBe(0);
  });

  it('lets exactly one of two parallel callbacks with the same state win', async () => {
    const { kernel, identity: id } = await start();
    const user = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, user, { provider: 'stub', subject: 'known-sub' });
    const input = await flow(id, fresh({ subject: 'known-sub' }));
    const results = await Promise.allSettled([id.oidc.complete(input), id.oidc.complete(input)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(BadRequest);
    expect(await count(kernel, 'identity_session')).toBe(1);
  });

  it('is a 400 for an expired state, and the row is not usable later either', async () => {
    const { kernel, identity: id } = await start();
    const input = await flow(id, fresh());
    await kernel.pool.query(
      "update identity_login_state set expires_at = now() - interval '1 second'",
    );
    await expectBad(id, input);
    expect(await count(kernel, 'identity_user')).toBe(0);
  });

  it.each([
    ['unknown', { state: 'x'.repeat(43) }],
    ['empty', { state: '' }],
    ['absurdly long', { state: 'y'.repeat(100_000) }],
    ['made of odd characters', { state: "'; drop table identity_user; --" }],
  ])('is a 400 for a state that is %s, never a crash', async (_name, over) => {
    const { kernel, identity: id } = await start();
    await expectBad(id, { ...(await flow(id, fresh())), ...over });
    expect(await count(kernel, 'identity_user')).toBe(0);
  });

  it('is a 400 for a state that belongs to another provider', async () => {
    const two = settingsWith({ oidcProviders: [idp.provider('stub'), idp.provider('second')] });
    const { identity: id } = await start({ settings: two });
    const input = await flow(id, fresh());
    await expectBad(id, { ...input, providerId: 'second' });
  });

  it('is a 404 for a provider that is not configured', async () => {
    const { identity: id } = await start();
    await expect(
      id.oidc.complete({ ...(await flow(id, fresh())), providerId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('binds the callback to the browser that started it: no cookie, another cookie, or a malformed one is a 400 and uses the state up', async () => {
    const { kernel, identity: id } = await start();
    for (const verifier of [undefined, '', 'short', 'A'.repeat(43)]) {
      const input = await flow(id, fresh());
      await expectBad(id, { ...input, verifier });
      // The state is spent: the right browser cannot use it afterwards.
      await expectBad(id, input);
    }
    expect(await count(kernel, 'identity_user')).toBe(0);
    expect(await count(kernel, 'identity_session')).toBe(0);
  });

  it('is a 400 when the provider reports an error or sends no code, and does not repeat what it said', async () => {
    const { identity: id } = await start();
    for (const over of [
      { error: 'access_denied', code: undefined },
      { code: undefined },
      { error: 'access_denied' },
    ]) {
      const error = await id.oidc
        .complete({ ...(await flow(id, fresh())), ...over })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequest);
      expect((error as Error).message).not.toContain('access_denied');
    }
  });
});

describe('the provider misbehaving', () => {
  it('a wrong nonce fails with 401, creates no user and no session', async () => {
    const { kernel, identity: id } = await start();
    idp.faults = { nonce: 'tampered-nonce' };
    try {
      const error = await id.oidc.complete(await flow(id, fresh())).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidIdToken);
      expect((error as InvalidIdToken).reason).toBe('nonce');
    } finally {
      idp.faults = {};
    }
    expect(await count(kernel, 'identity_user')).toBe(0);
    expect(await count(kernel, 'identity_session')).toBe(0);
    expect(await count(kernel, 'kernel_outbox')).toBe(0);
  });

  it('a provider that sends no id_token is a 401', async () => {
    const { identity: id } = await start();
    idp.faults = { omitIdToken: true };
    try {
      await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toMatchObject({
        reason: 'missing',
      });
    } finally {
      idp.faults = {};
    }
  });

  it('a token endpoint that fails or hangs is a 502', async () => {
    const { identity: id } = await start({ oidcHttp: { exchangeTimeoutMs: 100 } });
    idp.fail.token = true;
    try {
      await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toBeInstanceOf(
        ProviderUnavailable,
      );
    } finally {
      idp.fail.token = false;
    }
    idp.tokenDelayMs = 400;
    try {
      await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toBeInstanceOf(
        ProviderUnavailable,
      );
    } finally {
      idp.tokenDelayMs = 0;
    }
  });

  it('a wrong client secret is a 502 (our configuration), not a 400 about the person', async () => {
    const { identity: id } = await start({ clientSecret: () => 'not-the-secret' });
    await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toBeInstanceOf(
      ProviderUnavailable,
    );
  });

  it('an unreachable key set is a 502', async () => {
    const { kernel, identity: id } = await start();
    idp.fail.jwks = true;
    try {
      await expect(id.oidc.complete(await flow(id, fresh()))).rejects.toBeInstanceOf(
        ProviderUnavailable,
      );
    } finally {
      idp.fail.jwks = false;
    }
    expect(await count(kernel, 'identity_user')).toBe(0);
  });

  it('reads the key set again when the provider rotated its key, but not more than once per cooldown', async () => {
    let clock = Date.now();
    const { kernel, identity: id } = await start({ oidcHttp: { now: () => clock } });
    const user = await makeUser(kernel.pool);
    await makeAuthMethod(kernel.pool, user, { provider: 'stub', subject: 'known-sub' });
    const login = () => flow(id, fresh({ subject: 'known-sub' }));
    const before = idp.requests.jwks;
    await expect(id.oidc.complete(await login())).resolves.toMatchObject({ kind: 'login' });
    expect(idp.requests.jwks).toBe(before + 1);

    await idp.rotateKey();
    // Rotated, but the cooldown has not passed: the old key set is kept and the token is refused.
    await expect(id.oidc.complete(await login())).rejects.toMatchObject({ reason: 'unknown-key' });
    expect(idp.requests.jwks).toBe(before + 1);

    clock += 31_000;
    await expect(id.oidc.complete(await login())).resolves.toMatchObject({ kind: 'login' });
    expect(idp.requests.jwks).toBe(before + 2);
  });

  it('reads the client secret through one lookup and sends it only to the token endpoint', async () => {
    const asked: string[] = [];
    const { identity: id } = await start({
      clientSecret: (provider) => {
        asked.push(provider);
        return idp.clientSecret;
      },
    });
    const started = await id.oidc.start('stub');
    expect(started.authorizationUrl).not.toContain(idp.clientSecret);
    expect(JSON.stringify(started)).not.toContain(idp.clientSecret);
    expect(asked.every((provider) => provider === 'stub')).toBe(true);
  });
});
