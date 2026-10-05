// @ts-check
import js from '@eslint/js';
import scorpion from '@scorpion/eslint-plugin';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelteConfig from './apps/web/svelte.config.js';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/.svelte-kit/',
    '**/test-results/',
    '**/playwright-report/',
    // Contains deliberate violations; linted by tools/eslint-plugin/test.
    'tools/lint-fixtures/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser, svelteConfig },
    },
  },
  {
    // Plain JS config files and the fixtures are not part of a TypeScript project.
    files: ['**/*.js', '**/*.mjs', 'tools/lint-fixtures/**'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    plugins: { '@scorpion': scorpion },
    rules: {
      '@scorpion/module-boundaries': [
        'error',
        {
          moduleRoots: ['modules', 'tools/lint-fixtures', 'packages/kernel/test/fixtures/modules'],
          // Written by `scorpion profile:generate`; the only file that imports module manifests.
          // The test helpers that start a kernel (and the HTTP app) over core.identity do the same
          // composition for a test, with injected settings and the real core.authz it depends on.
          manifestImporters: [
            'apps/server/src/generated/profile.ts',
            'apps/server/src/testing/identity-app.ts',
            'modules/core-blob/test/harness.ts',
            'modules/core-identity/test/harness.ts',
            'modules/core-notifications/test/harness.ts',
            'modules/core-settings/test/harness.ts',
          ],
        },
      ],
    },
  },
);
