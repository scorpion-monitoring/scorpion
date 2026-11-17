import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEME_COLORS, COLOR_TOKENS } from '@scorpion/contracts/theme-colors';

// The contrast check of the theme colours (M12a sprint 4) measures an unset token by its built-in value, which app.css defines. The copy
// in `@scorpion/contracts/theme-colors` must be the same, token for token, or the server would accept a set the page draws differently.
const css = readFileSync(resolve(import.meta.dirname, 'app.css'), 'utf8');

function themeColours(name: string): Record<string, string> {
  const block = css
    .split("@plugin 'daisyui/theme' {")
    .find((part) => part.trimStart().startsWith(`name: '${name}'`));
  if (!block) throw new Error(`app.css has no theme ${name}`);
  return Object.fromEntries(
    [
      ...block.slice(0, block.indexOf('}')).matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6});/g),
    ].map(([, key, value]) => [key!, value!]),
  );
}

describe('the built-in theme colours', () => {
  it.each([
    ['light', 'scorpionlight'],
    ['dark', 'scorpiondark'],
  ] as const)('%s is %s of app.css, every token', (mode, theme) => {
    const colours = themeColours(theme);
    expect(Object.keys(colours).sort()).toEqual([...COLOR_TOKENS].sort());
    expect(colours).toEqual(BUILT_IN_THEME_COLORS[mode]);
  });
});
