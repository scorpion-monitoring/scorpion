// Defect 12 (FEATURES §5): the legacy loaders returned a `Response(400)` for a missing token instead of
// throwing, so the visitor got a blank page with a status. Here a loader that cannot get its data
// throws, and the shell turns it into the error page with that status (the browser side is
// e2e/legal.spec.ts). Two things keep it so: the lint rule that bans `new Response` and `json()` in
// loader code (tools/eslint-plugin/test/ui-rules.test.ts), and this scan of the sources.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../../..');

function sources(dir: string, test: (file: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'build' || name === '.svelte-kit') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path, test) : test(path) ? [path] : [];
  });
}

const isLoaderCode = (file: string) =>
  !file.endsWith('.test.ts') &&
  (/\/routes\/.*\/\+(page|layout)[^/]*\.ts$/.test(file) ||
    /\/routes\/\+(page|layout)[^/]*\.ts$/.test(file) ||
    /\/lib\/server\/.*\.ts$/.test(file) ||
    /modules\/[^/]+\/ui\/.*\.ts$/.test(file));

describe('the loaders of the web app and of the modules', () => {
  const files = [
    ...sources(join(repo, 'apps/web/src'), isLoaderCode),
    ...sources(join(repo, 'modules'), isLoaderCode),
  ];

  it('are found, so the scan below is not empty', () => {
    const names = files.map((file) => relative(repo, file));
    expect(names).toContain('apps/web/src/routes/[...path]/+page.server.ts');
    expect(names).toContain('apps/web/src/lib/server/page.ts');
    expect(names).toContain('modules/core-ui-shell/ui/legal.ts');
  });

  it('never build a Response and never import json()', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, relative(repo, file)).not.toMatch(/new Response\(/);
      expect(text, relative(repo, file)).not.toMatch(/Response\.json\(/);
      expect(text, relative(repo, file)).not.toMatch(
        /import\s*\{[^}]*\bjson\b[^}]*\}\s*from\s*'@sveltejs\/kit'/,
      );
    }
  });
});
