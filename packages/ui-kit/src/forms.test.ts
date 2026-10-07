import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { failureOf, firstError } from './forms.ts';

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
