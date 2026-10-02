// New accounts and linked identities through the OIDC routes: the first login of a new person,
// an address that belongs to an unconfirmed password account, and linking from the profile.
import { makeAuthMethod, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { ALL_USER_SCOPES, PASSWORD } from './testing/identity-app.ts';
import { PROVIDER, isProblem, person, useOidcApp } from './testing/oidc-flow.ts';

const { idp, startApp } = useOidcApp();
const count = async (
  kernel: { pool: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> } },
  table: string,
) => Number((await kernel.pool.query(`select count(*) from ${table}`)).rows[0]!.count);

describe('GET /auth/oidc/{provider}/callback for people Scorpion does not know yet', () => {
  it('answers 403 for a pending account (the first login of a new person) and sets no session cookie', async () => {
    const { kernel, web } = await startApp();
    const { reply } = await web.login(person());
    expect(reply.status).toBe(403);
    expect(isProblem(reply)).toBe(true);
    expect(reply.setCookie).toBeUndefined();
    expect(await count(kernel, 'identity_user')).toBe(1);
    expect(await count(kernel, 'identity_session')).toBe(0);
  });

  it.each([
    ['rejected', { status: 'rejected' as const, deleted: true }],
    ['deleted', { deleted: true }],
  ])('answers 401 for a %s account and sets no session cookie', async (_name, over) => {
    const { kernel, web } = await startApp();
    const user = await makeUser(kernel.pool, over);
    await makeAuthMethod(kernel.pool, user, { provider: PROVIDER, subject: 's' });
    const { reply } = await web.login({ ...person(), subject: 's' });
    expect(reply.status).toBe(401);
    expect(reply.setCookie).toBeUndefined();
    expect(await count(kernel, 'identity_session')).toBe(0);
  });

  it('answers 409 for a verified address that belongs to an unconfirmed password account', async () => {
    const { kernel, web, post } = await startApp();
    await post('/auth/register', {
      body: { username: 'erin', email: 'erin@example.org', password: PASSWORD },
    });
    const { reply } = await web.login({ ...person(), email: 'erin@example.org' });
    expect(reply.status).toBe(409);
    expect(isProblem(reply)).toBe(true);
    expect(await count(kernel, 'identity_auth_method')).toBe(1); // erin's password only
  });
});

describe('POST /auth/oidc/{provider}/link', () => {
  it('starts a link for a signed-in user; the callback adds the identity and starts no session', async () => {
    const { kernel, web, signedIn, get } = await startApp();
    const alice = await signedIn('alice');
    const started = await web.start('link', { cookie: alice.cookie, csrf: alice.csrf });
    const back = await web.provider(started, { ...person(), subject: 'linked-sub' });
    const done = await web.callback(back, started); // no session cookie needed
    expect(done.status).toBe(302);
    expect(done.setCookie).toBeUndefined();
    expect(
      (await kernel.pool.query("select user_id from identity_auth_method where provider = 'stub'"))
        .rows,
    ).toEqual([{ user_id: alice.user.id }]);

    // And the identity signs her in afterwards.
    const again = await web.login({ ...person(), subject: 'linked-sub' });
    expect(again.reply.status).toBe(302);
    expect((await get('/auth/me', { cookie: again.reply.cookie })).body).toMatchObject({
      user: { id: alice.user.id },
    });
  });

  it('is refused for an anonymous caller (401), without a permission (403), and for a token caller (403)', async () => {
    const { post, signedIn } = await startApp();
    const anonymous = await post(`/auth/oidc/${PROVIDER}/link`);
    expect(anonymous.status).toBe(401);
    expect(isProblem(anonymous)).toBe(true);

    const alice = await signedIn('alice');
    const created = await post('/tokens', {
      body: { name: 'ci', scopes: ALL_USER_SCOPES },
      cookie: alice.cookie,
      csrf: alice.csrf,
    });
    const token = (created.body as { token: string }).token;
    const viaToken = await post(`/auth/oidc/${PROVIDER}/link`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaToken.status).toBe(403);
    expect(viaToken.setCookie).toBeUndefined();

    const { post: postDenied, signedIn: signedInDenied } = await startApp({
      permissions: ['core.identity.me.read'],
    });
    const bob = await signedInDenied('bobby');
    const denied = await postDenied(`/auth/oidc/${PROVIDER}/link`, {
      cookie: bob.cookie,
      csrf: bob.csrf,
    });
    expect(denied.status).toBe(403);
  });

  it('needs the CSRF token like any cookie-authenticated write', async () => {
    const { post, signedIn } = await startApp();
    const alice = await signedIn('alice');
    expect((await post(`/auth/oidc/${PROVIDER}/link`, { cookie: alice.cookie })).status).toBe(401);
  });

  it('uses the strict rate-limit bucket', async () => {
    const { post, signedIn } = await startApp({
      rateLimits: { strict: { capacity: 3, refillPerSecond: 0.001 } },
    });
    const alice = await signedIn('alice'); // one
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push(
        (await post(`/auth/oidc/${PROVIDER}/link`, { cookie: alice.cookie, csrf: alice.csrf }))
          .status,
      );
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe('nothing secret is kept in events or logs when accounts are made and linked', () => {
  it('says who and what in the events, never a subject, an address or a secret', async () => {
    const { kernel, web, logText, signedIn } = await startApp();
    const alice = await signedIn('alice');
    const who = person();
    const first = await web.start();
    const back = await web.provider(first, who);
    expect((await web.callback(back, first)).status).toBe(403); // a new, pending account
    const link = await web.start('link', { cookie: alice.cookie, csrf: alice.csrf });
    const linkBack = await web.provider(link, { ...person(), subject: 'linked-sub' });
    expect((await web.callback(linkBack, link)).status).toBe(302);

    const events = (await kernel.pool.query('select name, payload from kernel_outbox')).rows as {
      name: string;
      payload: unknown;
    }[];
    expect(events.map((e) => e.name).sort()).toEqual([
      'identity.authMethod.linked@1',
      'identity.user.registered@1',
    ]);
    const dump = JSON.stringify(events) + logText();
    for (const secret of [
      who.subject,
      who.email,
      'linked-sub',
      idp.clientSecret,
      back.code,
      link.loginCookie,
    ]) {
      expect(dump).not.toContain(secret);
    }
  });
});
