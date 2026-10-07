/** One problem with one field of the request, reported in the `errors` array of a problem. */
export interface FieldProblem {
  /** Where the field is: `body`, `query`, `path`, `header`. */
  in?: string;
  /** Dotted path to the field, `items.0.name`. Empty for the whole input. */
  path: string;
  message: string;
}

/**
 * An expected failure. Services throw these; the error mapper of the request pipeline turns them
 * into RFC 9457 problem responses. Anything else that is thrown becomes a 500 without details.
 */
export class DomainError extends Error {
  readonly status: number;
  readonly title: string;
  readonly errors: readonly FieldProblem[] | undefined;
  /** A stable problem type (RFC 9457) a client can switch on; `undefined` is `about:blank`. */
  readonly type: string | undefined;
  /** For a 429: how long the caller should wait. The error mapper writes it as `Retry-After`. */
  retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    title: string,
    detail: string,
    errors?: readonly FieldProblem[],
    type?: string,
  ) {
    super(detail);
    this.name = new.target.name;
    this.status = status;
    this.title = title;
    this.errors = errors;
    this.type = type;
    this.retryAfterSeconds = undefined;
  }
}

/** 404: the thing does not exist, or the caller may not know that it does. */
export class NotFound extends DomainError {
  constructor(detail = 'The requested resource does not exist.') {
    super(404, 'Not Found', detail);
  }
}

/** 409: the request conflicts with the current state (a duplicate, a stale update). */
export class Conflict extends DomainError {
  constructor(detail = 'The request conflicts with the current state of the resource.') {
    super(409, 'Conflict', detail);
  }
}

/** 403: the caller is known but may not do this. */
export class Forbidden extends DomainError {
  constructor(detail = 'You are not allowed to do this.') {
    super(403, 'Forbidden', detail);
  }
}

/** 401: the caller is not authenticated. */
export class Unauthorized extends DomainError {
  constructor(detail = 'Authentication is required.') {
    super(401, 'Unauthorized', detail);
  }
}

/** 422: the input is well-formed but not acceptable, or refers to something that does not exist. */
export class Invalid extends DomainError {
  constructor(detail = 'The request is not valid.', errors?: readonly FieldProblem[]) {
    super(422, 'Unprocessable Content', detail, errors);
  }
}

/** The problem type of {@link ReauthenticationRequired}. */
export const REAUTHENTICATION_REQUIRED = 'reauthentication-required';

/**
 * 401 with a stable problem type: the session is good, but this change needs a recent
 * authentication (ASVS 7.5.1). The client asks for the password or the provider, then repeats it.
 */
export class ReauthenticationRequired extends DomainError {
  constructor(detail = 'Confirm your identity again to do this.') {
    super(401, 'Unauthorized', detail, undefined, REAUTHENTICATION_REQUIRED);
  }
}
