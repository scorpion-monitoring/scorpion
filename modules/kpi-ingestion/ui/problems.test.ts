import { ApiError } from '@scorpion/contracts/client';
import { describe, expect, it } from 'vitest';
import { messages } from './messages.ts';
import {
  countVerdicts,
  problemKey,
  problemsAt,
  problemsOutside,
  refusedRunId,
  requestProblemOf,
} from './problems.ts';

const RUN = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
const failure = (
  status: number,
  detail: string,
  errors: { path: string; message: string }[] = [],
) =>
  new ApiError(status, {
    type: 'about:blank',
    title: 'Unprocessable',
    status,
    detail,
    errors: errors.map((error) => ({ in: 'body', ...error })),
  });

describe('problemKey', () => {
  it('names the sentence of a code, and the generic one for a code the page has no words for', () => {
    expect(problemKey('required-value', messages.en!)).toBe('submit.problem.required-value');
    expect(problemKey('a-code-of-a-newer-server', messages.en!)).toBe('submit.problem.unknown');
  });
});

describe('refusedRunId', () => {
  it('reads the recorded run from the message of a refused commit', () => {
    expect(
      refusedRunId(failure(422, `The file was refused and nothing was recorded (run ${RUN}).`)),
    ).toBe(RUN);
    expect(refusedRunId(failure(422, `refused (run ${RUN.toUpperCase()})`))).toBe(RUN);
  });

  it.each<[string, unknown]>([
    ['a 422 with no run in it', failure(422, 'The request is not valid.')],
    ['another status', failure(500, `(run ${RUN})`)],
    ['a thing that is no ApiError', new Error(`(run ${RUN})`)],
    ['nothing', undefined],
    ['a text that only looks like a run', failure(422, 'run 1234')],
  ])('is undefined for %s', (_, error) => {
    expect(refusedRunId(error)).toBeUndefined();
  });
});

describe('requestProblemOf', () => {
  it.each<[string, string | undefined]>([
    ['form', 'form'],
    ['form.values', 'form'],
    ['body.form', 'form'],
    ['file', 'file'],
    ['serviceId', 'serviceId'],
    ['adapter', 'adapter'],
    ['mapping', 'mapping'],
    ['sheet', 'other'],
    ['rows[3].columns[2]', undefined],
  ])('reads the path %s as %s', (path, expected) => {
    expect(
      requestProblemOf(failure(422, 'The request is not valid.', [{ path, message: 'x' }])),
    ).toBe(expected);
  });

  it.each<[string, string]>([
    ['form', 'holds no values to record'],
    ['file', 'holds no values to record'],
  ])('reads %s that %s as noValues', (path, message) => {
    expect(requestProblemOf(failure(422, 'The request is not valid.', [{ path, message }]))).toBe(
      'noValues',
    );
  });

  it('is undefined for a failure that is not a 422 or names no path', () => {
    expect(requestProblemOf(failure(403, 'no'))).toBeUndefined();
    expect(requestProblemOf(failure(422, 'no'))).toBeUndefined();
    expect(requestProblemOf(new Error('x'))).toBeUndefined();
  });
});

describe('the problems of a file', () => {
  const problems = [
    { row: 0, column: 0, code: 'format' as const },
    { row: 2, column: 0, code: 'period-missing' as const },
    { row: 2, column: 3, code: 'value-invalid' as const },
    { row: 40, column: 3, code: 'value-invalid' as const },
  ];

  it('counts the verdicts, zero for the ones that did not happen', () => {
    expect(
      countVerdicts([{ verdict: 'insert' }, { verdict: 'insert' }, { verdict: 'reject' }]),
    ).toEqual({
      insert: 2,
      update: 0,
      unchanged: 0,
      reject: 1,
    });
    expect(countVerdicts([])).toEqual({ insert: 0, update: 0, unchanged: 0, reject: 0 });
  });

  it('finds the problems of one cell', () => {
    expect(problemsAt(problems, 2, 3)).toEqual([problems[2]]);
    expect(problemsAt(problems, 2, 4)).toEqual([]);
  });

  it('keeps apart the problems that belong to no cell of the preview: the file, a whole row, a row not shown', () => {
    expect(problemsOutside(problems, [2, 3, 4])).toEqual([problems[0], problems[1], problems[3]]);
  });
});
