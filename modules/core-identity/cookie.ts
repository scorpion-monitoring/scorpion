// The session cookie and the CSRF header (ADR 0007).
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

/** `__Host-` makes the browser insist on Secure, Path=/ and no Domain, so a sibling site cannot plant one. */
export const SESSION_COOKIE = '__Host-session';
export const CSRF_HEADER = 'x-csrf-token';

const attributes = { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' } as const;

export const readSessionCookie = (c: Context): string | undefined => getCookie(c, SESSION_COOKIE);

export function writeSessionCookie(c: Context, id: string, expiresAt: Date): void {
  setCookie(c, SESSION_COOKIE, id, { ...attributes, expires: expiresAt });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

/** Methods that cannot change state; everything else needs the CSRF token. */
export const isSafeMethod = (method: string): boolean =>
  method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

/**
 * The login cookie of an OIDC flow in progress (ADR 0011): its value is the PKCE verifier, and the
 * server keeps only the hash. It is not the session cookie and lives for the 10 minutes a login may take.
 * `SameSite=Lax` sends it on the provider's top-level redirect back to the callback.
 */
export const LOGIN_COOKIE = '__Host-oidc-login';

export const readLoginCookie = (c: Context): string | undefined => getCookie(c, LOGIN_COOKIE);

export function writeLoginCookie(c: Context, verifier: string, maxAgeSeconds: number): void {
  setCookie(c, LOGIN_COOKIE, verifier, { ...attributes, maxAge: maxAgeSeconds });
}

export function clearLoginCookie(c: Context): void {
  deleteCookie(c, LOGIN_COOKIE, { path: '/', secure: true });
}
