// `docShot()` (issue #134): the names of the pictures, the viewport, and the rule that a slug is used once per journey.
// The helper itself needs a browser and runs in the journey specs when `DOC_SHOTS=1` (CI job "Doc screenshots").
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_SHOT_SCHEMES, DOC_SHOT_VIEWPORT, docShotFile } from '../e2e/support/doc-shot-names.ts';

describe('docShotFile', () => {
  it.each([
    ['j06', 1, 'wizard-basics', 'light', 'j06/01-wizard-basics.light.png'],
    ['j06', 1, 'wizard-basics', 'dark', 'j06/01-wizard-basics.dark.png'],
    ['j12', 12, 'export-menu', 'light', 'j12/12-export-menu.light.png'],
    ['j01', 99, 'a', 'dark', 'j01/99-a.dark.png'],
  ] as const)('%s #%i %s %s is %s', (journey, number, slug, scheme, expected) => {
    expect(docShotFile(journey, number, slug, scheme)).toBe(expected);
  });

  it.each([
    ['a journey that is no id', ['6', 1, 'a']],
    ['a journey with a capital', ['J06', 1, 'a']],
    ['a slug with a capital', ['j06', 1, 'Wizard']],
    ['a slug with a space', ['j06', 1, 'two words']],
    ['a slug with a slash, which could leave the folder', ['j06', 1, '../x']],
    ['the number 0', ['j06', 0, 'a']],
    ['the number 100', ['j06', 100, 'a']],
    ['a number that is no integer', ['j06', 1.5, 'a']],
  ] as const)('refuses %s', (_name, [journey, number, slug]) => {
    expect(() => docShotFile(journey, number, slug, 'light')).toThrow(/docShot/);
  });
});

describe('the pictures', () => {
  it('are taken in the light and the dark theme at 1280 x 800', () => {
    expect(DOC_SHOT_SCHEMES).toEqual(['light', 'dark']);
    expect(DOC_SHOT_VIEWPORT).toEqual({ width: 1280, height: 800 });
  });

  it('are asked for with one slug per journey and a name that is a plain literal', () => {
    const dir = resolve(import.meta.dirname, '../e2e/journeys');
    const problems: string[] = [];
    let calls = 0;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.spec.ts'))) {
      const id = /^(j\d{2})-/.exec(file)![1]!;
      const text = readFileSync(resolve(dir, file), 'utf8');
      const total = [...text.matchAll(/\bdocShot\(/g)].length;
      const literal = [...text.matchAll(/\bdocShot\(\s*page\s*,\s*'(j\d{2})'\s*,\s*'([^']*)'/g)];
      calls += literal.length;
      if (literal.length !== total)
        problems.push(`${file}: a docShot call that is not (page, 'jNN', 'slug')`);
      const seen = new Set<string>();
      for (const [, journey, slug] of literal) {
        if (journey !== id) problems.push(`${file}: docShot names the journey ${journey}`);
        if (seen.has(slug!)) problems.push(`${file}: the slug ${slug} is used twice`);
        seen.add(slug!);
        try {
          docShotFile(journey!, 1, slug!, 'light');
        } catch (error) {
          problems.push(`${file}: ${(error as Error).message}`);
        }
      }
    }
    expect(problems).toEqual([]);
    // Sparingly: the screens that the text does not make obvious, not every step.
    expect(calls).toBeGreaterThan(5);
    expect(calls).toBeLessThan(40);
  });
});
