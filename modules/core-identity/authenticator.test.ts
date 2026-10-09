import { Unauthorized, type Actor } from '@scorpion/contracts';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createAuthenticator } from './authenticator.ts';
import type { ResolvedSession, SessionService } from './service/sessions.ts';
import type { TokenAuthenticator, VerifiedToken } from './service/tokens.ts';
import { csrfTokenFor, newSessionId } from './service/session-id.ts';

const unauthorized = { error: expect.any(Unauthorized) as unknown };
const alice = { userId: 'u1', username: 'alice', sessionId: 's1', renewed: false };

/** Runs the authenticator on a request to a throw-away Hono app, as the pipeline would. */
async function authenticate(
  resolve: (id: string) => Promise<ResolvedSession | undefined>,
  request: {
    method?: string;
    cookie?: string;
    csrf?: string;
    body?: string;
    headers?: Record<string, string>;
    token?: (presented: string) => Promise<VerifiedToken | undefined>;
  } = {},
) {
  const lookup = vi.fn(resolve);
  const sessions = { resolve: lookup } as unknown as SessionService;
  const verify = vi.fn(request.token ?? (() => Promise.resolve(undefined)));
  const tokens: TokenAuthenticator = { authenticate: verify };
  const authenticator = createAuthenticator({ sessions: () => sessions, tokens: () => tokens });
  let outcome: { actor: Actor | undefined } | { error: unknown } | undefined;
  const app = new Hono();
  app.all('/', async (c: Context) => {
    try {
      outcome = { actor: await authenticator({ context: c }) };
    } catch (error) {
      outcome = { error };
    }
    return c.text('ok');
  });
  const headers: Record<string, string> = { ...request.headers };
  if (request.cookie !== undefined) headers.cookie = `__Host-session=${request.cookie}`;
  if (request.csrf !== undefined) headers['x-csrf-token'] = request.csrf;
  const response = await app.request('/', {
    method: request.method ?? 'GET',
    headers,
    body: request.body,
  });
  return { outcome: outcome!, response, resolve: lookup, verify };
}

describe('the session authenticator', () => {
  it('knows nothing about a request without a session cookie, and does not touch the database', async () => {
    const { outcome, resolve } = await authenticate(() => Promise.resolve(alice));
    expect(outcome).toEqual({ actor: undefined });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('turns a good cookie into a user actor with no roles, via the session', async () => {
    const id = newSessionId();
    const { outcome, resolve } = await authenticate(() => Promise.resolve(alice), { cookie: id });
    expect(outcome).toEqual({
      actor: {
        kind: 'user',
        userId: 'u1',
        username: 'alice',
        roles: [],
        via: 'session',
        sessionId: 's1',
      },
    });
    expect(resolve).toHaveBeenCalledWith(id, undefined, { touch: true });
  });

  it('throws Unauthorized, and nothing else, for a cookie the session service refuses', async () => {
    const { outcome } = await authenticate(() => Promise.resolve(undefined), {
      cookie: newSessionId(),
    });
    expect(outcome).toMatchObject(unauthorized);
  });

  it('lets a failure of the session service through as a bug, never as "anonymous"', async () => {
    const boom = new Error('database down');
    const { outcome } = await authenticate(() => Promise.reject(boom), { cookie: newSessionId() });
    expect(outcome).toEqual({ error: boom });
  });

  describe('CSRF (ADR 0007)', () => {
    const id = newSessionId();
    it.each(['GET', 'HEAD', 'OPTIONS'])('does not ask for the token on %s', async (method) => {
      const { outcome } = await authenticate(() => Promise.resolve(alice), { method, cookie: id });
      expect(outcome).toMatchObject({ actor: { kind: 'user' } });
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('asks for the token on %s', async (method) => {
      const missing = await authenticate(() => Promise.resolve(alice), { method, cookie: id });
      expect(missing.outcome).toMatchObject(unauthorized);
      const wrong = await authenticate(() => Promise.resolve(alice), {
        method,
        cookie: id,
        csrf: csrfTokenFor(newSessionId()),
      });
      expect(wrong.outcome).toMatchObject(unauthorized);
      const right = await authenticate(() => Promise.resolve(alice), {
        method,
        cookie: id,
        csrf: csrfTokenFor(id),
      });
      expect(right.outcome).toMatchObject({ actor: { kind: 'user' } });
    });

    it('does not ask a request without a cookie for a token (a token request has none)', async () => {
      const { outcome } = await authenticate(() => Promise.resolve(alice), { method: 'POST' });
      expect(outcome).toEqual({ actor: undefined });
    });
  });

  it('sends the cookie again when the session’s expiry slid, and only then', async () => {
    const id = newSessionId();
    const plain = await authenticate(() => Promise.resolve(alice), { cookie: id });
    expect(plain.response.headers.get('set-cookie')).toBeNull();
    const renewed = await authenticate(
      () =>
        Promise.resolve({ ...alice, renewed: true, expiresAt: new Date(Date.now() + 7 * 864e5) }),
      {
        cookie: id,
      },
    );
    const cookie = renewed.response.headers.get('set-cookie')!;
    expect(cookie).toContain(`__Host-session=${id}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('does not read the body', async () => {
    const id = newSessionId();
    const bodyUsed = vi.fn();
    const sessions = { resolve: () => Promise.resolve(alice) } as unknown as SessionService;
    const tokens: TokenAuthenticator = { authenticate: () => Promise.resolve(undefined) };
    const authenticator = createAuthenticator({ sessions: () => sessions, tokens: () => tokens });
    const app = new Hono();
    app.post('/', async (c) => {
      await authenticator({ context: c });
      bodyUsed(c.req.raw.bodyUsed);
      return c.text(await c.req.text()); // the handler can still read it
    });
    const res = await app.request('/', {
      method: 'POST',
      headers: { cookie: `__Host-session=${id}`, 'x-csrf-token': csrfTokenFor(id) },
      body: 'payload',
    });
    expect(bodyUsed).toHaveBeenCalledWith(false);
    expect(await res.text()).toBe('payload');
  });
});

describe('the token half (ADR 0008)', () => {
  const good: VerifiedToken = {
    tokenId: 't1',
    userId: 'u1',
    username: 'alice',
    scopes: ['read:kpi'],
  };
  const token = 'scp_abcdEFGH_0123456789012345678901234567890123456789012';
  const accept = (presented: string) => Promise.resolve(presented === token ? good : undefined);

  it.each([
    ['Authorization: Bearer', { authorization: `Bearer ${token}` }],
    ['a lower-case scheme', { authorization: `bearer ${token}` }],
    ['X-API-Key', { 'x-api-key': token }],
  ])(
    'turns a good token (%s) into a user actor with its scopes, via the token',
    async (_, headers) => {
      const { outcome } = await authenticate(() => Promise.resolve(undefined), {
        headers,
        token: accept,
      });
      expect(outcome).toEqual({
        actor: {
          kind: 'user',
          userId: 'u1',
          username: 'alice',
          roles: [],
          via: 'token',
          scopes: ['read:kpi'],
          tokenId: 't1', // for the audit trail: the id of the token, never the token
        },
      });
    },
  );

  it.each([
    ['Bearer with nothing after it', { authorization: 'Bearer' }],
    ['Bearer and a space only', { authorization: 'Bearer ' }],
    ['a wrong token', { authorization: 'Bearer scp_zzzzzzzz_wrong' }],
    ['an empty X-API-Key', { 'x-api-key': '' }],
    ['two spaces after the scheme', { authorization: `Bearer  ${token}` }],
  ])('throws Unauthorized, and nothing else, for %s', async (_, headers) => {
    const { outcome } = await authenticate(() => Promise.resolve(alice), {
      headers,
      token: accept,
    });
    expect(outcome).toMatchObject(unauthorized);
  });

  it('ignores an Authorization header that is not Bearer (Basic is not ours)', async () => {
    const { outcome, verify } = await authenticate(() => Promise.resolve(alice), {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(outcome).toEqual({ actor: undefined });
    expect(verify).not.toHaveBeenCalled();
  });

  it('lets Authorization win over X-API-Key', async () => {
    const { verify } = await authenticate(() => Promise.resolve(undefined), {
      headers: { authorization: `Bearer ${token}`, 'x-api-key': 'scp_other' },
      token: accept,
    });
    expect(verify).toHaveBeenCalledExactlyOnceWith(token);
  });

  it('treats a request with a token and a cookie as a token request: no cookie lookup, no CSRF check', async () => {
    const id = newSessionId();
    const { outcome, resolve } = await authenticate(() => Promise.resolve(alice), {
      method: 'POST',
      cookie: id, // no X-CSRF-Token, and the cookie would be a good session
      headers: { authorization: `Bearer ${token}` },
      token: accept,
    });
    expect(outcome).toMatchObject({ actor: { via: 'token' } });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a bad token even when the cookie is good (the cookie does not rescue it)', async () => {
    const { outcome } = await authenticate(() => Promise.resolve(alice), {
      cookie: newSessionId(),
      headers: { authorization: 'Bearer scp_zzzzzzzz_wrong' },
      token: accept,
    });
    expect(outcome).toMatchObject(unauthorized);
  });

  it('lets a failure of the token service through as a bug, never as "anonymous"', async () => {
    const boom = new Error('database down');
    const { outcome } = await authenticate(() => Promise.resolve(undefined), {
      headers: { authorization: `Bearer ${token}` },
      token: () => Promise.reject(boom),
    });
    expect(outcome).toEqual({ error: boom });
  });
});
