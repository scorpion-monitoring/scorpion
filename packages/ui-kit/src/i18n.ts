// The message catalogue (M5 decision 7): typed lookups, no library. Texts are keyed; the keys are
// prefixed with the area that owns them (`nav.home`). English is the source and the fallback. Sprint 2
// of M5 adds German and the check that every key has both.
export type Messages = Readonly<Record<string, string>>;
export type MessageBundles = Readonly<Record<string, Messages>>;

export const DEFAULT_LOCALE = 'en';

/** `{name}` placeholders. Anything else in the text is left as written. */
export function interpolate(
  text: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Merges the bundles of several modules; a key defined twice for one locale is an error. */
export function mergeBundles(parts: readonly MessageBundles[]): MessageBundles {
  const merged: Record<string, Record<string, string>> = {};
  for (const part of parts) {
    for (const [locale, messages] of Object.entries(part)) {
      const target = (merged[locale] ??= {});
      for (const [key, text] of Object.entries(messages)) {
        if (key in target) throw new Error(`Message "${key}" (${locale}) is defined twice`);
        target[key] = text;
      }
    }
  }
  return merged;
}

export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** A lookup for one locale: its text, else the English one, else the key itself (never a blank). */
export function createTranslator(bundles: MessageBundles, locale: string): Translate {
  const own = bundles[locale];
  const fallback = bundles[DEFAULT_LOCALE];
  return (key, params) => interpolate(own?.[key] ?? fallback?.[key] ?? key, params);
}
