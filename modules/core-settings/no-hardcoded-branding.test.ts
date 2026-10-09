// CLAUDE.md rule 9 and FEATURES §3.3, §4.10: the instance name, product name, sender address and
// legal texts come from settings, not from code. This greps the source of `apps` and `modules` for
// the product and operator names the legacy app hard-coded and fails on a new one. Where a name is
// allowed it is listed below with the reason; the CLI command `scorpion`, package names and
// metric names are lower case and are not what this looks for.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..');
const SKIP = new Set(['node_modules', 'dist', 'build', '.svelte-kit', 'test-results', 'generated']);

/** The names that must not appear as text in code: the product, and the operators of the legacy deployment. */
export const FORBIDDEN = /Scorpion|de\.NBI|NFDI|Powered by/;

/** Files that may say it, and why. A new entry needs a reason a reviewer accepts. */
const ALLOWED: Record<string, string> = {
  'modules/core-settings/settings-schema.ts':
    'DEFAULT_PRODUCT_NAME: the one place that says what the software is called when nothing is configured',
  'modules/core-identity/service/password-words.ts':
    'PROJECT_WORDS: the documented list of words a password may not contain (ASVS 6.1.2). It is a security list, not branding that anybody is shown; the instance and product name of an installation come from getBranding',
};

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else if (/\.(ts|js|svelte|json|html|css)$/.test(name)) found.push(path);
  }
  return found;
}

/** Code lines only: comments say what a thing is for and may use the name. */
export function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
    .join('\n');
}

const sources = () =>
  ['apps', 'modules']
    .flatMap((root) => files(join(repo, root)))
    .filter((path) => !/\.test\.ts$/.test(path) && !/package\.json$/.test(path))
    .map((path) => relative(repo, path));

describe('no hard-coded branding (rule 9)', () => {
  it('scans the source of every module and app', () => {
    const scanned = sources();
    expect(scanned).toContain('modules/core-identity/service/mail-templates.ts');
    expect(scanned).toContain('apps/server/src/cli.ts');
    expect(scanned.length).toBeGreaterThan(80);
  });

  it.each([
    ['the product name', "const name = 'Scorpion';"],
    ['the legacy badge', '<span>Powered by</span>'],
    ['an operator', "subject: 'de.NBI service registry'"],
    ['the other operator', 'const org = "NFDI4Chem";'],
  ])('the pattern catches %s', (_name, line) => {
    expect(FORBIDDEN.test(codeOf(line))).toBe(true);
  });

  it.each([
    ['a comment', '// Scorpion is the product'],
    ['a block comment', '/* de.NBI */ const a = 1;'],
    ['the lower-case command', "usage: 'scorpion set-secret'"],
    ['a package name', "import x from '@scorpion/kernel';"],
  ])('the pattern ignores %s', (_name, line) => {
    expect(FORBIDDEN.test(codeOf(line))).toBe(false);
  });

  it('finds no product or operator name in code outside the allowed files', () => {
    const offenders = sources()
      .filter((path) => !(path in ALLOWED))
      .flatMap((path) =>
        codeOf(readFileSync(join(repo, path), 'utf8'))
          .split('\n')
          .map((line, index) => ({ path, line: index + 1, text: line.trim() }))
          .filter(({ text }) => FORBIDDEN.test(text)),
      )
      .map(({ path, line, text }) => `${path}:${line}: ${text.slice(0, 100)}`);
    expect(
      offenders,
      'branding comes from settings (core.settings getBranding), not from code',
    ).toEqual([]);
  });

  it('keeps the allow list honest: every entry still exists and still says the name', () => {
    for (const path of Object.keys(ALLOWED)) {
      const text = codeOf(readFileSync(join(repo, path), 'utf8'));
      expect(FORBIDDEN.test(text), `${path} no longer needs its entry`).toBe(true);
    }
  });
});
