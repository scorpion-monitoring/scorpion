import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The JUnit file is evidence for `pnpm security:asvs` (a test tagged `[ASVS-x.y.z]` passed in this run).
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: '../../reports/playwright-junit.xml' }],
      ]
    : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
