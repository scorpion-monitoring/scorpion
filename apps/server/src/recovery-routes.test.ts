// Password reset, password change and email verification through the whole pipeline, on real
// Postgres with the in-memory mail: the same answer for every address, the denied requests, the
// bad input, and what the log may not hold.
import { startSmtpServer, tablesContaining } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { ALL_USER_SCOPES, PASSWORD, settingsWith, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const NEW_PASSWORD = 'another long passphrase';
const LINK = /#token=([A-Za-z0-9_%-]+)/;
const strictTwo = { strict: { capacity: 2, refillPerSecond: 0.001 } };

async function start(options: Parameters<typeof app.start>[0] = {}) {
  const started = await app.start({ tokenCacheTtlMs: 0, ...options });
  /** The token in the link of the n-th queued mail of a template. */
  const tokenOf = async (template: string, n = 0) =>
    decodeURIComponent(LINK.exec((await started.mail.of(template))[n]?.text ?? '')?.[1] ?? '');
  return { ...started, tokenOf };
}

describe('requesting a reset', () => {
  it('answers exactly the same for a known and an unknown address [ASVS-6.4.3]', async () => {
    const { post, signedIn, mail } = await start();
    await signedIn('alice', { email: 'alice@example.org' });

    const known = await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    const unknown = await post('/auth/password-reset', { body: { email: 'ghost@example.org' } });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.body).toEqual({ accepted: true });
    expect(unknown.res.headers.get('content-type')).toBe(known.res.headers.get('content-type'));
    // Only the known address was mailed, in one mail that carries the link.
    expect((await mail.all()).map((m) => [m.template, m.to])).toEqual([
      ['identity.password-reset', 'alice@example.org'],
    ]);
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
    const { post, get, signedIn, mail, tokenOf } = await start();
    const session = await signedIn('alice', { email: 'alice@example.org' });
    await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    expect(await mail.all()).toHaveLength(1);

    const done = await post('/auth/password-reset/confirm', {
      body: { token: await tokenOf('identity.password-reset'), password: NEW_PASSWORD },
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
    const good = { token: await tokenOf('identity.password-reset'), password: NEW_PASSWORD };
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

  it('is 422 for a weak password or a missing token, and rate limited [ASVS-6.6.3]', async () => {
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

  it('ends every session, clears the cookie, and the old password is dead [ASVS-6.2.2] [ASVS-7.4.3]', async () => {
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
    const created = (
      await post('/tokens', { ...session, body: { name: 'ci', scopes: ALL_USER_SCOPES } })
    ).body as {
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
    const { post, identity, mail, tokenOf } = await start();
    const registered = await post('/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
    });
    expect(registered.status).toBe(202);
    expect((await mail.of('identity.email-verification'))[0]!.text).toContain(
      '/verify-email#token=sev_',
    );

    const token = await tokenOf('identity.email-verification');
    expect((await post('/auth/verify-email', { body: { token } })).status).toBe(204);
    expect((await identity.users.findByUsername('alice'))?.emailVerified).toBe(true);
    const again = await post('/auth/verify-email', { body: { token } });
    expect(again.status).toBe(400);
  });

  it('is 422 for bad input, 400 for a bad link, and rate limited', async () => {
    const { post } = await start({ rateLimits: strictTwo });
    expect((await post('/auth/verify-email', { body: {} })).status).toBe(422);
    expect((await post('/auth/verify-email', { body: { token: 'junk' } })).status).toBe(400);
    expect((await post('/auth/verify-email', { body: { token: 'junk' } })).status).toBe(429);
  });

  it('sends a new link on request, for the caller’s own address', async () => {
    const { call, signedIn, mail } = await start();
    const session = await signedIn('alice', { email: 'alice@example.org' });
    const reply = await call('POST', '/account/email/verification', session);
    expect(reply.status).toBe(202);
    expect((await mail.all()).map((m) => m.to)).toEqual(['alice@example.org']);
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
      const created = (
        await allowed.post('/tokens', { ...mine, body: { name: 'ci', scopes: ALL_USER_SCOPES } })
      ).body as {
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

describe('what the log, the tables and the responses may not hold (ADR 0012, M4 plan §12)', () => {
  it('keeps the reset and verification tokens in the mail only: not in a log line, a table, an event or a response', async () => {
    const relay = await startSmtpServer();
    try {
      const { post, signedIn, mail, tokenOf, logText, kernel, notifications } = await start({
        notificationSettings: {
          emailTransport: 'smtp',
          smtp: { host: '127.0.0.1', port: relay.port, tls: 'none', timeoutSeconds: 2 },
        },
      });
      await signedIn('alice', { email: 'alice@example.org' });
      const bodies: string[] = [];
      const send = async (path: string, body: unknown) => {
        const reply = await post(path, { body });
        bodies.push(JSON.stringify(reply.body ?? ''), reply.setCookie ?? '');
        return reply;
      };
      await send('/auth/password-reset', { email: 'alice@example.org' });
      await send('/auth/password-reset', { email: 'alice@example.org' }); // replaces the first link
      await send('/auth/register', {
        username: 'bobby',
        email: 'bobby@example.org',
        password: PASSWORD,
      });
      const tokens = [
        await tokenOf('identity.password-reset', 0),
        await tokenOf('identity.password-reset', 1),
        await tokenOf('identity.email-verification', 0),
      ];
      expect(tokens.every((token) => /^s(rt|ev)_[A-Za-z0-9_-]{43}$/.test(token))).toBe(true);

      // Queued: the link is in the delivery row, which is what the relay will be given, and nowhere else.
      for (const token of tokens) {
        expect(await tablesContaining(kernel.pool, token)).toEqual(['notify_delivery']);
      }

      // Sent: the rendered body of a sensitive mail is gone from the row, and the relay has the mails.
      const report = await notifications.deliverDue();
      expect(report).toMatchObject({ sent: 4, retried: 0, dead: 0 });
      expect(relay.received).toHaveLength(4);
      const rows = await mail.all();
      expect(rows.filter((m) => m.sensitive).map((m) => [m.text, m.html, m.status])).toEqual([
        ['', '', 'sent'],
        ['', '', 'sent'],
        ['', '', 'sent'],
      ]);
      expect(rows.find((m) => m.template === 'identity.welcome')!.text).not.toBe(''); // not sensitive: kept
      for (const token of tokens) expect(await tablesContaining(kernel.pool, token)).toEqual([]);

      // Used: the confirmations leave no token behind either.
      await send('/auth/password-reset/confirm', { token: tokens[1], password: NEW_PASSWORD });
      await send('/auth/verify-email', { token: tokens[2] });

      const log = logText();
      expect(log).toContain('"msg"'); // the log is not empty, so the checks below mean something
      for (const secret of [
        ...tokens,
        ...tokens.map((token) => token.slice(4)),
        'reset-password',
        'verify-email#',
        '#token=',
        'alice@example.org',
        'bobby@example.org',
        NEW_PASSWORD,
        PASSWORD,
      ]) {
        expect(log).not.toContain(secret);
        for (const body of bodies) expect(body).not.toContain(secret);
      }
      for (const token of tokens) expect(await tablesContaining(kernel.pool, token)).toEqual([]);
    } finally {
      await relay.stop();
    }
  });

  it('logs only an error code when the relay is down, and the mail waits in the queue', async () => {
    const relay = await startSmtpServer();
    const { post, signedIn, mail, kernel, notifications, logText } = await start({
      notificationSettings: {
        emailTransport: 'smtp',
        smtp: { host: '127.0.0.1', port: relay.port, tls: 'none', timeoutSeconds: 1 },
      },
    });
    await relay.stop();
    await signedIn('alice', { email: 'alice@example.org' });
    expect(
      (await post('/auth/password-reset', { body: { email: 'alice@example.org' } })).status,
    ).toBe(202);

    expect(await notifications.deliverDue()).toMatchObject({ claimed: 1, retried: 1, sent: 0 });
    expect(await mail.all()).toMatchObject([{ status: 'queued', to: 'alice@example.org' }]);
    expect(
      (await kernel.pool.query('select last_error, attempts from notify_delivery')).rows,
    ).toEqual([{ last_error: 'ESOCKET', attempts: 1 }]);
    const log = logText();
    expect(log).toContain('ESOCKET');
    for (const secret of ['alice@example.org', '#token=', 'srt_', '127.0.0.1']) {
      expect(log).not.toContain(secret);
    }
  });
});
