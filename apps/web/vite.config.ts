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
  // `pnpm dev`: the web app is the public origin on PORT, as in an image; the API sits behind it.
  server: { host: '127.0.0.1', port: Number(process.env.PORT ?? 3000), strictPort: true },
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
          // The one inline style SvelteKit itself writes (the visually hidden live region of the route
          // announcer, root.svelte), allowed by its hash and nothing else. A change of SvelteKit that
          // alters it shows up as a policy violation in e2e/security-headers.spec.ts.
          'style-src-attr': [
            'unsafe-hashes',
            'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=',
          ],
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
