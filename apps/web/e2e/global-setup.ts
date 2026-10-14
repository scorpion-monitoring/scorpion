import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startHarness } from './support/harness.ts';
import { startAll } from './support/stack.ts';

// Builds the web app (unless a build is asked to be kept), starts the stacks, and tells the workers
// where they are. The returned function stops everything.
export default async function globalSetup() {
  if (!process.env.E2E_KEEP_BUILD) {
    const build = spawnSync('pnpm', ['exec', 'vite', 'build'], {
      cwd: resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
    });
    if (build.status !== 0) throw new Error(`vite build failed:\n${build.stdout}\n${build.stderr}`);
  }
  // `E2E_STACKS`: only these stacks (names of `SPECS`, and `components` for the harness) start in this process.
  // Unset, everything starts, as in CI.
  const only = process.env.E2E_STACKS?.split(',').filter(Boolean);
  const harness = !only || only.includes('components') ? await startHarness() : undefined;
  // `E2E_COMPONENTS_ONLY=1`: only the component specs run (`--project components`), which need no database.
  if (process.env.E2E_COMPONENTS_ONLY) return () => harness?.stop() ?? Promise.resolve();
  const { stacks, stop } = await startAll(only);
  process.env.SCORPION_E2E_STACKS = JSON.stringify(
    stacks.map(({ name, basePath, origin, apiPort, databaseUrl }) => ({
      name,
      basePath,
      origin,
      apiPort,
      databaseUrl,
    })),
  );
  return async () => {
    await harness?.stop();
    await stop();
  };
}
