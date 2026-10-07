// The token of a mailed link travels in the address fragment (`#token=…`), which the browser does not send
// to any server, so it is in no access log and no `Referer`. A page reads it once, then replaces the address.

/** The longest token the API accepts. */
const TOKEN_MAX = 128;

/** The `token` of a fragment such as `#token=abc`, or `undefined` when there is none or it is too long. */
export function tokenFromFragment(hash: string): string | undefined {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && token.length <= TOKEN_MAX ? token : undefined;
}

/** The mailed token of the link-confirmation page, kept for the visit to the sign-in page and back. */
export const LINK_TOKEN_KEY = 'scorpion.link-token';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Keeps the token until the page has used it. Returns whether it could be kept (no storage in a private window). */
export function stashToken(storage: Store | undefined, token: string): boolean {
  try {
    storage?.setItem(LINK_TOKEN_KEY, token);
    return storage !== undefined;
  } catch {
    return false;
  }
}

/** The kept token, if any. It stays until `dropToken()` so a visit to the provider (re-authentication) can come back. */
export function stashedToken(storage: Store | undefined): string | undefined {
  try {
    const token = storage?.getItem(LINK_TOKEN_KEY);
    return token && token.length <= TOKEN_MAX ? token : undefined;
  } catch {
    return undefined;
  }
}

export function dropToken(storage: Store | undefined): void {
  try {
    storage?.removeItem(LINK_TOKEN_KEY);
  } catch {
    // Nothing to remove.
  }
}
