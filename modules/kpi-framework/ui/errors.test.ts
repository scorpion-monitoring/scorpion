import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { usesOf } from './errors.ts';

const problem = (status: number, type: string, errors: { path: string; message: string }[]) =>
  new ApiError(status, { type, title: 't', status, detail: 'd', errors });

describe('usesOf', () => {
  it('reads the module, what it holds and the count from a kpi-in-use problem', () => {
    const error = problem(409, 'https://x.example/problems/kpi-in-use', [
      { path: 'kpi.framework.sets', message: '2' },
      { path: 'kpi.framework.evaluations', message: '1' },
    ]);
    expect(usesOf(error)).toEqual([
      { module: 'kpi.framework', what: 'sets', count: 2 },
      { module: 'kpi.framework', what: 'evaluations', count: 1 },
    ]);
  });

  it('skips an entry that is not a count and answers nothing for any other failure', () => {
    expect(
      usesOf(
        problem(409, 'kpi-in-use', [
          { path: 'nodot', message: '1' },
          { path: 'a.b', message: 'x' },
        ]),
      ),
    ).toEqual([]);
    expect(usesOf(problem(409, 'other', []))).toBeUndefined();
    expect(usesOf(problem(422, 'kpi-in-use', []))).toBeUndefined();
    expect(usesOf(new Error('x'))).toBeUndefined();
  });
});
