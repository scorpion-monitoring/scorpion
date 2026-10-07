import {
  ApiError,
  createApiClient,
  unwrap,
  type ApiClient,
  type Navigation,
  type Session,
} from '@scorpion/contracts/client';
import { apiOrigin, basePath } from './env.ts';

/** The client for one request: it forwards the caller's cookie and the chain of client addresses. */
export function clientFor(request: Request): ApiClient {
  return createApiClient({
    basePath,
    origin: apiOrigin,
    cookie: () => request.headers.get('cookie') ?? undefined,
    headers: (): Record<string, string> => {
      const chain = request.headers.get('x-forwarded-for');
      return chain ? { 'x-forwarded-for': chain } : {};
    },
  });
}

/**
 * Who is signed in. `null` for anybody else: no cookie, an ended session, or a profile without
 * `core.identity` (the route is then unknown, 404). Any other failure is the API being down: it
 * throws, and the visitor gets the error page rather than a page that wrongly looks signed out.
 */
export async function loadSession(api: ApiClient, cookie?: string | null): Promise<Session | null> {
  // Without any cookie nobody can be signed in: no call, and no 401 in the API's log for a first visit.
  // (The session is the only cookie the application sets, so its name is not repeated here.)
  if (cookie !== undefined && (cookie ?? '').trim() === '') return null;
  try {
    return await unwrap(api.GET('/auth/me'));
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return null;
    throw error;
  }
}

/** What the caller may see, from the one list that also decides the pages they may open. */
export function loadNavigation(api: ApiClient): Promise<Navigation> {
  return unwrap(api.GET('/ui/navigation'));
}

/** `() => Promise<T>` that runs `load` once and hands the same answer to every caller. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined;
  return () => (result ??= load());
}
