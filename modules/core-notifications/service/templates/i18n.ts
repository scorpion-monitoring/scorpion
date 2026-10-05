// Message catalogues and the translator a template uses. A key missing in the chosen language
// falls back to English at run time (and is reported, so a test can fail on it); a key missing in
// English is a bug in the template and throws.
import { FALLBACK_LOCALE, type Locale } from './locale.ts';
import { oneLine } from './text.ts';

export type Catalogue = Readonly<Record<string, string>>;
export type Catalogues = Readonly<Record<Locale, Catalogue>>;

export type Translate = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

export interface TranslatorOptions {
  /** Called with the key when the chosen language has no entry and English is used instead. */
  onFallback?: (key: string, locale: Locale) => void;
}

/**
 * `t('greeting', { name })` fills `{name}` in the catalogue text. Values are cleaned to one line
 * (no line breaks, no bidirectional marks) before they are put in, so a hostile name cannot break
 * the layout of a subject or a line. HTML escaping is the layout's job, applied to the finished
 * text. A placeholder without a value throws: it is a bug in the template, found by its test.
 */
export function createTranslator(
  catalogues: Catalogues,
  locale: Locale,
  options: TranslatorOptions = {},
): Translate {
  return (key, vars = {}) => {
    let text = catalogues[locale][key];
    if (text === undefined) {
      text = catalogues[FALLBACK_LOCALE][key];
      if (text === undefined) throw new Error(`no message "${key}" in the English catalogue`);
      options.onFallback?.(key, locale);
    }
    return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, name: string) => {
      const value = vars[name];
      if (value === undefined) throw new Error(`message "${key}" needs the value "${name}"`);
      return oneLine(String(value));
    });
  };
}
