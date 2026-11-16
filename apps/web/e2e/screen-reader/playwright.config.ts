import { withGuidepup } from '@guidepup/playwright';
import { devices } from '@playwright/test';
import { HARNESS_PORT } from '../support/harness.ts';

// The screen-reader gate (sprint 3 of M12a, item 7): real VoiceOver (macOS, WebKit) and NVDA (Windows,
// Chromium) driven by Guidepup against the component harness. No server and no database: the harness is a
// static page. `SCREEN_READER` picks the reader of the runner; the specs are `*.sr.ts`, so the main
// configuration (`**/*.spec.ts`) never picks them up.
const reader = process.env.SCREEN_READER === 'voiceover' ? 'voiceover' : 'nvda';

export default withGuidepup({
  testDir: '.',
  testMatch: '**/*.sr.ts',
  forbidOnly: !!process.env.CI,
  reportSlowTests: null,
  timeout: 5 * 60 * 1000,
  retries: Number(process.env.SR_RETRIES ?? 0),
  globalSetup: './global-setup.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${HARNESS_PORT}`, trace: 'retain-on-failure' },
  projects: [
    reader === 'voiceover'
      ? { name: 'voiceover', use: { ...devices['Desktop Safari'] } }
      : { name: 'nvda', use: { ...devices['Desktop Chrome'] } },
  ],
});
