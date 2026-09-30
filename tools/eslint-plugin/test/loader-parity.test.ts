// The boundaries rule and the loader read dependencies from the same place (ADR 0002). This test
// feeds both the same fixture modules and checks that they agree: what the rule accepts as an
// import is exactly what the loader wires as a dependency.
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { KernelStartupError, resolveProfile } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import {
  allFixtureSources,
  FIXTURE_MODULE_PACKAGES,
  fixtureProfile,
  MODULES_DIR,
} from '../../../packages/kernel/test/fixtures/index.ts';
import plugin from '../src/index.js';

const repoRoot = join(import.meta.dirname, '../../..');
const packageNames = Object.values(FIXTURE_MODULE_PACKAGES);

const eslint = new ESLint({
  cwd: repoRoot,
  ignore: false,
  overrideConfigFile: true,
  overrideConfig: {
    files: ['**/*.js'],
    plugins: { '@scorpion': plugin },
    rules: { '@scorpion/module-boundaries': ['error', { moduleRoots: [MODULES_DIR] }] },
  },
});

/** The module packages a file inside `directory` may import, according to the lint rule. */
async function acceptedByLint(directory: string): Promise<string[]> {
  const importable = packageNames.filter((name) => name !== `@scorpion/${directory}`);
  const text = importable.map((name) => `import '${name}/public';`).join('\n');
  const [result] = await eslint.lintText(text, {
    filePath: join(MODULES_DIR, directory, 'probe.js'),
  });
  const rejected = new Set(
    result!.messages
      .filter((message) => message.messageId === 'undeclared')
      .map((message) => importable[message.line - 1]),
  );
  return importable.filter((name) => !rejected.has(name)).sort();
}

const sources = await allFixtureSources();
const nameOf = (id: string) => FIXTURE_MODULE_PACKAGES[id]!;
const directoryOf = (id: string) => nameOf(id).replace('@scorpion/', '');

describe('lint rule and loader agree on dependencies', () => {
  it('for every module of a resolvable profile (required and optional)', async () => {
    const resolved = resolveProfile({
      profile: await fixtureProfile('ab-opt'),
      sources,
      modulePackages: FIXTURE_MODULE_PACKAGES,
    });
    expect(resolved.modules.length).toBeGreaterThan(2);
    for (const module of resolved.modules) {
      const loaderView = [...module.dependsOn, ...module.optionalDependsOn].map(nameOf).sort();
      expect(await acceptedByLint(directoryOf(module.id)), module.id).toEqual(loaderView);
    }
  });

  it('for a module whose dependency the loader reports as missing', async () => {
    let problems: readonly string[] = [];
    try {
      resolveProfile({
        profile: await fixtureProfile('missing'),
        sources,
        modulePackages: FIXTURE_MODULE_PACKAGES,
      });
    } catch (error) {
      if (!(error instanceof KernelStartupError)) throw error;
      problems = error.problems;
    }
    expect(problems).toEqual(['fixture.missing → fixture.b (not in profile "fixture-missing")']);
    expect(await acceptedByLint('fixture-missing')).toEqual(['@scorpion/fixture-b']);
  });

  it('for the modules of a cycle', async () => {
    expect(await acceptedByLint('fixture-cycle-x')).toEqual(['@scorpion/fixture-cycle-y']);
    expect(await acceptedByLint('fixture-cycle-y')).toEqual(['@scorpion/fixture-cycle-x']);
  });
});
