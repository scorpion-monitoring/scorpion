// The password rules and the login throttle through the whole pipeline (ADR 0026): the status, the
// problem body, `Retry-After`, the address the throttle keys on, and what the log may not hold.
import { createStubPwnedPasswords } from '@scorpion/integrations';
import { describe, expect, it } from 'vitest';
import { createMetrics } from './metrics.ts';
import { PASSWORD, settingsWith, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const LEAKED = 'hunter2-leaked-long';
const NEW_PASSWORD = 'another long passphrase';
const WRONG = 'wrong horse battery';
const LINK = /#token=([A-Za-z0-9_%-]+)/;
const pwned = () => createStubPwnedPasswords({ breached: [LEAKED] });

describe('a breached password', () => {
  it('is a 422 problem+json on register, naming the field and not the password', async () => {
    const { post, logText } = await app.start({ pwned: pwned() });
    const reply = await post('/auth/register', {
      body: { username: 'carol', email: 'carol@example.org', password: LEAKED },
    });
    expect(reply.status).toBe(422);
    expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
    expect(JSON.stringify(reply.body)).toContain('password');
    expect(JSON.stringify(reply.body)).not.toContain(LEAKED);
    expect(logText()).not.toContain(LEAKED);
  });

  it('is a 422 on the reset confirmation, which leaves the link usable', async () => {
    const { post, signedIn, mail, logText } = await app.start({ pwned: pwned() });
    await signedIn('alice', { email: 'alice@example.org' });
    await post('/auth/password-reset', { body: { email: 'alice@example.org' } });
    const token = decodeURIComponent(
      LINK.exec((await mail.of('identity.password-reset'))[0]!.text ?? '')![1]!,
    );

    const refused = await post('/auth/password-reset/confirm', {
      body: { token, password: LEAKED },
    });
    expect(refused.status).toBe(422);
    expect(logText()).not.toContain(LEAKED);
    expect(
      (await post('/auth/password-reset/confirm', { body: { token, password: NEW_PASSWORD } }))
        .status,
    ).toBe(204);
  });

  it('is a 422 on change, on the newPassword field', async () => {
    const { post, signedIn } = await app.start({ pwned: pwned() });
    const alice = await signedIn('alice');
    const reply = await post('/account/password', {
      cookie: alice.cookie,
      csrf: alice.csrf,
      body: { currentPassword: PASSWORD, newPassword: LEAKED },
    });
    expect(reply.status).toBe(422);
    expect(JSON.stringify(reply.body)).toContain('newPassword');
  });

  it('is a 422 on the first-run route, which keeps the token', async () => {
    const shown: string[] = [];
    const { post, kernel, identity } = await app.start({
      pwned: pwned(),
      announce: (text) => shown.push(text),
    });
    await kernel.pool.query('delete from identity_first_run_token');
    shown.length = 0; // the token that start-up printed is gone now
    await identity.bootstrap.issueFirstRunToken();
    const token = /sfr_[A-Za-z0-9_-]{43}/.exec(shown.join('\n'))![0];

    const refused = await post('/bootstrap/first-admin', {
      body: { token, username: 'root', email: 'root@example.org', password: LEAKED },
    });
    expect(refused.status).toBe(422);
    const created = await post('/bootstrap/first-admin', {
      body: { token, username: 'root', email: 'root@example.org', password: NEW_PASSWORD },
    });
    expect(created.status).toBeLessThan(300);
  });

  it('counts a check that found the service unavailable in the metrics, and accepts the password', async () => {
    const { post } = await app.start({ pwned: createStubPwnedPasswords({ unavailable: true }) });
    const accepted = await post('/auth/register', {
      body: { username: 'carol', email: 'carol@example.org', password: LEAKED },
    });
    expect(accepted.status).toBe(202);
    const text = await createMetrics().render();
    expect(text).toMatch(/^scorpion_password_breach_check_failures_total [1-9]\d*$/m);
  });
});

describe('failed logins through the pipeline', () => {
  const settings = settingsWith({
    loginThrottle: {
      freeAttempts: 2,
      freeAttemptsPerAccount: 10,
      baseDelaySeconds: 30,
      maxDelaySeconds: 120,
    },
  });
  const login = (
    post: Awaited<ReturnType<typeof app.start>>['post'],
    username: string,
    password: string,
    peer?: string,
  ) => post('/auth/login', { body: { username, password }, peer });

  it('answer 429 problem+json with Retry-After after the free attempts, for a known and an unknown name alike [ASVS-6.3.1]', async () => {
    const { post, signedIn } = await app.start({ settings });
    await signedIn('alice');

    const run = async (name: string) => {
      const seen = [];
      for (let n = 0; n < 4; n += 1) {
        const reply = await login(post, name, WRONG);
        seen.push({
          status: reply.status,
          retryAfter: reply.res.headers.get('retry-after'),
          type: reply.res.headers.get('content-type'),
          detail: (reply.body as { detail?: string }).detail?.replace(/\d+ seconds/, 'N seconds'),
        });
      }
      return seen;
    };
    const known = await run('alice');
    const unknown = await run('nobody-here');

    expect(known.map((r) => r.status)).toEqual([401, 401, 401, 429]);
    expect(known[3]!.retryAfter).toMatch(/^(29|30)$/);
    expect(known[3]!.type).toContain('application/problem+json');
    expect(unknown).toEqual(known);
  });

  it('are keyed on the address the pipeline resolved: another network is not slowed, and the person still gets in', async () => {
    const { post, signedIn } = await app.start({ settings });
    await signedIn('alice');
    for (let n = 0; n < 3; n += 1) await login(post, 'alice', WRONG, '198.51.100.1');

    expect((await login(post, 'alice', PASSWORD, '198.51.100.1')).status).toBe(429);
    const other = await login(post, 'alice', PASSWORD, '198.51.100.2');
    expect(other.status).toBe(200);
    expect(other.cookie).toBeTruthy();
  });
});
