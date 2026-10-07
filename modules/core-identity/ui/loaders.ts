// What the pages need before they render. They run on the server, after the permission check, and
// **throw** when they cannot get their data (defect 12): an `ApiError` becomes the error page.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap, type ApiClient } from '@scorpion/contracts/client';
import { PAGE_SIZE, RETURN_TO_MAX } from './limits.ts';

export interface PublicProvider {
  id: string;
  displayName: string;
  iconHash?: string;
}

export type LoginNotice = 'check-mail' | 'password-changed' | 'signed-out';

export interface LoginData {
  providers: PublicProvider[];
  /** The raw `returnTo` of the address; the page checks it against the base path before it goes there. */
  returnTo: string | null;
  notice: LoginNotice | null;
}

const NOTICES: readonly LoginNotice[] = ['check-mail', 'password-changed', 'signed-out'];

export async function providersOf(api: ApiClient): Promise<PublicProvider[]> {
  return (await unwrap(api.GET('/auth/oidc/providers', { params: { query: { pageSize: '20' } } })))
    .result;
}

export async function loadLogin({ api, url }: UiLoadContext): Promise<LoginData> {
  const returnTo = url.searchParams.get('returnTo');
  const notice = url.searchParams.get('notice');
  return {
    providers: await providersOf(api),
    returnTo: returnTo !== null && returnTo.length <= RETURN_TO_MAX ? returnTo : null,
    notice: NOTICES.find((known) => known === notice) ?? null,
  };
}

/** The first-admin form exists while the instance has no administrator and is a 404 page afterwards. */
export async function loadFirstAdmin({ api }: UiLoadContext): Promise<null> {
  const { needsFirstAdmin } = await unwrap(api.GET('/bootstrap/status'));
  if (!needsFirstAdmin) {
    throw new ApiError(404, {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'There is no such page.',
    });
  }
  return null;
}

export async function loadProviders({
  api,
}: UiLoadContext): Promise<{ providers: PublicProvider[] }> {
  return { providers: await providersOf(api) };
}

export interface ProfileData {
  profile: {
    username: string;
    displayName: string | null;
    email: string | null;
    emailVerified: boolean;
    pendingEmail: string | null;
    bio: string | null;
    avatarHash: string | null;
  };
  /** `null` when the caller may not read their tokens (a custom role without the permission): the section is left out. */
  tokens:
    | {
        id: string;
        name: string;
        prefix: string;
        scopes: string[];
        expiresAt: string | null;
        lastUsedAt: string | null;
        createdAt: string;
      }[]
    | null;
  sessions: { id: string; createdAt: string; lastSeenAt: string; current: boolean }[] | null;
  providers: PublicProvider[];
  /** The stored language preference (`en`, `de`), or `null` for "as the browser says". */
  locale: string | null;
}

export const LOCALE_PREFERENCE = 'notifications.locale';

export async function loadProfile({ api }: UiLoadContext): Promise<ProfileData> {
  const query = { pageSize: PAGE_SIZE };
  const [profile, tokens, sessions, providers, preferences] = await Promise.all([
    unwrap(api.GET('/account/profile')),
    allowed(unwrap(api.GET('/tokens', { params: { query } }))),
    allowed(unwrap(api.GET('/account/sessions', { params: { query } }))),
    providersOf(api),
    allowed(unwrap(api.GET('/preferences', { params: { query } }))),
  ]);
  const stored = preferences?.result.find((preference) => preference.key === LOCALE_PREFERENCE);
  return {
    profile,
    tokens: tokens?.result ?? null,
    sessions: sessions?.result ?? null,
    providers,
    locale: typeof stored?.value === 'string' ? stored.value : null,
  };
}

/** A part of the page the caller's role does not allow (403) is left out; any other failure fails the page. */
async function allowed<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null;
    throw error;
  }
}
