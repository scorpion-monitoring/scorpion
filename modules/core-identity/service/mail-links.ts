// The links in the mails core.identity sends. A link is `<ORIGIN><BASE_PATH><page>`, built for any
// number of path segments in BASE_PATH. The pages are the interface M5 builds on (ADR 0012): the
// token of a reset or a verification link travels in the URL **fragment**, which a browser does not
// send to the server, so it is in no access log, no proxy log and no `Referer`. The page reads it and
// posts it to the confirm route.
import { mountPath } from '@scorpion/kernel';

export const RESET_PAGE = '/reset-password';
export const VERIFY_PAGE = '/verify-email';
export const SIGN_IN_PAGE = '/login';
/** Where a signed-in person confirms linking a sign-in provider (the page is M5's; ADR 0026). */
export const OIDC_LINK_PAGE = '/link-sign-in';
/** Where a person who forgot their password asks for a link. */
export const FORGOT_PASSWORD_PAGE = '/forgot-password';
/** Where an administrator reviews the accounts that wait for a decision. */
export const REVIEW_PAGE = '/admin/users/pending';

type Config = { ORIGIN: string; BASE_PATH: string };

export interface MailLinks {
  reset(token: string): string;
  verify(token: string): string;
  oidcLink(token: string): string;
  signIn(): string;
  forgotPassword(): string;
  review(): string;
}

export function createMailLinks(config: Config): MailLinks {
  const page = (path: string, fragment = '') =>
    `${config.ORIGIN}${mountPath(config)}${path}${fragment}`;
  return {
    reset: (token) => page(RESET_PAGE, `#token=${encodeURIComponent(token)}`),
    verify: (token) => page(VERIFY_PAGE, `#token=${encodeURIComponent(token)}`),
    oidcLink: (token) => page(OIDC_LINK_PAGE, `#token=${encodeURIComponent(token)}`),
    signIn: () => page(SIGN_IN_PAGE),
    forgotPassword: () => page(FORGOT_PASSWORD_PAGE),
    review: () => page(REVIEW_PAGE),
  };
}
