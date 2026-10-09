// Lints tools/lint-fixtures/ui with the repository's real eslint.config.js: the rules that make the
// typed client, href(), SafeHtml and thrown loader errors mandatory (M5 plan §2, ADR-0027) must fail
// on a violation, and must not fail on code that follows them.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: repoRoot, ignore: false });

async function lint(file: string) {
  const [result] = await eslint.lintFiles([`tools/lint-fixtures/ui/${file}`]);
  if (!result) throw new Error(`no lint result for ${file}`);
  return result.messages.map(({ ruleId, line }) => ({ ruleId, line }));
}

const restricted = (...lines: number[]) =>
  lines.map((line) => ({ ruleId: 'no-restricted-syntax', line }));

describe('the typed client rule', () => {
  it('rejects fetch with a hand-written URL: a literal, a template, a concatenation, globalThis.fetch', async () => {
    expect(await lint('fetch-literal.ts')).toEqual(restricted(2, 3, 4, 5));
  });

  it('lets fetch take a URL or a request that is computed elsewhere', async () => {
    expect(await lint('fetch-variable.ts')).toEqual([]);
  });

  it('rejects goto() with a literal path', async () => {
    expect(await lint('goto-literal.ts')).toEqual(restricted(2));
  });
});

describe('the href rule', () => {
  it('rejects a path written in href, as text, as a string expression and as a template', async () => {
    // (Other Svelte rules also have an opinion about the second line; this is about ours.)
    const ours = (await lint('href-literal.svelte')).filter(
      (message) => message.ruleId === 'no-restricted-syntax',
    );
    expect(ours).toEqual(restricted(1, 2, 3));
  });

  it('allows href() and links that leave the application', async () => {
    expect(await lint('href-helper.svelte')).toEqual([]);
  });
});

describe('the SafeHtml rule', () => {
  it('rejects {@html} outside the one component that disables the rule', async () => {
    expect((await lint('html-tag.svelte')).map((message) => message.ruleId)).toEqual([
      'svelte/no-at-html-tags',
    ]);
  });
});

describe('the JSON-LD exception (Decision 17)', () => {
  const JSON_LD = 'modules/registry-organisations/ui/JsonLd.svelte';
  // The severity the real configuration gives `svelte/no-at-html-tags` for a path: 'off' only where the exception is.
  const severity = async (file: string) => {
    const config = (await eslint.calculateConfigForFile(file)) as {
      rules?: Record<string, unknown>;
    };
    const rule = config.rules?.['svelte/no-at-html-tags'];
    const level = Array.isArray(rule) ? rule[0] : rule;
    return level === 0 || level === 'off' ? 'off' : 'on';
  };

  it('lets exactly one file use {@html}: the component for the JSON-LD block', async () => {
    expect(await severity(JSON_LD)).toBe('off');
    // The same name elsewhere, a sibling in the same folder, a file of another module, the shell and ui-kit keep the rule.
    for (const other of [
      'modules/registry-organisations/ui/Other.svelte',
      'modules/registry-organisations/ui/nested/JsonLd.svelte',
      'modules/core-audit/ui/JsonLd.svelte',
      'apps/web/src/lib/components/JsonLd.svelte',
      'tools/lint-fixtures/ui/html-tag.svelte',
    ]) {
      expect(await severity(other), other).toBe('on');
    }
  });

  it('is lint-clean itself, and is the only file with {@html} besides SafeHtml', async () => {
    const [result] = await eslint.lintFiles([JSON_LD]);
    expect(result?.messages.map((message) => message.ruleId)).toEqual([]);
    const { readFileSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.svelte'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((file) => file && !file.startsWith('tools/lint-fixtures/'));
    const using = files.filter((file) =>
      /\{@html\b/.test(readFileSync(resolve(repoRoot, file), 'utf8')),
    );
    expect(using.sort()).toEqual([JSON_LD, 'packages/ui-kit/src/SafeHtml.svelte'].sort());
  });
});

describe('the loader rule (defect 12)', () => {
  it('rejects a loader that returns a Response or json()', async () => {
    expect(await lint('loaders/response.ts')).toEqual(restricted(2, 3));
    expect(await lint('loaders/json.ts')).toEqual(restricted(1, 3));
  });

  it('allows a loader that throws', async () => {
    expect(await lint('loaders/throws.ts')).toEqual([]);
  });
});
