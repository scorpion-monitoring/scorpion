import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n.ts';

const catalogues = {
  en: { hello: 'Hello {name}', onlyEnglish: 'Only in English', twice: '{a} and {a}' },
  de: { hello: 'Hallo {name}', twice: '{a} und {a}' },
};

describe('createTranslator', () => {
  it('fills placeholders in the chosen language', () => {
    expect(createTranslator(catalogues, 'de')('hello', { name: 'Eva' })).toBe('Hallo Eva');
    expect(createTranslator(catalogues, 'en')('twice', { a: 'x' })).toBe('x and x');
  });

  it('falls back to English for a key the language lacks, and reports it', () => {
    const missing: string[] = [];
    const t = createTranslator(catalogues, 'de', { onFallback: (key) => missing.push(key) });
    expect(t('onlyEnglish')).toBe('Only in English');
    expect(missing).toEqual(['onlyEnglish']);
  });

  it('does not report a fallback when the language has the key', () => {
    const missing: string[] = [];
    createTranslator(catalogues, 'de', { onFallback: (key) => missing.push(key) })('hello', {
      name: 'x',
    });
    expect(missing).toEqual([]);
  });

  it('throws for a key that English lacks, and for a placeholder without a value', () => {
    const t = createTranslator(catalogues, 'en');
    expect(() => t('nope')).toThrow('no message "nope"');
    expect(() => t('hello')).toThrow('needs the value "name"');
  });

  it('cleans a value to one line, so a name cannot break a subject or add a mark', () => {
    const t = createTranslator(catalogues, 'en');
    expect(t('hello', { name: 'Eve\r\nBcc: x@example.org\u202E' })).toBe(
      'Hello Eve Bcc: x@example.org',
    );
  });

  it('does not expand a placeholder inside a value', () => {
    const t = createTranslator(catalogues, 'en');
    expect(t('hello', { name: '{name}' })).toBe('Hello {name}');
  });
});
