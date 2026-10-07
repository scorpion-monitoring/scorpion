import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { loadSession, once } from './session.ts';

const answering = (status: number, body: unknown) =>
  ({
    GET: () =>
      Promise.resolve(
        status < 400
          ? { data: body, response: new Response(null, { status }) }
          : { error: body, response: new Response(null, { status }) },
      ),
  }) as never;

describe('loadSession', () => {
  const me = { user: { id: 'u', username: 'ada' }, roles: ['user'], csrfToken: 'token' };

  it('returns who is signed in, with the CSRF token of the session', async () => {
    expect(await loadSession(answering(200, me))).toEqual(me);
  });

  it.each([401, 403, 404])(
    'is nobody for a %i (no cookie, ended session, profile without identity)',
    async (status) => {
      expect(await loadSession(answering(status, { title: 'x', status }))).toBeNull();
    },
  );

  it('throws when the API fails, so the visitor gets an error page and not a page that looks signed out', async () => {
    await expect(loadSession(answering(500, { title: 'x', status: 500 }))).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe('once', () => {
  it('runs the load once and gives every caller the same answer', async () => {
    let runs = 0;
    const get = once(() => Promise.resolve(++runs));
    expect(await Promise.all([get(), get(), get()])).toEqual([1, 1, 1]);
    expect(runs).toBe(1);
  });
});
