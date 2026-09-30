import { describe, expect, it } from 'vitest';
import { closureOf, keep, type Project } from './image-tree.ts';

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
