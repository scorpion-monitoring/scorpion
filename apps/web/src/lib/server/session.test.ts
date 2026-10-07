import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { createBootstrapProbe, loadLocale, loadSession, once } from './session.ts';

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

describe('a visitor without a cookie', () => {
  it('is nobody, and the API is not asked', async () => {
    let asked = 0;
    const api = {
      GET: () => {
        asked += 1;
        return Promise.reject(new Error('should not be called'));
      },
    } as never;
    expect(await loadSession(api, '')).toBeNull();
    expect(await loadSession(api, '   ')).toBeNull();
    expect(asked).toBe(0);
  });

  it('is asked about when there is a cookie (the API judges it)', async () => {
    const me = { user: { id: 'u' }, roles: [], csrfToken: null };
    expect(await loadSession(answering(200, me), '__Host-session=abc')).toEqual(me);
    expect(
      await loadSession(answering(401, { title: 'x', status: 401 }), '__Host-session=old'),
    ).toBeNull();
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

describe('createBootstrapProbe', () => {
  const counting = (answers: ({ needsFirstAdmin: boolean } | number)[]) => {
    let asked = 0;
    const api = {
      GET: () => {
        const answer = answers[Math.min(asked++, answers.length - 1)]!;
        return Promise.resolve(
          typeof answer === 'number'
            ? {
                error: { title: 'x', status: answer },
                response: new Response(null, { status: answer }),
              }
            : { data: answer, response: new Response(null, { status: 200 }) },
        );
      },
    } as never;
    return { api, asked: () => asked };
  };

  it('asks every time while the answer is yes, and never again once it is no', async () => {
    const probe = createBootstrapProbe();
    const { api, asked } = counting([
      { needsFirstAdmin: true },
      { needsFirstAdmin: true },
      { needsFirstAdmin: false },
    ]);
    expect(await probe(api)).toBe(true);
    expect(await probe(api)).toBe(true);
    expect(await probe(api)).toBe(false);
    expect(await probe(api)).toBe(false);
    expect(asked()).toBe(3);
  });

  it('is no, for good, in a profile without the route (404)', async () => {
    const probe = createBootstrapProbe();
    const { api, asked } = counting([404]);
    expect(await probe(api)).toBe(false);
    expect(await probe(api)).toBe(false);
    expect(asked()).toBe(1);
  });

  it('throws when the API fails, and keeps asking', async () => {
    const probe = createBootstrapProbe();
    const { api } = counting([500, { needsFirstAdmin: false }]);
    await expect(probe(api)).rejects.toBeInstanceOf(ApiError);
    expect(await probe(api)).toBe(false);
  });
});

describe('loadLocale', () => {
  const preferences = (value: unknown) =>
    ({
      GET: () =>
        Promise.resolve({
          data: { result: [{ key: 'notifications.locale', value }] },
          response: new Response(null, { status: 200 }),
        }),
    }) as never;
  const session = { user: { id: 'u' }, roles: [], csrfToken: 't' } as never;

  it('is the preference of a signed-in person before the browser language', async () => {
    expect(await loadLocale(preferences('de'), session, 'en-GB,en')).toBe('de');
  });

  it('is the browser language for a visitor, without asking the API', async () => {
    const api = {
      GET: () => {
        throw new Error('must not be asked');
      },
    } as never;
    expect(await loadLocale(api, null, 'de-AT,de;q=0.9')).toBe('de');
    expect(await loadLocale(api, null, 'fr')).toBe('en');
    expect(await loadLocale(api, null, null)).toBe('en');
  });

  it('falls back to the browser when the preference is unreadable or names no shipped language', async () => {
    expect(await loadLocale(preferences('fr'), session, 'de')).toBe('de');
    expect(await loadLocale(preferences(42), session, 'de')).toBe('de');
    const failing = {
      GET: () =>
        Promise.resolve({
          error: { title: 'x', status: 403 },
          response: new Response(null, { status: 403 }),
        }),
    } as never;
    expect(await loadLocale(failing, session, 'de')).toBe('de');
  });
});
