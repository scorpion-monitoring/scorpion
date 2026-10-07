import { defineConfig, devices } from '@playwright/test';
import { SPECS } from './e2e/support/stack.ts';

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
  projects: SPECS.map((spec) => ({
    name: spec.name,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: `http://localhost:${spec.webPort}`,
      basePath: spec.basePath,
    },
  })),
});
