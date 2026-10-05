// What every mail template must satisfy, so the modules that contribute templates (core.notifications,
// core.identity, later the registry) test the same rules and the rules live in one place. It knows
// the shape of a template entry structurally and imports no module (`packages/testing` cannot).

/** The strings an attacker would type into a name. The escape sequences are written out, never pasted. */
export const HOSTILE_STRINGS = {
  markup: '<script>alert(1)</script>',
  attribute: '"><img src=x onerror=alert(1)>',
  bidi: 'evil\u202Egnp.exe\u2066',
  lineBreak: 'Alice\r\nBcc: attacker@example.org',
  separators: 'Bob\u2028Subject: injected\u2029',
} as const;

export interface TemplateLike {
  key: string;
  catalogue: { en: Record<string, string>; de: Record<string, string> };
  render: (
    data: never,
    locale: 'en' | 'de',
    branding: never,
    options?: { onFallback?: (key: string) => void },
  ) => { subject: string; text: string; html: string };
}

export const LOCALES = ['en', 'de'] as const;

// eslint-disable-next-line no-control-regex
const HEADER_BREAKS = /[\u0000-\u001F\u007F\u2028\u2029]/;
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

/**
 * Problems with a template, as readable lines (empty when it is fine):
 *
 * - both languages have the same message keys, and rendering uses no English fallback;
 * - for every hostile string put into every free-text field (`make(text)` builds the data), the
 *   subject is one line with no bidirectional mark, the plain text has no bidirectional mark, and
 *   the HTML holds no raw markup of the string (no `<script`, no `<img`) and no bidirectional mark.
 */
export function templateProblems(
  entry: TemplateLike,
  make: (text: string) => unknown,
  branding: unknown,
): string[] {
  const problems: string[] = [];
  const en = Object.keys(entry.catalogue.en).sort();
  const de = Object.keys(entry.catalogue.de).sort();
  for (const key of en.filter((k) => !de.includes(k)))
    problems.push(`${entry.key}: "${key}" is missing in de`);
  for (const key of de.filter((k) => !en.includes(k)))
    problems.push(`${entry.key}: "${key}" is missing in en`);

  for (const locale of LOCALES) {
    const fallbacks: string[] = [];
    const strict = { onFallback: (key: string) => fallbacks.push(key) };
    entry.render(make('Example') as never, locale, branding as never, strict);
    if (fallbacks.length > 0) {
      problems.push(`${entry.key}/${locale}: fell back to English for ${fallbacks.join(', ')}`);
    }
    for (const [name, hostile] of Object.entries(HOSTILE_STRINGS)) {
      const label = `${entry.key}/${locale}/${name}`;
      const { subject, text, html } = entry.render(
        make(hostile) as never,
        locale,
        branding as never,
      );
      if (HEADER_BREAKS.test(subject))
        problems.push(`${label}: the subject has a line break or control character`);
      if (BIDI.test(subject)) problems.push(`${label}: the subject has a bidirectional mark`);
      if (BIDI.test(text)) problems.push(`${label}: the text has a bidirectional mark`);
      if (BIDI.test(html)) problems.push(`${label}: the HTML has a bidirectional mark`);
      if (/<script/i.test(html) || /<img src=x/i.test(html))
        problems.push(`${label}: the HTML has raw markup from the data`);
      // An attribute the data added: look for an `on…=` inside a real tag once quoted values are removed.
      if (/<[^>]*\son[a-z]+\s*=/i.test(html.replace(/"[^"]*"/g, '""'))) {
        problems.push(`${label}: the HTML has an injected attribute`);
      }
    }
  }
  return problems;
}
