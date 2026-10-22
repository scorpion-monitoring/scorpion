// Nothing outside `src/dashboard-grid/` imports Snapgrid or dnd-kit (ADR-0042, Decision 2): the library is one
// directory away from being replaced. ESLint (`no-restricted-imports`) says so while editing; this test says so in
// CI and also covers what the linter does not read (the page's `package.json` files, the loader's dynamic import).
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../../../..');
const LIBRARY = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:@snapgridjs|@dnd-kit)\//;

const sources = globSync('{apps,packages,modules,tools}/**/*.{ts,svelte,js,mjs}', {
  cwd: repo,
  exclude: (name) => ['node_modules', 'dist', 'build', '.svelte-kit', 'generated'].includes(name),
});

describe('the grid library boundary', () => {
  it('finds the sources', () => {
    expect(sources.length).toBeGreaterThan(500);
  });

  it('is imported only inside packages/ui-kit/src/dashboard-grid', () => {
    const offenders = sources
      .filter((file) => !file.startsWith('packages/ui-kit/src/dashboard-grid/'))
      .filter((file) => LIBRARY.test(readFileSync(resolve(repo, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is imported there (the check itself finds an import)', () => {
    const inside = sources
      .filter((file) => file.startsWith('packages/ui-kit/src/dashboard-grid/'))
      .filter((file) => LIBRARY.test(readFileSync(resolve(repo, file), 'utf8')));
    expect(inside.length).toBeGreaterThanOrEqual(3);
  });

  it('is a dependency of ui-kit alone', () => {
    const manifests = globSync('{apps,packages,modules,tools}/*/package.json', { cwd: repo });
    const users = manifests.filter((file) =>
      /"@(?:snapgridjs|dnd-kit)\//.test(readFileSync(resolve(repo, file), 'utf8')),
    );
    expect(users).toEqual(['packages/ui-kit/package.json']);
  });
});
