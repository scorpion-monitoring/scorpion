import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// M12a sprint 4: an administrator sets the colours of both themes (ADR-0051), so everything the components draw takes its colour from the
// daisyUI tokens (`text-primary`, `bg-base-200`, `badge-success`, `currentColor` under such a class, `var(--color-…)`). A fixed colour
// would ignore a custom set and could fail its contrast. This test fails for one in the pages of the modules and in ui-kit.
const repo = resolve(import.meta.dirname, '../../..');

/** The palette definition: `themeFromElement` reads the theme's variables; its literals are fallbacks for a page with no theme and the canvas probe. */
const ALLOWED = new Set(['packages/ui-kit/src/chart.ts']);

const HEX = /(?:^|[^&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch|color-mix)\(/;
/** Tailwind's own palette (not a daisyUI token), in any utility that takes a colour, with or without an opacity. */
const PALETTE_CLASS =
  /(?:^|[\s"'`:{])(?:[a-z-]+:)*(?:text|bg|border(?:-[trblxyse])?|fill|stroke|ring|ring-offset|outline|from|via|to|decoration|shadow|divide|accent|caret|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/;
/** A colour written into an SVG or HTML attribute; `none`, `currentColor` and an expression (`{colors.primary}`) are fine. */
const ATTRIBUTE =
  /\b(?:fill|stroke|stop-color|flood-color|lighting-color|color)=["'](?!none\b|currentColor\b|transparent\b|inherit\b|url\()[^"'{]/;
/** A named colour in CSS (a `.css` file or a `<style>` block): `color: red`. Variables and keywords are fine. */
const CSS_VALUE =
  /\b(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color|caret-color|accent-color)\s*:\s*(?!var\(|inherit\b|currentColor\b|transparent\b|none\b|initial\b|unset\b)[a-z]/;

const comment = (line: string) => /^(?:\/\/|\*|\/\*|<!--)/.test(line);

/** The fixed colours of a file, as `line: text`. CSS rules apply to `.css` files and to the `<style>` blocks of a component. */
export function hardCodedColours(source: string, kind: 'svelte' | 'ts' | 'css'): string[] {
  let inStyle = kind === 'css';
  return source.split('\n').flatMap((raw, index) => {
    // A fragment link (`href="#add"`) is not a colour.
    const line = raw.trim().replace(/href=(["'])#[^"']*\1/g, 'href=""');
    if (kind === 'svelte' && line.startsWith('<style')) inStyle = true;
    if (kind === 'svelte' && line.startsWith('</style')) inStyle = false;
    if (line === '' || comment(line)) return [];
    const found =
      HEX.test(line) ||
      FUNCTION.test(line) ||
      PALETTE_CLASS.test(line) ||
      (kind === 'svelte' && ATTRIBUTE.test(line)) ||
      (inStyle && CSS_VALUE.test(line));
    return found ? [`${index + 1}: ${line}`] : [];
  });
}

describe('the rule', () => {
  it.each([
    ['ts', "const ink = '#1f2937';"],
    ['ts', "context.fillStyle = 'rgb(0, 0, 0)';"],
    ['svelte', '<p class="text-red-500">x</p>'],
    ['svelte', '<div class="bg-white">x</div>'],
    ['svelte', '<div class="fixed inset-0 bg-black/40">x</div>'],
    ['svelte', '<div class="hover:border-sky-300">x</div>'],
    ['svelte', '<path fill="#00e5ff" />'],
    ['svelte', '<circle stroke="red" />'],
    ['svelte', '<div class="bg-[#fafafa]">x</div>'],
    ['svelte', '<style>\n  .x { color: red; }\n</style>'],
    ['css', '.x { background: oklch(70% 0.1 200); }'],
    ['css', '.x { border-color: white; }'],
  ] as const)('finds a fixed colour in %s: %s', (kind, source) => {
    expect(hardCodedColours(source, kind)).not.toEqual([]);
  });

  it.each([
    ['svelte', '<p class="text-primary text-error badge badge-success bg-base-200/50">x</p>'],
    ['svelte', '<path fill="none" stroke="currentColor" />'],
    ['svelte', '<rect fill={colors.primary} />'],
    ['svelte', '<a href="#main">Skip</a>'],
    ['svelte', '<a href="#add">Add</a> &#160;'],
    ['svelte', '<div class="border-base-content/50 outline-primary">x</div>'],
    ['ts', 'color: theme.text,'],
    ['ts', '// a comment that names #ffffff'],
    ['css', '.x { color: var(--scorpion-muted); outline: 2px solid var(--color-primary); }'],
    ['svelte', '<style>\n  .x { visibility: hidden; opacity: 0; }\n</style>'],
  ] as const)('lets a token through in %s: %s', (kind, source) => {
    expect(hardCodedColours(source, kind)).toEqual([]);
  });
});

describe('the pages of the modules and ui-kit', () => {
  const files = [
    ...globSync('modules/*/ui/**/*.{svelte,ts,css}', { cwd: repo }),
    ...globSync('packages/ui-kit/src/**/*.{svelte,ts,css}', { cwd: repo }),
  ]
    .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.d.ts') && !ALLOWED.has(file))
    .sort();

  it('are found', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files)('%s draws colour from the theme tokens only', (file) => {
    const kind = file.endsWith('.svelte') ? 'svelte' : file.endsWith('.css') ? 'css' : 'ts';
    expect(hardCodedColours(readFileSync(resolve(repo, file), 'utf8'), kind)).toEqual([]);
  });
});
