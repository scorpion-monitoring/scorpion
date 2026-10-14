// The API reference (ADR-0038) is a Scalar page that runs one script, the single-file build of
// `@scalar/api-reference`. This plugin ships that file from our own origin as a hashed, immutable asset;
// nothing of it is committed and nothing is fetched from a CDN. The package's `exports` do not offer the
// file, so it is found by the package's directory. The address is a constant of the build
// (`__SCALAR_ASSET__`, relative to the base path), the same in the server build, the client build and
// `pnpm dev`, where a middleware serves it.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const PACKAGE = '@scalar/api-reference';
const FILE = 'dist/browser/standalone.js';

/** Where the built file of the pinned package is, whatever the package manager's layout. */
export function scalarBundlePath(from: string): string {
  return resolve(realpathSync(resolve(from, 'node_modules', PACKAGE)), FILE);
}

/**
 * The file as it is served: the package's bytes without the trailing `sourceMappingURL` comment (the map
 * is not shipped, so a browser's developer tools would ask for a file that is not there).
 */
export function scalarBundle(source: string): string {
  return source.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
}

/** The address of the asset below the base path: the content hash makes it immutable. */
export function scalarAssetPath(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `/_app/immutable/scalar/api-reference.${hash}.js`;
}

export function scalarAsset(options: { root: string }): Plugin {
  const content = scalarBundle(readFileSync(scalarBundlePath(options.root), 'utf8'));
  const address = scalarAssetPath(content);
  return {
    name: 'scorpion-scalar-asset',
    config: () => ({ define: { __SCALAR_ASSET__: JSON.stringify(address) } }),
    // The client build of SvelteKit writes this file next to its own assets, where adapter-node serves
    // `_app/immutable/` with a one-year `immutable` cache.
    generateBundle() {
      if (this.environment.name !== 'client') return;
      this.emitFile({ type: 'asset', fileName: address.slice(1), source: content });
    },
    // `pnpm dev`: the front already took the base path off the request.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== address) return next();
        response.setHeader('content-type', 'text/javascript; charset=utf-8');
        response.setHeader('cache-control', 'no-cache');
        response.end(content);
      });
    },
  };
}
