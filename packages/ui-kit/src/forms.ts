// What a form needs of an API failure: the messages of a 422 by field, the one for the whole form, and
// the seconds a throttled caller has to wait. The server judges the input; the client shows its words
// and repeats none of its rules (M5 plan, sprint 2 item 4).
import { ApiError } from '@scorpion/contracts/client';

export type FieldErrors = Record<string, string[]>;

export interface FormFailure {
  /** The status, `0` for a network failure. */
  status: number;
  /** The stable problem type, if the API names one. */
  type: string | undefined;
  /** Messages by field name (`password`, `scopes`, `items.0.name`). */
  fields: FieldErrors;
  /** Problems of the whole request, or the detail when no field is named. */
  general: string[];
  retryAfterSeconds: number | undefined;
}

/** `body.password` and `password` both name the field `password`. */
function fieldName(path: string): string {
  return path.replace(/^(body|query|path|header)\./, '');
}

/** Reads any thrown value as a failure of a form. A value that is not an `ApiError` is a network failure. */
export function failureOf(error: unknown): FormFailure {
  if (!(error instanceof ApiError)) {
    return {
      status: 0,
      type: undefined,
      fields: {},
      general: [],
      retryAfterSeconds: undefined,
    };
  }
  const fields: FieldErrors = {};
  const general: string[] = [];
  for (const problem of error.problem?.errors ?? []) {
    const name = fieldName(problem.path);
    if (name === '') general.push(problem.message);
    else (fields[name] ??= []).push(problem.message);
  }
  if (Object.keys(fields).length === 0 && general.length === 0 && error.status === 422) {
    general.push(error.message);
  }
  return {
    status: error.status,
    type: error.type,
    fields,
    general,
    retryAfterSeconds: error.retryAfterSeconds,
  };
}

/** The first message of a field, or `undefined`. */
export const firstError = (failure: FormFailure | undefined, field: string): string | undefined =>
  failure?.fields[field]?.[0];
