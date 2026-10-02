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
