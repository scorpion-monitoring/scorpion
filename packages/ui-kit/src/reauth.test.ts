import { ApiError, createApiClient } from '@scorpion/contracts/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createReauthController,
  isReauthRequired,
  REAUTH_KEY,
  REAUTH_RETURN_MAX_AGE_MS,
  ReauthCancelled,
  takeReturn,
} from './reauth.ts';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function setup(answer: (call: Call) => Response, stored: Record<string, string> = {}) {
  const calls: Call[] = [];
  const api = createApiClient({
    basePath: '/',
    origin: 'http://x',
    csrfToken: () => 'csrf',
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body =
        request.method === 'GET' ? undefined : await request.json().catch(() => undefined);
      const call = {
        method: request.method,
        path: new URL(request.url).pathname.replace('/api/internal', ''),
        body,
      };
      calls.push(call);
      return answer(call);
    },
  });
  const storage = {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => void (stored[key] = value),
    removeItem: (key: string) => void delete stored[key],
  };
  const navigate = vi.fn();
  const controller = createReauthController({
    api,
    storage,
    path: () => '/a/b/profile?x=1',
    navigate,
  });
  return { calls, controller, stored, navigate };
}

const problem = (status: number, type?: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: type ?? 'about:blank', title: 't', status }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const needsReauth = () =>
  new ApiError(401, { type: 'reauthentication-required', title: 't', status: 401 });

describe('isReauthRequired', () => {
  it('is only a 401 with the problem type reauthentication-required', () => {
    expect(isReauthRequired(needsReauth())).toBe(true);
    expect(
      isReauthRequired(new ApiError(401, { type: 'about:blank', title: 't', status: 401 })),
    ).toBe(false);
    expect(
      isReauthRequired(
        new ApiError(403, { type: 'reauthentication-required', title: 't', status: 403 }),
      ),
    ).toBe(false);
    expect(isReauthRequired(new Error('x'))).toBe(false);
  });
});

describe('run', () => {
  it('returns the result of an action that needs no confirmation, and opens nothing', async () => {
    const { controller } = setup(() => json({}));
    expect(await controller.run(async () => 42)).toBe(42);
    expect(controller.state.open).toBe(false);
  });

  it('passes on every other failure', async () => {
    const { controller } = setup(() => json({}));
    await expect(
      controller.run(() => Promise.reject(new ApiError(500, undefined))),
    ).rejects.toThrow(ApiError);
    expect(controller.state.open).toBe(false);
  });

  it('opens the dialog on reauthentication-required, and repeats the action after the right password', async () => {
    const { controller, calls } = setup(() => new Response(null, { status: 204 }));
    const action = vi.fn().mockRejectedValueOnce(needsReauth()).mockResolvedValueOnce('done');
    const result = controller.run(action);
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    expect(controller.state.step).toBe('password');
    expect(action).toHaveBeenCalledTimes(1);

    await controller.submitPassword('secret password');
    expect(await result).toBe('done');
    expect(action).toHaveBeenCalledTimes(2);
    expect(controller.state.open).toBe(false);
    expect(calls).toEqual([
      { method: 'POST', path: '/account/reauthenticate', body: { password: 'secret password' } },
    ]);
  });

  it('keeps the dialog open with a message for a wrong password, then accepts the right one', async () => {
    let attempts = 0;
    const { controller } = setup(() =>
      ++attempts === 1 ? problem(422) : new Response(null, { status: 204 }),
    );
    const action = vi.fn().mockRejectedValueOnce(needsReauth()).mockResolvedValueOnce('ok');
    const result = controller.run(action);
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    await controller.submitPassword('nope');
    expect(controller.state).toMatchObject({ open: true, problem: 'wrong', busy: false });
    await controller.submitPassword('right');
    expect(await result).toBe('ok');
  });

  it('shows the wait of a throttled attempt', async () => {
    const { controller } = setup(() => problem(429, undefined, { 'retry-after': '30' }));
    void controller.run(() => Promise.reject(needsReauth())).catch(() => undefined);
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    await controller.submitPassword('x');
    expect(controller.state).toMatchObject({ problem: 'throttled', retryAfterSeconds: 30 });
  });

  it('turns to the providers when the account has no password (409)', async () => {
    const { controller } = setup((call) =>
      call.method === 'POST'
        ? problem(409)
        : json({ metadata: {}, result: [{ id: 'idp', displayName: 'My IdP' }] }),
    );
    void controller.run(() => Promise.reject(needsReauth())).catch(() => undefined);
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    await controller.submitPassword('x');
    expect(controller.state).toMatchObject({
      step: 'provider',
      providers: [{ id: 'idp', displayName: 'My IdP' }],
    });
  });

  it('rejects with ReauthCancelled when the person cancels', async () => {
    const { controller } = setup(() => json({}));
    const result = controller.run(() => Promise.reject(needsReauth()));
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    controller.cancel();
    await expect(result).rejects.toBeInstanceOf(ReauthCancelled);
    expect(controller.state.open).toBe(false);
  });

  it('rejects the action that waits when another one needs the dialog', async () => {
    const { controller } = setup(() => json({}));
    const first = controller.run(() => Promise.reject(needsReauth()));
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    const second = controller.run(() => Promise.reject(needsReauth()));
    await expect(first).rejects.toBeInstanceOf(ReauthCancelled);
    controller.cancel();
    await expect(second).rejects.toBeInstanceOf(ReauthCancelled);
  });

  it('fails the action with its own error when the repeat fails too', async () => {
    const { controller } = setup(() => new Response(null, { status: 204 }));
    const action = vi
      .fn()
      .mockRejectedValueOnce(needsReauth())
      .mockRejectedValueOnce(new ApiError(409, undefined));
    const result = controller.run(action);
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    await controller.submitPassword('x');
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
});

describe('the provider path', () => {
  it('stores the path and the intent, never a secret, then sends the browser to the provider', async () => {
    const { controller, stored, navigate, calls } = setup(() =>
      json({ authorizationUrl: 'https://idp.example.org/auth?x=1' }),
    );
    void controller
      .run(() => Promise.reject(needsReauth()), {
        id: 'profile.email',
        payload: { email: 'new@example.org' },
      })
      .catch(() => undefined);
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    await controller.startProvider('idp');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/account/reauthenticate/oidc/idp' });
    expect(navigate).toHaveBeenCalledWith('https://idp.example.org/auth?x=1');
    const entry = JSON.parse(stored[REAUTH_KEY]!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      path: '/a/b/profile?x=1',
      intent: { id: 'profile.email', payload: { email: 'new@example.org' } },
    });
    expect(Object.keys(entry).sort()).toEqual(['at', 'intent', 'path']);
  });

  it('says so when the account has no sign-in at that provider (404)', async () => {
    const { controller, navigate } = setup(() => problem(404));
    void controller.run(() => Promise.reject(needsReauth())).catch(() => undefined);
    await vi.waitFor(() => expect(controller.state.open).toBe(true));
    await controller.startProvider('other');
    expect(controller.state).toMatchObject({ problem: 'noSignIn', busy: false });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('takeReturn', () => {
  const local = (candidate: unknown) =>
    typeof candidate === 'string' && candidate.startsWith('/a/b/') ? candidate : null;
  const entry = (over: Record<string, unknown> = {}, at = 1_000) =>
    JSON.stringify({ path: '/a/b/profile', intent: { id: 'x', payload: { n: 1 } }, at, ...over });
  const storageOf = (value: string | undefined) => {
    const stored: Record<string, string> = value === undefined ? {} : { [REAUTH_KEY]: value };
    return {
      stored,
      storage: {
        getItem: (key: string) => stored[key] ?? null,
        setItem: (key: string, v: string) => void (stored[key] = v),
        removeItem: (key: string) => void delete stored[key],
      },
    };
  };

  it('hands back the path and the intent once, and removes the entry', () => {
    const { storage, stored } = storageOf(entry());
    expect(takeReturn(storage, local, 2_000)).toEqual({
      path: '/a/b/profile',
      intent: { id: 'x', payload: { n: 1 } },
    });
    expect(stored[REAUTH_KEY]).toBeUndefined();
    expect(takeReturn(storage, local, 2_000)).toBeUndefined();
  });

  it.each([
    ['a path to another origin', entry({ path: 'https://evil.example/' })],
    ['a path outside the base', entry({ path: '/other' })],
    ['no path', entry({ path: undefined })],
    ['not JSON', 'not json'],
    ['a stale entry', entry({}, 2_000 - REAUTH_RETURN_MAX_AGE_MS - 1)],
    ['an entry from the future', entry({}, 9_999)],
    ['no time', entry({ at: undefined })],
  ])('refuses %s, and still removes it', (_name, value) => {
    const { storage, stored } = storageOf(value);
    expect(takeReturn(storage, local, 2_000)).toBeUndefined();
    expect(stored[REAUTH_KEY]).toBeUndefined();
  });

  it('keeps no intent when it has no id, and works without storage', () => {
    const { storage } = storageOf(entry({ intent: { payload: 1 } }));
    expect(takeReturn(storage, local, 2_000)).toEqual({ path: '/a/b/profile', intent: undefined });
    expect(takeReturn(undefined, local)).toBeUndefined();
  });
});
