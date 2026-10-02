// Password reset, password change and email verification through the whole pipeline, on real
// Postgres with the in-memory mailer: the same answer for every address, the denied requests, the
// bad input, and what the log may not hold.
import { describe, expect, it } from 'vitest';
import {
  createMemoryMailer,
  PASSWORD,
  settingsWith,
  useIdentityApp,
} from './testing/identity-app.ts';

const app = useIdentityApp();
const NEW_PASSWORD = 'another long passphrase';
const LINK = /#token=([A-Za-z0-9_%-]+)/;
const strictTwo = { strict: { capacity: 2, refillPerSecond: 0.001 } };

async function start(options: Parameters<typeof app.start>[0] = {}) {
  const mailer = createMemoryMailer();
  const started = await app.start({ mailer, tokenCacheTtlMs: 0, ...options });
  const tokenOf = (index: number) =>
    decodeURIComponent(LINK.exec(mailer.sent[index]?.text ?? '')?.[1] ?? '');
  return { ...started, mailer, tokenOf };
}

describe('requesting a reset', () => {
  it('answers exactly the same for a known and an unknown address', async () => {
    const { post, signedIn, mailer } = await start();
    await signedIn('alice', { email: 'alice@example.org' });

    const known = await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    const unknown = await post('/auth/password-reset', { body: { email: 'ghost@example.org' } });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.body).toEqual({ accepted: true });
    expect(unknown.res.headers.get('content-type')).toBe(known.res.headers.get('content-type'));
    expect(mailer.sent.map((m) => m.to)).toEqual(['alice@example.org']);
  });

  it('is rate limited per client (429 with Retry-After), known address or not', async () => {
    const { post } = await start({ rateLimits: strictTwo });
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await post('/auth/password-reset', { body: { email: `a${i}@example.org` } })).status,
      );
    }
    expect(statuses).toEqual([202, 202, 429, 429]);
  });

  it('is 422 for bad input and 403 when local accounts are off', async () => {
    const { post } = await start();
    for (const body of [{}, { email: 'nope' }, { email: 'a@example.org', extra: true }, 'text']) {
      const reply = await post('/auth/password-reset', { body });
      expect(reply.status).toBe(422);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    }
    const off = await start({ settings: settingsWith({ localAccounts: false }) });
    expect(
      (await off.post('/auth/password-reset', { body: { email: 'a@example.org' } })).status,
    ).toBe(403);
  });

  it('ignores a bad session cookie: the route is public', async () => {
    const { post } = await start();
    const reply = await post('/auth/password-reset', {
      cookie: 'A'.repeat(43),
      body: { email: 'a@example.org' },
    });
    expect(reply.status).toBe(202);
  });
});

describe('confirming a reset', () => {
  it('sets the password; the old cookie and the old password are dead; the new password works', async () => {
    const { post, get, signedIn, mailer, tokenOf } = await start();
    const session = await signedIn('alice', { email: 'alice@example.org' });
    await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    expect(mailer.sent).toHaveLength(1);

    const done = await post('/auth/password-reset/confirm', {
      body: { token: tokenOf(0), password: NEW_PASSWORD },
    });
    expect(done.status).toBe(204);

    expect((await get('/auth/me', { cookie: session.cookie })).status).toBe(401);
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: PASSWORD } })).status,
    ).toBe(401);
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: NEW_PASSWORD } })).status,
    ).toBe(200);
  });

  it('is the same 400 problem for an unknown, a used and a malformed token', async () => {
    const { post, signedIn, tokenOf } = await start();
    await signedIn('alice', { email: 'alice@example.org' });
    await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    const good = { token: tokenOf(0), password: NEW_PASSWORD };
    expect((await post('/auth/password-reset/confirm', { body: good })).status).toBe(204);

    const replies = [];
    for (const token of [good.token, 'srt_' + 'A'.repeat(43), 'junk']) {
      replies.push(
        await post('/auth/password-reset/confirm', { body: { token, password: NEW_PASSWORD } }),
      );
    }
    expect(replies.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(
      new Set(replies.map((r) => JSON.stringify((r.body as { detail: string }).detail))).size,
    ).toBe(1);
    expect(replies[0]!.res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('is 422 for a weak password or a missing token, and rate limited', async () => {
    const { post } = await start();
    for (const body of [
      { token: 'srt_x' },
      { password: NEW_PASSWORD },
      { token: 'srt_x', password: 'short' },
      { token: '', password: NEW_PASSWORD },
    ]) {
      expect((await post('/auth/password-reset/confirm', { body })).status).toBe(422);
    }
    const limited = await start({ rateLimits: strictTwo });
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push(
        (
          await limited.post('/auth/password-reset/confirm', {
            body: { token: 'junk', password: NEW_PASSWORD },
          })
        ).status,
      );
    }
    expect(statuses).toEqual([400, 400, 429]);
  });
});

describe('changing the password', () => {
  const body = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD };

  it('ends every session, clears the cookie, and the old password is dead', async () => {
    const { post, get, call, signedIn } = await start();
    const first = await signedIn('alice');
    const second = (await post('/auth/login', { body: { username: 'alice', password: PASSWORD } }))
      .cookie!;

    const reply = await call('POST', '/account/password', { ...first, body });
    expect(reply.status).toBe(204);
    expect(reply.setCookie).toMatch(/^__Host-session=;/);

    expect((await get('/auth/me', { cookie: first.cookie })).status).toBe(401);
    expect((await get('/auth/me', { cookie: second })).status).toBe(401);
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: PASSWORD } })).status,
    ).toBe(401);
    expect(
      (await post('/auth/login', { body: { username: 'alice', password: NEW_PASSWORD } })).status,
    ).toBe(200);
  });

  it('keeps an access token working (sessions only, ADR 0012)', async () => {
    const { post, get, call, signedIn } = await start();
    const session = await signedIn('alice');
    const created = (await post('/tokens', { ...session, body: { name: 'ci' } })).body as {
      token: string;
    };
    expect((await call('POST', '/account/password', { ...session, body })).status).toBe(204);
    expect(
      (await get('/auth/me', { headers: { authorization: `Bearer ${created.token}` } })).status,
    ).toBe(200);
  });

  it('is 422 for a wrong current password or a weak new one', async () => {
    const { call, signedIn } = await start();
    const session = await signedIn('alice');
    const wrong = await call('POST', '/account/password', {
      ...session,
      body: { ...body, currentPassword: 'not it at all' },
    });
    expect(wrong.status).toBe(422);
    expect(JSON.stringify(wrong.body)).not.toContain('not it at all');
    expect(
      (
        await call('POST', '/account/password', {
          ...session,
          body: { ...body, newPassword: 'short' },
        })
      ).status,
    ).toBe(422);
    expect(
      (await call('POST', '/account/password', { ...session, body: { currentPassword: PASSWORD } }))
        .status,
    ).toBe(422);
  });
});

describe('verifying an address', () => {
  it('registering mails a link, and the link confirms the address (no session needed)', async () => {
    const { post, identity, mailer, tokenOf } = await start();
    const registered = await post('/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
    });
    expect(registered.status).toBe(201);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toContain('/verify-email#token=sev_');

    expect((await post('/auth/verify-email', { body: { token: tokenOf(0) } })).status).toBe(204);
    expect((await identity.users.findByUsername('alice'))?.emailVerified).toBe(true);
    const again = await post('/auth/verify-email', { body: { token: tokenOf(0) } });
    expect(again.status).toBe(400);
  });

  it('is 422 for bad input, 400 for a bad link, and rate limited', async () => {
    const { post } = await start({ rateLimits: strictTwo });
    expect((await post('/auth/verify-email', { body: {} })).status).toBe(422);
    expect((await post('/auth/verify-email', { body: { token: 'junk' } })).status).toBe(400);
    expect((await post('/auth/verify-email', { body: { token: 'junk' } })).status).toBe(429);
  });

  it('sends a new link on request, for the caller’s own address', async () => {
    const { call, signedIn, mailer } = await start();
    const session = await signedIn('alice', { email: 'alice@example.org' });
    const reply = await call('POST', '/account/email/verification', session);
    expect(reply.status).toBe(202);
    expect(mailer.sent.map((m) => m.to)).toEqual(['alice@example.org']);
  });
});

describe('the session-only routes refuse the callers who may not use them', () => {
  const routes: [string, string, string, unknown][] = [
    [
      'POST',
      '/account/password',
      'core.identity.password.change',
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    ],
    ['POST', '/account/email/verification', 'core.identity.email.verify', undefined],
  ];

  it.each(routes)(
    '%s %s: anonymous → 401, without %s → 403, with a token → 403, over the limit → 429',
    async (method, path, permission, body) => {
      const anonymous = await start();
      const reply = await anonymous.call(method, path, { body });
      expect(reply.status).toBe(401);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');

      const denied = await start({
        permissions: ['core.identity.session.manage', 'core.identity.me.read'],
      });
      const session = await denied.signedIn('alice');
      expect((await denied.call(method, path, { ...session, body })).status).toBe(403);

      const allowed = await start({
        permissions: [permission, 'core.identity.token.manage'],
        rateLimits: { strict: { capacity: 3, refillPerSecond: 0.001 } },
      });
      const mine = await allowed.signedIn('alice');
      const created = (await allowed.post('/tokens', { ...mine, body: { name: 'ci' } })).body as {
        token: string;
      };
      const viaToken = await allowed.call(method, path, {
        headers: { authorization: `Bearer ${created.token}` },
        body,
      });
      expect(viaToken.status).toBe(403);

      const statuses = [];
      for (let i = 0; i < 4; i++)
        statuses.push(
          (
            await allowed.call(method, path, {
              ...mine,
              body:
                method === 'POST' && body
                  ? { currentPassword: 'x'.repeat(9), newPassword: NEW_PASSWORD }
                  : body,
            })
          ).status,
        );
      expect(statuses).toContain(429);
    },
  );
});

describe('what the log may not hold', () => {
  it('has no token, link or address after a reset, a verification and a failed mail', async () => {
    const { post, signedIn, mailer, tokenOf, logText } = await start();
    await signedIn('alice', { email: 'alice@example.org' });
    await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    await post('/auth/register', {
      body: { username: 'bobby', email: 'bobby@example.org', password: PASSWORD },
    });
    mailer.failWith(
      Object.assign(new Error('550 carol@example.org smtp://u:pw@host'), { code: 'EENVELOPE' }),
    );
    await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    await post('/auth/password-reset/confirm', {
      body: { token: tokenOf(0), password: NEW_PASSWORD },
    });
    await post('/auth/verify-email', { body: { token: tokenOf(1) } });

    const log = logText();
    expect(log).toContain('"msg"'); // the log is not empty, so the checks below mean something
    for (const secret of [
      tokenOf(0),
      tokenOf(1),
      tokenOf(0).slice(4),
      'reset-password',
      'verify-email#',
      '#token=',
      'alice@example.org',
      'bobby@example.org',
      'carol@example.org',
      'pw@host',
      NEW_PASSWORD,
      PASSWORD,
    ]) {
      expect(log).not.toContain(secret);
    }
  });
});
