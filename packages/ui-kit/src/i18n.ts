// The message catalogue (M5 decision 7): typed lookups, no library. Texts are keyed; the keys are
// prefixed with the area that owns them (`nav.home`). English is the source and the fallback, German is
// the second language, and `catalogueProblems()` fails for a key one of them lacks.
//
// A text that depends on a number has one key per plural form, `sessions.count.one` and
// `sessions.count.other` (the forms `Intl.PluralRules` names for the locale); `t('sessions.count', { count })`
// picks the form. The language is chosen by `negotiateLocale()` in the order of ADR-0022.
export type Messages = Readonly<Record<string, string>>;
export type MessageBundles = Readonly<Record<string, Messages>>;

export const DEFAULT_LOCALE = 'en';
/** The languages the application ships (ADR-0022). A new one is a new key set in every bundle and an entry here. */
export const SUPPORTED_LOCALES = ['en', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** The shipped language a tag stands for, by its primary subtag (`de-AT` gives `de`), or `undefined`. */
export function matchLocale(tag: string | null | undefined): Locale | undefined {
  const primary = (tag ?? '').trim().toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.find((locale) => locale === primary);
}

/** The language tags of an `Accept-Language` header, best first (by `q`, then by position). A bad part is skipped. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  return (header ?? '')
    .slice(0, 1000)
    .split(',')
    .map((part, position) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params
        .map((p) => /^\s*q\s*=\s*([01](?:\.\d{0,3})?)\s*$/.exec(p)?.[1])
        .find(Boolean);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), position };
    })
    .filter(({ tag, q }) => /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(tag) && q > 0)
    .sort((a, b) => b.q - a.q || a.position - b.position)
    .map(({ tag }) => tag);
}

/**
 * The language of a page, in the order of ADR-0022 and the M5 plan: the one the person chose (the
 * preference `notifications.locale`), then what the browser asks for, then the instance's default, then
 * English. A value that names no shipped language is skipped, so a bad value never fails a page.
 */
export function negotiateLocale(input: {
  preferred?: string | null;
  acceptLanguage?: string | null;
  instanceDefault?: string | null;
}): Locale {
  return (
    matchLocale(input.preferred) ??
    parseAcceptLanguage(input.acceptLanguage).map(matchLocale).find(Boolean) ??
    matchLocale(input.instanceDefault) ??
    DEFAULT_LOCALE
  );
}

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

/**
 * A lookup for one locale: its text, else the English one, else the key itself (never a blank). With a
 * numeric `count` among the parameters the plural form of the locale is looked for first
 * (`key.one`, `key.other`, ...), then `key.other`, then the plain key.
 */
export function createTranslator(bundles: MessageBundles, locale: string): Translate {
  const own = bundles[locale];
  const fallback = bundles[DEFAULT_LOCALE];
  const rules = new Intl.PluralRules(locale);
  return (key, params) => {
    const count = params?.count;
    const keys =
      typeof count === 'number' ? [`${key}.${rules.select(count)}`, `${key}.other`, key] : [key];
    for (const bundle of [own, fallback]) {
      for (const candidate of keys) {
        const text = bundle?.[candidate];
        if (text !== undefined) return interpolate(text, params);
      }
    }
    return interpolate(key, params);
  };
}

const PLACEHOLDER = /\{(\w+)\}/g;
const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const placeholders = (text: string) =>
  [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort().join(',');

/**
 * What is wrong with a catalogue: a key one shipped language has and another lacks, a text whose
 * `{placeholders}` differ from the English one, a plural form without `other`, and a plural form the
 * locale does not use. Empty when the catalogue is complete. Tests of the web app and of every module
 * run it, so a missing German text fails the build.
 */
export function catalogueProblems(bundles: MessageBundles): string[] {
  const problems: string[] = [];
  const source = bundles[DEFAULT_LOCALE] ?? {};
  for (const locale of SUPPORTED_LOCALES) {
    const bundle = bundles[locale] ?? {};
    for (const [key, text] of Object.entries(source)) {
      if (locale === DEFAULT_LOCALE) continue;
      if (!(key in bundle)) problems.push(`${locale}: missing "${key}"`);
      else if (placeholders(text) !== placeholders(bundle[key]!)) {
        problems.push(`${locale}: "${key}" has other placeholders than the English text`);
      }
    }
    for (const key of Object.keys(bundle)) {
      if (!(key in source)) problems.push(`${locale}: "${key}" has no English text`);
    }
    const used = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
    for (const key of Object.keys(bundle)) {
      const form = key.split('.').at(-1)!;
      if (!FORMS.includes(form) || !key.includes('.')) continue;
      const base = key.slice(0, key.lastIndexOf('.'));
      if (!(`${base}.other` in bundle))
        problems.push(`${locale}: "${base}" has plural forms but no "other"`);
      if (!used.has(form as Intl.LDMLPluralRule) && locale !== DEFAULT_LOCALE) {
        problems.push(`${locale}: "${key}" is a plural form this language does not use`);
      }
    }
  }
  for (const locale of Object.keys(bundles)) {
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale))
      problems.push(`"${locale}" is not a shipped language`);
  }
  return problems;
}
