// The two checks of the message catalogue (M5 plan §2):
//  1. every text of every module of the profile exists in every shipped language, with the same placeholders;
//  2. no `.svelte` file of the application writes a user-visible text itself.
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogueProblems, mergeBundles } from '@scorpion/ui-kit';
import { uiModules } from './generated/ui.ts';
import { findLiteralText } from './lib/check/literal-text.ts';
import { shellMessages } from './lib/messages.ts';

const repo = resolve(import.meta.dirname, '../../..');

describe('the message catalogue', () => {
  it('has every English text in German too, with the same placeholders', () => {
    expect(
      catalogueProblems(mergeBundles([shellMessages, ...uiModules.map((m) => m.messages)])),
    ).toEqual([]);
  });

  it.each(uiModules.map((module) => [module.package, module.messages] as const))(
    '%s alone is complete',
    (_name, messages) => {
      expect(catalogueProblems(messages)).toEqual([]);
    },
  );
});

describe('the components', () => {
  const files = [
    ...globSync('apps/web/src/**/*.svelte', { cwd: repo }),
    ...globSync('packages/ui-kit/src/**/*.svelte', { cwd: repo }),
    ...globSync('modules/*/ui/**/*.svelte', { cwd: repo }),
  ].sort();

  it('are found', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s writes no text of its own', (file) => {
    const found = findLiteralText(readFileSync(resolve(repo, file), 'utf8'));
    expect(found.map(({ line, text }) => `${file}:${line} "${text}"`)).toEqual([]);
  });

  it('the check itself finds a text node, a visible attribute, and nothing in an expression', () => {
    const found = findLiteralText(
      [
        '<script lang="ts">let x = "Hello";</script>',
        '<h1>Hello {x}</h1>',
        '<button aria-label="Close" class="btn btn-primary">{t("a")}</button>',
        '<input placeholder="Name" type="text" />',
        '<p>{t("fine")} 42 &times;</p>',
        '<style>.a { content: "text" }</style>',
      ].join('\n'),
    );
    expect(found.map((f) => f.text)).toEqual(['Hello', 'Close', 'Name']);
  });
});
