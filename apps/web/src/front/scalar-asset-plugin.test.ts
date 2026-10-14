import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  scalarAsset,
  scalarAssetPath,
  scalarBundle,
  scalarBundlePath,
} from './scalar-asset-plugin.ts';

const root = resolve(import.meta.dirname, '../..');

describe('the asset of the API reference', () => {
  it('drops the comment that points at a map nobody ships, and nothing else', () => {
    expect(scalarBundle('a();\n//# sourceMappingURL=standalone.js.map\n')).toBe('a();\n');
    expect(scalarBundle('a();\n//# sourceMappingURL=standalone.js.map')).toBe('a();\n');
    expect(scalarBundle('a();\n// a comment\n')).toBe('a();\n// a comment\n');
  });

  it('is addressed by its content: the same bytes the same name, other bytes another', () => {
    const address = scalarAssetPath('one');
    expect(address).toMatch(/^\/_app\/immutable\/scalar\/api-reference\.[0-9a-f]{12}\.js$/);
    expect(scalarAssetPath('one')).toBe(address);
    expect(scalarAssetPath('two')).not.toBe(address);
  });

  it('is the single-file build of the pinned package, found by its directory', () => {
    const file = scalarBundlePath(root);
    expect(file.endsWith('/dist/browser/standalone.js')).toBe(true);
    const source = readFileSync(file, 'utf8');
    // The build that registers `window.Scalar`, the one the wrapper loads with a nonce.
    expect(source).toContain('createApiReference');
    const pinned = JSON.parse(readFileSync(resolve(file, '../../../package.json'), 'utf8')) as {
      version: string;
    };
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies['@scalar/api-reference']).toBe(pinned.version);
  });

  it('is pinned exactly, with its wrapper, in the manifest', () => {
    // Both are development dependencies: Vite bundles the wrapper into the server build, so the image carries the
    // one script and none of the packages (ADR-0038).
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.dependencies).not.toHaveProperty(['@scalar/sveltekit']);
    for (const version of [
      manifest.devDependencies['@scalar/sveltekit'],
      manifest.devDependencies['@scalar/api-reference'],
    ]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('tells the build the address, and emits the file only in the client build', () => {
    const plugin = scalarAsset({ root });
    const config = (plugin.config as () => { define: Record<string, string> })();
    const address = JSON.parse(config.define.__SCALAR_ASSET__!) as string;
    expect(address).toMatch(/^\/_app\/immutable\/scalar\/api-reference\.[0-9a-f]{12}\.js$/);

    const emitted: { fileName: string; source: string }[] = [];
    const generate = plugin.generateBundle as (this: unknown) => void;
    const context = (name: string) => ({
      environment: { name },
      emitFile: (file: { fileName: string; source: string }) => emitted.push(file),
    });
    generate.call(context('ssr'));
    expect(emitted).toEqual([]);
    generate.call(context('client'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.fileName).toBe(address.slice(1));
    expect(emitted[0]!.source).not.toContain('sourceMappingURL');
  });
});
