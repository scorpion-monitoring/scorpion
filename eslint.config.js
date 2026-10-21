// @ts-check
import js from '@eslint/js';
import scorpion, {
  LOADER_FILES,
  loaderSelectors,
  UI_FILES,
  uiSelectors,
} from '@scorpion/eslint-plugin';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/.svelte-kit/',
    '**/test-results/',
    '**/playwright-report/',
    // Written by the code-review-graph tool (git-ignored); not our source.
    '.code-review-graph/',
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
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    // Plain JS config files and the fixtures are not part of a TypeScript project.
    files: ['**/*.js', '**/*.mjs', 'tools/lint-fixtures/**'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    // The UI calls the API through the typed client and builds every link with href() (ADR-0027).
    files: UI_FILES,
    ignores: ['**/*.test.ts', 'apps/web/e2e/**'],
    rules: { 'no-restricted-syntax': ['error', ...uiSelectors] },
  },
  {
    // eslint-plugin-svelte 3.23.1 asks every link and `goto()` to go through SvelteKit's `resolve()`. That helper
    // knows `paths.base`, which is empty here: `BASE_PATH` is a run-time value that the front takes off every request
    // (ADR-0027), so the one way to build a path is `href()` / `url()`, and the rule above already forbids a literal.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    rules: { 'svelte/no-navigation-without-resolve': 'off' },
  },
  {
    // A loader throws; it never returns a response (defect 12). Replaces the list above for these files.
    files: LOADER_FILES,
    ignores: ['**/*.test.ts'],
    rules: { 'no-restricted-syntax': ['error', ...uiSelectors, ...loaderSelectors] },
  },

  {
    // The dashboard grid library is behind one directory (M11, ADR-0042, Decision 2): Snapgrid and dnd-kit are
    // imported by `packages/ui-kit/src/dashboard-grid/` and by nothing else, so a replacement touches only it.
    ignores: ['packages/ui-kit/src/dashboard-grid/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@snapgridjs/*', '@dnd-kit/*'],
              message:
                'Only packages/ui-kit/src/dashboard-grid/ may import the grid library (ADR-0042, Decision 2).',
            },
          ],
        },
      ],
    },
  },

  {
    // The one `{@html}` of the product besides ui-kit's SafeHtml (which carries its own disable comment): the
    // JSON-LD block of the organisation and the service page. Its only input is the output of `serializeJsonLd`
    // (M6 plan, Decision 17; ADR-0033; M7 Decision 15, ADR-0036). Exactly this path: another file keeps the rule,
    // and tools/eslint-plugin/test/ui-rules.test.ts proves it.
    files: ['packages/ui-kit/src/JsonLd.svelte'],
    rules: { 'svelte/no-at-html-tags': 'off' },
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
          // `run-reminder.ts` is the browser tests' second node: the generated profile with kpi.ingestion's clock injected.
          manifestImporters: [
            'apps/server/src/generated/profile.ts',
            'apps/web/src/generated/ui.ts',
            'apps/server/src/testing/identity-app.ts',
            'apps/server/src/testing/run-reminder.ts',
            'modules/core-audit/test/harness.ts',
            'modules/core-blob/test/harness.ts',
            'modules/core-identity/test/harness.ts',
            'modules/core-notifications/test/harness.ts',
            'modules/kpi-framework/test/harness.ts',
            'modules/kpi-ingestion/test/harness.ts',
            'modules/registry-organisations/test/harness.ts',
            'modules/registry-services/test/harness.ts',
            'modules/core-settings/test/harness.ts',
          ],
        },
      ],
    },
  },
);
