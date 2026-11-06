import { readFileSync } from 'node:fs';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Unit tests use the plain Svelte plugin: the SvelteKit plugin resolves its root from
// process.cwd() and breaks when Vitest runs from the repository root.
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __SCORPION_VERSION__: JSON.stringify(version) },
  plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
  test: {
    // Playwright specs in e2e/ are not Vitest tests.
    include: ['src/**/*.test.ts'],
  },
});
