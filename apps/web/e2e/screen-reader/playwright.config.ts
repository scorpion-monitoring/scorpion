import { withGuidepup } from '@guidepup/playwright';
import { devices } from '@playwright/test';
import { HARNESS_PORT } from '../support/harness.ts';

// The screen-reader gate (sprint 3 of M12a, item 7): real NVDA (Windows) and VoiceOver (macOS) driven by Guidepup
// against the component harness, both in Chromium (under VoiceOver, WebKit never loaded the page on hosted
// runners). No server and no database: the harness is a static page. `SCREEN_READER` picks the reader of the
// runner; the specs are `*.sr.ts`, so the main configuration (`**/*.spec.ts`) never picks them up.
const reader = process.env.SCREEN_READER === 'voiceover' ? 'voiceover' : 'nvda';
/** `SR_BROWSER`: Chromium, unless a run asks for WebKit (to look at VoiceOver with Safari's engine again). */
const browser = process.env.SR_BROWSER === 'webkit' ? 'webkit' : 'chromium';

export default withGuidepup({
  testDir: '.',
  testMatch: '**/*.sr.ts',
  forbidOnly: !!process.env.CI,
  reportSlowTests: null,
  timeout: 2 * 60 * 1000,
  retries: process.env.CI ? 1 : 0,
  globalSetup: './global-setup.ts',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${HARNESS_PORT}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: `${reader}-${browser}`,
      use: { ...(browser === 'webkit' ? devices['Desktop Safari'] : devices['Desktop Chrome']) },
    },
  ],
});
