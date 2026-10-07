import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closureOf, copyWeb, hasWebBuild, keep, type Project } from './image-tree.ts';

const project = (name: string, ...dependencies: string[]): Project => ({
  name,
  path: `/repo/${name}`,
  dependencies,
});

describe('closureOf', () => {
  const projects = [
    project('@scorpion/server', '@scorpion/kernel', '@scorpion/mod-a', 'hono'),
    project('@scorpion/kernel', '@scorpion/contracts'),
    project('@scorpion/contracts'),
    project('@scorpion/mod-a', '@scorpion/mod-b', '@scorpion/kernel'),
    project('@scorpion/mod-b'),
    project('@scorpion/mod-c'), // in the workspace, in nobody's dependencies
    project('@scorpion/testing'),
  ];

  it('follows dependencies from the start, once each, and leaves the rest out', () => {
    expect(closureOf('@scorpion/server', projects).map((p) => p.name)).toEqual([
      '@scorpion/server',
      '@scorpion/kernel',
      '@scorpion/contracts',
      '@scorpion/mod-a',
      '@scorpion/mod-b',
    ]);
  });

  it('ignores names that are not workspace projects', () => {
    expect(closureOf('@scorpion/mod-b', projects).map((p) => p.name)).toEqual(['@scorpion/mod-b']);
  });

  it('survives a cycle', () => {
    const cyclic = [project('a', 'b'), project('b', 'a')];
    expect(closureOf('a', cyclic).map((p) => p.name)).toEqual(['a', 'b']);
  });
});

describe('keep', () => {
  const dir = '/repo/packages/kernel';
  it.each([
    ['/repo/packages/kernel', true],
    ['/repo/packages/kernel/src/index.ts', true],
    ['/repo/packages/kernel/migrations/0000_x.sql', true],
    ['/repo/packages/kernel/node_modules/zod', true],
    ['/repo/packages/kernel/test', false],
    ['/repo/packages/kernel/test/fixtures/x.ts', false],
    ['/repo/packages/kernel/e2e/smoke.spec.ts', false],
    ['/repo/packages/kernel/src/db.test.ts', false],
    ['/repo/packages/kernel/vitest.config.ts', false],
    ['/repo/packages/kernel/src/test-utils.ts', true],
  ])('%s → %s', (file, expected) => {
    expect(keep(dir, file)).toBe(expected);
  });
});

describe('copyWeb', () => {
  const make = () => {
    const root = mkdtempSync(join(tmpdir(), 'image-tree-'));
    const write = (file: string, text = 'x') => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    write('apps/web/package.json', '{"name":"@scorpion/web"}');
    write('apps/web/build/handler.js');
    write('apps/web/build/client/_app/x.js');
    write('apps/web/src/front/front.ts');
    write('apps/web/src/front/front.test.ts');
    write('apps/web/src/lib/page.ts'); // the source of the pages is in the build
    write('apps/web/e2e/shell.spec.ts');
    write('apps/web/.svelte-kit/output/x.js');
    write('scripts/image-run.ts');
    return {
      root,
      out: join(root, 'out'),
      exists: (file: string) => existsSync(join(root, 'out', file)),
    };
  };

  it('copies the build, the front and image-run.ts, and nothing else of the web app', () => {
    const { root, out, exists } = make();
    expect(hasWebBuild(root)).toBe(true);
    copyWeb(root, out);
    expect(exists('apps/web/package.json')).toBe(true);
    expect(exists('apps/web/build/handler.js')).toBe(true);
    expect(exists('apps/web/build/client/_app/x.js')).toBe(true);
    expect(exists('apps/web/src/front/front.ts')).toBe(true);
    expect(exists('scripts/image-run.ts')).toBe(true);
    expect(exists('apps/web/src/front/front.test.ts')).toBe(false);
    expect(exists('apps/web/src/lib/page.ts')).toBe(false);
    expect(exists('apps/web/e2e')).toBe(false);
    expect(exists('apps/web/.svelte-kit')).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('knows that a profile without the shell has no web build', () => {
    const root = mkdtempSync(join(tmpdir(), 'image-tree-'));
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    expect(hasWebBuild(root)).toBe(false);
    rmSync(root, { recursive: true });
  });
});
