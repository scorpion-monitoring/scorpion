// The words behind the delete and type-change errors of the organisation screens: the server names the
// modules that still refer to the organisation and never the rows. The page turns the result into text.
import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { modulesInUse, ORGANISATION_IN_USE, referenceBlock } from './errors.ts';

const problem = (status: number, type: string, detail: string) =>
  new ApiError(status, { type, title: 'Conflict', status, detail });

describe('modulesInUse', () => {
  it.each([
    ['The organisation is still in use by: registry.services.', ['registry.services']],
    [
      'The organisation is still in use by: registry.services, kpi.impact.',
      ['registry.services', 'kpi.impact'],
    ],
    ['The organisation is still in use by: a.b, c-d, e.', ['a.b', 'c-d', 'e']],
    ['The organisation is still in use by: ', []],
    ['Something else entirely', []],
    ['The organisation is still in use by: <script>alert(1)</script>.', []],
  ])('%j', (detail, expected) => {
    expect(modulesInUse(detail)).toEqual(expected);
  });
});

describe('referenceBlock', () => {
  it('reads a 409 organisation-in-use and names the modules', () => {
    const error = problem(
      409,
      `https://scorpion.example/problems/${ORGANISATION_IN_USE}`,
      'The organisation is still in use by: registry.services.',
    );
    expect(referenceBlock(error)).toEqual({ modules: ['registry.services'] });
  });

  it('is not a reference block for another conflict, another status or another error', () => {
    expect(referenceBlock(problem(409, 'membership-state', 'x'))).toBeUndefined();
    expect(referenceBlock(problem(404, ORGANISATION_IN_USE, 'x'))).toBeUndefined();
    expect(referenceBlock(new Error('network'))).toBeUndefined();
    expect(referenceBlock(undefined)).toBeUndefined();
  });

  it('says so with no modules when the text does not name them', () => {
    expect(referenceBlock(problem(409, ORGANISATION_IN_USE, 'in use'))).toEqual({ modules: [] });
  });
});
