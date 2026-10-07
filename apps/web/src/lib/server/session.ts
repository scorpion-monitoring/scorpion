import {
  ApiError,
  createApiClient,
  unwrap,
  type ApiClient,
  type Navigation,
  type Session,
} from '@scorpion/contracts/client';
import { negotiateLocale, type Locale } from '@scorpion/ui-kit';
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

/** The preference that names the language of a person's mail, and of the screens (ADR-0022). */
export const LOCALE_PREFERENCE = 'notifications.locale';

/**
 * The language of this request: the person's preference when someone is signed in, then the browser's
 * `Accept-Language`, then English (the instance default has no public route yet, see docs/backlog.md).
 * A preference that cannot be read, because the profile has no settings module or the API is slow,
 * never fails a page: the next step of the order is used.
 */
export async function loadLocale(
  api: ApiClient,
  session: Session | null,
  acceptLanguage: string | null,
): Promise<Locale> {
  let preferred: string | undefined;
  if (session) {
    try {
      const { result } = await unwrap(
        api.GET('/preferences', { params: { query: { pageSize: '100' } } }),
      );
      const found = result.find((preference) => preference.key === LOCALE_PREFERENCE);
      if (typeof found?.value === 'string') preferred = found.value;
    } catch {
      // Not readable: fall through to the browser's language.
    }
  }
  return negotiateLocale({ preferred, acceptLanguage });
}

/**
 * Asks whether the instance still has no administrator, so that the start page offers the first-admin
 * form and nothing else is reachable. Once an administrator exists the answer is false for good, so
 * it is remembered and costs no call; the "yes" is asked every time. A profile without `core.identity`
 * has no such route (404) and no form.
 */
export function createBootstrapProbe(): (api: ApiClient) => Promise<boolean> {
  let done = false;
  return async (api) => {
    if (done) return false;
    try {
      const { needsFirstAdmin } = await unwrap(api.GET('/bootstrap/status'));
      if (!needsFirstAdmin) done = true;
      return needsFirstAdmin;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        done = true;
        return false;
      }
      throw error;
    }
  };
}
