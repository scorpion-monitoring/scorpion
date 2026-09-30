import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    // Playwright specs in e2e/ are not Vitest tests.
    include: ['src/**/*.test.ts'],
  },
});
