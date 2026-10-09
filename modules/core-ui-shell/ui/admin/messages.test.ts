// The texts of the administration pages: every key a page uses exists in English and German (a key with
// plural forms has both forms in both languages), and the two languages have the same keys.
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import { adminMessages } from './messages.ts';

const here = import.meta.dirname;
const keysUsed = (): string[] => {
  const used = new Set<string>();
  for (const file of globSync('*.svelte', { cwd: here })) {
    const source = readFileSync(resolve(here, file), 'utf8');
    // Every string literal that looks like a key of the catalogue, wherever it is written (also in a conditional).
    for (const match of source.matchAll(/['`"]((?:admin|nav)\.[A-Za-z0-9.]*[A-Za-z0-9])['`"]/g)) {
      used.add(match[1]!);
    }
  }
  return [...used].sort();
};

const defined = (locale: string) => {
  const keys = new Set(Object.keys(adminMessages[locale] ?? {}));
  // `x.one` and `x.other` define `x`.
  for (const key of [...keys]) {
    if (/\.(one|other)$/.test(key)) keys.add(key.replace(/\.(one|other)$/, ''));
  }
  return keys;
};

describe('the texts of the administration pages', () => {
  it('are complete in both languages, with the same placeholders', () => {
    expect(catalogueProblems(adminMessages)).toEqual([]);
  });

  it.each(['en', 'de'])('have every key the pages use in %s', (locale) => {
    const known = defined(locale);
    // Keys built from a variable (`admin.settings.area.${name}`) are checked by listing the ones that are built.
    const built = ['branding', 'secrets', 'vocabularies'].flatMap((name) => [
      `admin.settings.area.${name}`,
      `admin.settings.area.${name}.lead`,
    ]);
    const missing = [...keysUsed(), ...built].filter((key) => !known.has(key));
    // Texts of the other modules and of the shell itself are not defined here.
    expect(
      missing.filter(
        (key) => !/^(nav\.(section|admin)\.|admin\.settings\.module\.)/.test(key) || known.has(key),
      ),
    ).toEqual([]);
  });

  it('find plenty of keys, so the check is not empty', () => {
    expect(keysUsed().length).toBeGreaterThan(60);
  });
});
