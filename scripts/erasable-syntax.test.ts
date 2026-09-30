import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// The server runs `.ts` through Node's type stripping, which cannot handle enums, namespaces or
// constructor parameter properties. `erasableSyntaxOnly` in tsconfig.base.json makes `tsc`
// (and so `pnpm check`) reject them. Each snippet is type-checked with the real base config.
const root = resolve(import.meta.dirname, '..');
const cache = join(root, 'node_modules/.cache/erasable-syntax');
mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(join(cache, 'run-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function typeCheck(name: string, source: string) {
  const file = join(dir, `${name}.ts`);
  writeFileSync(file, source);
  const project = join(dir, `${name}.tsconfig.json`);
  writeFileSync(
    project,
    JSON.stringify({
      extends: join(root, 'tsconfig.base.json'),
      compilerOptions: {
        noEmit: true,
        composite: false,
        incremental: false,
        declaration: false,
        emitDeclarationOnly: false,
      },
      files: [file],
    }),
  );
  return spawnSync('tsc', ['-p', project], { cwd: root, encoding: 'utf8' });
}

describe('erasableSyntaxOnly', () => {
  it('accepts erasable TypeScript', () => {
    const result = typeCheck('ok', 'export const stage = { draft: 1 } as const;\n');
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it.each([
    ['enum', 'export enum Stage {\n  Draft,\n}\n'],
    ['namespace', 'export namespace Stage {\n  export const draft = 1;\n}\n'],
    [
      'constructor parameter property',
      'export class Stage {\n  constructor(private readonly draft: number) {}\n}\n',
    ],
  ])('rejects %s', (name, source) => {
    const result = typeCheck(name.replaceAll(' ', '-'), source);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('TS1294');
  });
});
