import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';

// One Vitest run over every workspace package. Each project is named after its package, so
// `pnpm test --filter @scorpion/<name>` selects it (see scripts/test.ts).
const roots = ['apps', 'packages', 'modules', 'tools'];
const extraProjects = ['profiles'];

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
  // A package with its own Vite config (apps/web: SvelteKit plugin) is loaded from its directory,
  // so the config runs with the right root. Vitest then names it after package.json too.
  if (readdirSync(dir).some((file) => CONFIG_FILE.test(file))) return dir;
  const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string };
  return { test: { name, root: resolve(dir) } };
}

export default defineConfig({
  test: {
    projects: [
      ...packageDirs().map(project),
      // Repository scripts (branch policy, changeset check) are not a package.
      { test: { name: 'scripts', root: resolve('scripts') } },
    ],
    passWithNoTests: true,
  },
});
