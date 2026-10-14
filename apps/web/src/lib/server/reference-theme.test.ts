import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE_PALETTES,
  referenceCss,
  scalarVariables,
  type ReferenceMode,
} from './reference-theme.ts';

const css = readFileSync(resolve(import.meta.dirname, '../../app.css'), 'utf8');

/** The `--color-*` lines of one DaisyUI theme block of app.css, by theme name. */
function themeColours(name: string): Record<string, string> {
  const block = css
    .split("@plugin 'daisyui/theme' {")
    .find((part) => part.trimStart().startsWith(`name: '${name}'`));
  if (!block) throw new Error(`app.css has no theme ${name}`);
  const colours: Record<string, string> = {};
  for (const [, key, value] of block
    .slice(0, block.indexOf('}'))
    .matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) {
    colours[key!] = value!;
  }
  return colours;
}

/** `--scorpion-muted` of the rule that opens with `selector`. */
function muted(selector: string): string {
  const rule = css.slice(css.indexOf(selector));
  const value = /--scorpion-muted:\s*(#[0-9a-f]{6});/.exec(rule.slice(0, rule.indexOf('}')))?.[1];
  if (!value) throw new Error(`app.css has no --scorpion-muted in ${selector}`);
  return value;
}

describe('the colours of the API reference', () => {
  const themes: [ReferenceMode, string, string][] = [
    ['light', 'scorpionlight', ":root,\n:root[data-theme='scorpionlight'] {"],
    ['dark', 'scorpiondark', ":root[data-theme='scorpiondark'] {"],
  ];

  it.each(themes)('%s: the palette is the shell theme in app.css', (mode, theme, selector) => {
    const colours = themeColours(theme);
    const { muted: reference, ...palette } = REFERENCE_PALETTES[mode];
    expect(reference).toBe(muted(selector));
    for (const [name, value] of Object.entries(palette)) {
      expect(colours[name], `--color-${name} of ${theme}`).toBe(value);
    }
  });

  it('hands every variable to Scalar under both of its mode classes', () => {
    const output = referenceCss();
    expect(output).toContain('html body.light-mode {');
    expect(output).toContain('html body.dark-mode {');
    for (const mode of ['light', 'dark'] as const) {
      for (const [name, value] of Object.entries(scalarVariables(mode))) {
        expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
        expect(output).toContain(`${name}: ${value};`);
      }
    }
  });
});
