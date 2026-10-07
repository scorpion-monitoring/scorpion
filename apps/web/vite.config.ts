import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { scorpionFront } from './src/front/vite-plugin.ts';

// SvelteKit 3 no longer reads svelte.config.js; its options go to the plugin.
//
// `paths.base` stays empty and paths are relative: the front (src/front) takes BASE_PATH off every
// request, so one build serves any prefix (ADR-0027). `BASE_PATH` and `API_ORIGIN` are read when the
// process starts, never at build time.
export default defineConfig({
  plugins: [
    scorpionFront({
      basePath: process.env.BASE_PATH ?? '/',
      apiOrigin: process.env.API_ORIGIN ?? 'http://127.0.0.1:3000',
    }),
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      preprocess: vitePreprocess(),
      paths: { relative: true },
      // CSP with nonces: SvelteKit adds them to its own inline script and style tags. No 'unsafe-inline'.
      csp: {
        mode: 'nonce',
        directives: {
          'default-src': ['none'],
          'script-src': ['self'],
          'style-src': ['self'],
          'img-src': ['self', 'data:'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'manifest-src': ['self'],
          'base-uri': ['none'],
          'form-action': ['self'],
          'frame-ancestors': ['none'],
          'object-src': ['none'],
        },
      },
    }),
  ],
});
