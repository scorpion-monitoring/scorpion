// The languages the module ships and how a locale is chosen (M4 decision 5).

/** The catalogues that exist. A locale outside this list is never stored on a delivery. */
export const SUPPORTED_LOCALES = ['en', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const FALLBACK_LOCALE: Locale = 'en';

/**
 * The shipped locale for a language tag: `de` and `de-AT` give `de`, `fr` gives `undefined`. Case
 * is ignored. A tag that is not a string is `undefined`.
 */
export function matchLocale(tag: unknown): Locale | undefined {
  if (typeof tag !== 'string') return undefined;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.find((locale) => locale === primary);
}

/**
 * The locale of a message, first match wins: the one the caller names (a user's preference, or the
 * one a request carried), the instance's `defaultLocale`, then English. Each candidate is checked
 * against the shipped list, so a bad value falls through instead of failing a mail.
 */
export function resolveLocale(...candidates: unknown[]): Locale {
  for (const candidate of candidates) {
    const found = matchLocale(candidate);
    if (found) return found;
  }
  return FALLBACK_LOCALE;
}
