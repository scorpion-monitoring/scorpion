import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { failureMessage, failureOf, firstError } from './forms.ts';

const problem = (status: number, extra: object = {}) => ({
  type: 'about:blank',
  title: 't',
  status,
  ...extra,
});

describe('failureOf', () => {
  it('groups the messages of a 422 by field, whether the path says body or not', () => {
    const failure = failureOf(
      new ApiError(
        422,
        problem(422, {
          detail: 'The request is not valid.',
          errors: [
            { in: 'body', path: 'body.password', message: 'is in a breach' },
            { in: 'body', path: 'password', message: 'is too short' },
            { in: 'body', path: 'items.0.name', message: 'is empty' },
            { path: '', message: 'something general' },
          ],
        }),
      ),
    );
    expect(failure.fields).toEqual({
      password: ['is in a breach', 'is too short'],
      'items.0.name': ['is empty'],
    });
    expect(failure.general).toEqual(['something general']);
    expect(firstError(failure, 'password')).toBe('is in a breach');
    expect(firstError(failure, 'nope')).toBeUndefined();
    expect(firstError(undefined, 'password')).toBeUndefined();
  });

  it('uses the detail of a 422 without fields as the general message', () => {
    expect(
      failureOf(new ApiError(422, problem(422, { detail: 'The password is wrong.' }))).general,
    ).toEqual(['The password is wrong.']);
  });

  it('carries the status, the stable type and the wait', () => {
    expect(failureOf(new ApiError(403, problem(403, { type: 'account-pending' })))).toMatchObject({
      status: 403,
      type: 'account-pending',
    });
    expect(failureOf(new ApiError(429, problem(429), 7)).retryAfterSeconds).toBe(7);
  });

  it('reads anything else as a network failure', () => {
    expect(failureOf(new TypeError('Failed to fetch'))).toEqual({
      status: 0,
      type: undefined,
      fields: {},
      general: [],
      retryAfterSeconds: undefined,
    });
  });
});

describe('failureMessage', () => {
  const t = (key: string) => `[${key}]`;
  const failure = (status: number) => ({ status, retryAfterSeconds: undefined });

  it.each([
    [0, '[kit.error.network]'],
    [401, '[kit.error.signedOut]'],
    [403, '[kit.error.forbidden]'],
    [404, '[kit.error.notFound]'],
    [409, '[kit.error.conflict]'],
    [422, '[kit.error.invalid]'],
    [429, '[kit.error.throttled]'],
    [500, '[kit.error.generic]'],
    [502, '[kit.error.generic]'],
  ])('says %i as %s', (status, expected) => {
    expect(failureMessage(failure(status), t)).toBe(expected);
  });

  it('prefers what the action knows about a status, and only for that status', () => {
    expect(failureMessage(failure(409), t, { 409: 'The last Admin stays.' })).toBe(
      'The last Admin stays.',
    );
    expect(failureMessage(failure(403), t, { 409: 'The last Admin stays.' })).toBe(
      '[kit.error.forbidden]',
    );
  });
});
