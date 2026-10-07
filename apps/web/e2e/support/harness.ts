// The page the component specs run against: a small Vite app (`e2e/components/harness`) that mounts one
// scene of the shared components inside a stand-in for the shell, built and served as a static site. No API,
// no database. The same `ui-kit` source runs here as in the web app, with the policy of the application's
// Content-Security-Policy in a meta tag, so a component that needs an inline style or script fails here.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { build, preview } from 'vite';

export const HARNESS_PORT = 4190;
const root = resolve(import.meta.dirname, '../components/harness');

export async function startHarness(): Promise<{ origin: string; stop: () => Promise<void> }> {
  const outDir = mkdtempSync(resolve(tmpdir(), 'scorpion-harness-'));
  const plugins = [tailwindcss(), svelte({ configFile: false, preprocess: vitePreprocess() })];
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    plugins,
    base: '/',
    build: { outDir, emptyOutDir: true, target: 'es2022' },
  });
  const server = await preview({
    root,
    configFile: false,
    logLevel: 'warn',
    plugins,
    build: { outDir },
    preview: { host: '127.0.0.1', port: HARNESS_PORT, strictPort: true },
  });
  return {
    origin: `http://127.0.0.1:${HARNESS_PORT}`,
    stop: async () => {
      await server.close();
      rmSync(outDir, { recursive: true, force: true });
    },
  };
}
