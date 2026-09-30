import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';

// One Vitest run over every workspace package. Each project is named after its package, so
// `pnpm test --filter @scorpion/<name>` selects it (see scripts/test.ts).
const roots = ['apps', 'packages', 'modules'];
const extraProjects = ['profiles', 'tools'];

function packageDirs(): string[] {
  const dirs = roots.flatMap((root) =>
    existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(root, entry.name))
      : [],
  );
  return [...dirs, ...extraProjects].filter((dir) => existsSync(join(dir, 'package.json')));
}

const CONFIG_FILE = /^vite(st)?\.config\.[cm]?[jt]s$/;

function project(dir: string): TestProjectConfiguration {
  const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string };
  const config = readdirSync(dir).find((file) => CONFIG_FILE.test(file));
  // A package with its own Vite config (apps/web: SvelteKit plugin) keeps it; the rest run as
  // plain Node projects.
  const test = { name, root: resolve(dir) };
  return config ? { extends: resolve(dir, config), test } : { test };
}

export default defineConfig({
  test: {
    projects: packageDirs().map(project),
    passWithNoTests: true,
  },
});
