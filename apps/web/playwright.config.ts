import { defineConfig, devices } from '@playwright/test';
import { HARNESS_PORT } from './e2e/support/harness.ts';
import { FRESH_SPEC, SPECS } from './e2e/support/stack.ts';

// Two projects, one per base path: every journey runs under `/` and under `/a/b` (M5 acceptance).
// `globalSetup` starts a PostgreSQL container and, for each project, the API and the web server.
// `basePath` is an option of the fixtures in e2e/support/fixtures.ts.
export default defineConfig<{ basePath: string }>({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  // The JUnit file is evidence for `pnpm security:asvs` (a test tagged `[ASVS-x.y.z]` passed in this run).
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: '../../reports/playwright-junit.xml' }],
      ]
    : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    ...SPECS.map((spec) => ({
      name: spec.name,
      // A fresh install has no administrator, so only the bootstrap spec runs on it, and that spec runs nowhere else.
      ...(spec.admin === false
        ? { testMatch: `**/${FRESH_SPEC}` }
        : { testIgnore: [`**/${FRESH_SPEC}`, '**/components/**'] }),
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${spec.webPort}`,
        basePath: spec.basePath,
      },
    })),
    // The shared components on their own page (e2e/components/harness): behaviour, keyboard and axe, no stack.
    {
      name: 'components',
      testMatch: '**/components/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${HARNESS_PORT}`,
        basePath: '/',
      },
    },
  ],
});
