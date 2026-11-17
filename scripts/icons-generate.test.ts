import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iconShapes } from '../packages/contracts/src/icons.ts';
import { ICONS, pathData, render } from './icons-generate.ts';

const root = resolve(import.meta.dirname, '..');

describe('pathData', () => {
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const BOX = '<path stroke="none" d="M0 0h24v24H0z" fill="none" />';
  const cases: [string, string, string][] = [
    ['one path', svg(`${BOX}<path d="M5 12l14 0" />`), 'M5 12l14 0'],
    [
      'two paths are joined, the box is left out',
      svg(`${BOX}<path d="M1 1" /><path d="M2 2" />`),
      'M1 1 M2 2',
    ],
    ['attributes in another order', svg('<path fill="none" d="M3 3h4"/>'), 'M3 3h4'],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(pathData(input, 'x')).toBe(expected);
  });

  it('refuses an icon with a shape that is not a path, so nothing is dropped silently', () => {
    expect(() => pathData(svg('<circle cx="1" cy="1" r="1" />'), 'round')).toThrow(/circle/);
  });

  it('refuses an icon with no path', () => {
    expect(() => pathData(svg(BOX), 'empty')).toThrow(/no path/);
  });
});

describe('the generated table', () => {
  it('is what the script writes from the Tabler files (pnpm check runs the same comparison)', () => {
    const dir = join(root, 'node_modules/@tabler/icons/icons/outline');
    const text = render((file) => readFileSync(join(dir, `${file}.svg`), 'utf8'));
    expect(readFileSync(join(root, 'packages/contracts/src/icons.ts'), 'utf8')).toBe(text);
  });

  it('has exactly the names the script lists, and every one draws something', () => {
    expect(Object.keys(iconShapes).sort()).toEqual(Object.keys(ICONS).sort());
    for (const [name, d] of Object.entries(iconShapes)) expect(d.length, name).toBeGreaterThan(5);
  });

  it('draws the settings icon as a gear, not as the rays of the sun (the bug of the old table)', () => {
    expect(iconShapes.cog).not.toBe(iconShapes.sun);
    expect(ICONS.cog).toBe('settings');
    // A gear is one closed outline with arcs; the old drawing was a circle and eight straight rays.
    expect(iconShapes.cog).toMatch(/a1\.724/);
    expect(iconShapes.cog).not.toMatch(/M12 3v2\.5/);
  });
});

describe('no hand-drawn icon', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      if (['node_modules', 'dist', '.svelte-kit', 'build'].includes(entry)) return [];
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.svelte') ? [full] : [];
    });

  it('keeps every <path> of the interface in the two Icon components or in a chart', () => {
    // The Icon components draw the table; the sparkline draws data, not an icon.
    const allowed = new Set([
      'apps/web/src/lib/components/Icon.svelte',
      'packages/ui-kit/src/Icon.svelte',
      'modules/kpi-analytics/ui/Sparkline.svelte',
    ]);
    const offenders = ['modules', 'packages', 'apps/web/src']
      .flatMap((dir) => walk(join(root, dir)))
      .filter((file) => /<path\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
      .filter((file) => !allowed.has(file));
    expect(offenders).toEqual([]);
  });
});
