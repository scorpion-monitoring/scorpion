import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The page's policy allows no inline style (`style-src-attr` lists one hash, for the route announcer). A `style="..."` attribute or a
// `style:prop` directive on an element sets one and is refused in the browser, which only an e2e test with the policy on would show. A
// component uses a class instead. The two files of the dashboard grid pass the styles their library computes, which the grid's own
// tests and the policy test of the e2e suite cover.
const repo = resolve(import.meta.dirname, '../../..');
const ALLOWED = new Set([
  'packages/ui-kit/src/dashboard-grid/Tile.svelte',
  'packages/ui-kit/src/dashboard-grid/Surface.svelte',
]);

describe('the components', () => {
  const files = [
    ...globSync('apps/web/src/**/*.svelte', { cwd: repo }),
    ...globSync('packages/ui-kit/src/**/*.svelte', { cwd: repo }),
    ...globSync('modules/*/ui/**/*.svelte', { cwd: repo }),
  ]
    .filter((file) => !ALLOWED.has(file))
    .sort();

  it('are found', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s sets no inline style', (file) => {
    const lines = readFileSync(resolve(repo, file), 'utf8').split('\n');
    const found = lines
      .map((text, index) => ({ line: index + 1, text: text.trim() }))
      .filter(({ text }) => /(^|\s)style[:=]/.test(text) && !text.startsWith('//'));
    expect(found.map(({ line, text }) => `${file}:${line} ${text}`)).toEqual([]);
  });
});
