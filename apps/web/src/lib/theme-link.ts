// The address of the theme stylesheet (`GET /theme.css`, ADR-0051) that the root layout links. Client-safe: the layout runs in the browser.
import type { Branding } from '@scorpion/contracts/client';

/** The address the layout links, below the base path; none when no colour is set (the page is then exactly the built-in one). */
export function themeHref(
  branding: Pick<Branding, 'themeVersion'>,
  href: (path: string) => string,
): string | undefined {
  return branding.themeVersion === null
    ? undefined
    : href(`/theme.css?v=${encodeURIComponent(branding.themeVersion)}`);
}
