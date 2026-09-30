// Lints tools/lint-fixtures with the repository's real eslint.config.js, so this test fails if
// the boundary rule is removed from the config, not only if the rule itself breaks.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const fixtures = 'tools/lint-fixtures';

// `ignore: false` because the normal lint run ignores the fixtures on purpose.
const eslint = new ESLint({ cwd: repoRoot, ignore: false });

async function lint(file: string) {
  const [result] = await eslint.lintFiles([`${fixtures}/${file}`]);
  if (!result) throw new Error(`no lint result for ${file}`);
  return result.messages.map(({ ruleId, messageId, severity }) => ({
    ruleId,
    messageId,
    severity,
  }));
}

const violation = (messageId: string) => ({
  ruleId: '@scorpion/module-boundaries',
  messageId,
  severity: 2,
});

describe('module boundaries', () => {
  it('allows an import through @scorpion/mod-b/public', async () => {
    expect(await lint('mod-a/src/public-import.ts')).toEqual([]);
  });

  it('allows a module to import its own internals relatively', async () => {
    expect(await lint('mod-b/public.ts')).toEqual([]);
  });

  it('rejects a deep import (@scorpion/mod-b/src/internal)', async () => {
    expect(await lint('mod-a/src/deep-import.ts')).toEqual([violation('deep')]);
  });

  it('rejects a relative import into another module', async () => {
    expect(await lint('mod-a/src/relative-import.ts')).toEqual([violation('relative')]);
  });

  it('rejects importing a module that is not a declared dependency', async () => {
    expect(await lint('mod-b/src/undeclared-import.ts')).toEqual([violation('undeclared')]);
  });
});
