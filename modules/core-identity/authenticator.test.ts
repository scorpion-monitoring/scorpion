import { Unauthorized, type Actor } from '@scorpion/contracts';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createSessionAuthenticator } from './authenticator.ts';
import type { ResolvedSession, SessionService } from './service/sessions.ts';
import { csrfTokenFor, newSessionId } from './service/session-id.ts';

const unauthorized = { error: expect.any(Unauthorized) as unknown };
const alice = { userId: 'u1', username: 'alice', renewed: false };

/** Runs the authenticator on a request to a throw-away Hono app, as the pipeline would. */
async function authenticate(
  resolve: (id: string) => Promise<ResolvedSession | undefined>,
  request: { method?: string; cookie?: string; csrf?: string; body?: string } = {},
) {
  const lookup = vi.fn(resolve);
  const sessions = { resolve: lookup } as unknown as SessionService;
  const authenticator = createSessionAuthenticator(() => sessions);
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
  const headers: Record<string, string> = {};
  if (request.cookie !== undefined) headers.cookie = `__Host-session=${request.cookie}`;
  if (request.csrf !== undefined) headers['x-csrf-token'] = request.csrf;
  const response = await app.request('/', {
    method: request.method ?? 'GET',
    headers,
    body: request.body,
  });
  return { outcome: outcome!, response, resolve: lookup };
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
      actor: { kind: 'user', userId: 'u1', username: 'alice', roles: [], via: 'session' },
    });
    expect(resolve).toHaveBeenCalledWith(id);
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
    const renewed = await authenticate(() => Promise.resolve({ ...alice, renewed: true }), {
      cookie: id,
    });
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
    const authenticator = createSessionAuthenticator(() => sessions);
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
