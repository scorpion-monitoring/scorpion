/**
 * The largest avatar the page lets a person pick (the upload ceiling of core.blob; `ui.test.ts` checks that
 * they agree). The server decides: this only saves a long upload that it would refuse.
 */
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

/** Items the profile page asks for per list (tokens, sessions): the API's largest page. */
export const PAGE_SIZE = '100';

/** The longest `returnTo` the sign-in page looks at. */
export const RETURN_TO_MAX = 2000;
