// `pnpm dev`: the same front as in production, as Vite middleware, so the browser sees one origin and
// `BASE_PATH` works the way it does in an image (ADR-0027).
import type { Plugin } from 'vite';
import { createFront } from './front.ts';

export function scorpionFront(options: { basePath: string; apiOrigin: string }): Plugin {
  return {
    name: 'scorpion-front',
    configureServer(server) {
      // Added first, so it runs before Vite's own handling: Vite then sees paths without the base.
      server.middlewares.use((request, response, next) => {
        createFront({
          ...options,
          next: () => next(),
        })(request, response);
      });
    },
  };
}
