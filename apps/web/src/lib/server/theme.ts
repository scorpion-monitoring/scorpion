// `GET /theme.css` (M12a sprint 4, ADR-0051): the administrator's theme colours as a stylesheet from this origin, the one way they reach
// the page under its policy (`style-src 'self'`, no 'unsafe-inline'). The text is built by `themeStylesheet` of
// `@scorpion/contracts/theme-colors`, which writes known tokens with `#rrggbb` values and drops anything else.
import { themeStylesheet } from '@scorpion/contracts/theme-colors';
import type { Branding } from '@scorpion/contracts/client';

/** How long a browser keeps the sheet at a versioned address. A new set has a new address, so this only bounds a stale copy. */
export const THEME_MAX_AGE_SECONDS = 300;

/**
 * The sheet and its `Cache-Control` for `version` (the `v` of the address). The sheet is the current one whatever `v` says; it is cached
 * only when `v` is the current version, so a sheet read from a process that had not yet seen a save is never kept under the new address.
 */
export function themeSheet(
  branding: Pick<Branding, 'colors' | 'themeVersion'>,
  version: string | null,
): { css: string; cacheControl: string } {
  const current = branding.themeVersion !== null && version === branding.themeVersion;
  return {
    css: themeStylesheet(branding.colors),
    cacheControl: current ? `public, max-age=${THEME_MAX_AGE_SECONDS}` : 'no-cache',
  };
}
