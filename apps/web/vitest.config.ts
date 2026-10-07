import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Unit tests use the plain Svelte plugin: the SvelteKit plugin resolves its root from
// process.cwd() and breaks when Vitest runs from the repository root.
export default defineConfig({
  plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
  test: {
    // Playwright specs in e2e/ are not Vitest tests.
    include: ['src/**/*.test.ts'],
  },
});
