// The typed client of the internal API (ADR-0027), shared by the web app's server and browser code.
// It is `openapi-fetch` over the types generated from the routes (`pnpm openapi:generate`), with the
// base path built by `url()`, the CSRF header on every unsafe method, and one error type for problems.
// A separate entry (`@scorpion/contracts/client`), so the server does not load it.
import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './generated/schema.ts';
import { problemSchema, type Problem } from './problem.ts';
import { url } from './url.ts';

export type { paths };
export type ApiClient = Client<paths>;
type Json<Path extends keyof paths, Method extends 'get' | 'post'> =
  paths[Path] extends Record<
    Method,
    { responses: { 200: { content: { 'application/json': infer Body } } } }
  >
    ? Body
    : never;

/** What `GET /auth/me` returns: the caller, their roles and the CSRF token of the session. */
export type Session = Json<'/auth/me', 'get'>;
/** What `GET /ui/navigation` returns. */
export type Navigation = Json<'/ui/navigation', 'get'>;
/** What `GET /branding` returns. */
export type Branding = Json<'/branding', 'get'>;
export type LegalPage = Json<'/legal/{page}', 'get'>;

/** A response that was not a success, with the problem+json body when there was one. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | undefined;
  constructor(status: number, problem: Problem | undefined) {
    super(problem?.detail ?? problem?.title ?? `The request failed with status ${status}.`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export interface ApiClientOptions {
  /** `BASE_PATH` of the instance. */
  basePath: string;
  /**
   * The origin of the API when the code runs on a server (`http://127.0.0.1:3001`). Leave it out in
   * the browser, where the paths are relative to the page's origin.
   */
  origin?: string;
  fetch?: typeof fetch;
  /** The CSRF token of the session, read for each unsafe request. It is held in memory, never stored. */
  csrfToken?: () => string | undefined;
  /** The caller's `Cookie` header, forwarded by code that runs on the server for a request. */
  cookie?: () => string | undefined;
  /** Headers added to every request (the client address of the caller, when a server forwards it). */
  headers?: () => Record<string, string>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: `${options.origin ?? ''}${url(options.basePath, '/api/internal')}`,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const middleware: Middleware = {
    onRequest({ request }) {
      for (const [name, value] of Object.entries(options.headers?.() ?? {})) {
        request.headers.set(name, value);
      }
      const cookie = options.cookie?.();
      if (cookie) request.headers.set('cookie', cookie);
      const token = options.csrfToken?.();
      if (token && !SAFE_METHODS.has(request.method.toUpperCase())) {
        request.headers.set('x-csrf-token', token);
      }
      return request;
    },
  };
  client.use(middleware);
  return client;
}

/**
 * The data of a call, or an `ApiError` for a response that was not a success. `await unwrap(api.GET('/auth/me'))`.
 * A loader that gets an error throws it (defect 12); it never returns a `Response`.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok || error !== undefined) {
    const problem = problemSchema.safeParse(error);
    throw new ApiError(response.status, problem.success ? problem.data : undefined);
  }
  return data as T;
}
