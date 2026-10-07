// `{@html}` renders a string as HTML, so it may appear in one place only: ui-kit's SafeHtml, for text the
// server has sanitised (CLAUDE.md, security rules). The ESLint rule `svelte/no-at-html-tags` refuses
// it elsewhere; this scan also refuses a way around the rule (a disable comment).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../../..');

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'build', '.svelte-kit', 'dist'].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return /\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('{@html}', () => {
  const files = ['apps/web/src', 'packages/ui-kit/src', 'modules'].flatMap((dir) =>
    svelteFiles(join(repo, dir)),
  );

  it('is rendered by SafeHtml.svelte and nowhere else, and nobody switches the rule off but it', () => {
    const using = files
      .filter((file) => /\{@html\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repo, file));
    expect(using).toEqual(['packages/ui-kit/src/SafeHtml.svelte']);
    const disabling = files
      .filter((file) => /no-at-html-tags/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repo, file));
    expect(disabling).toEqual(['packages/ui-kit/src/SafeHtml.svelte']);
  });
});
