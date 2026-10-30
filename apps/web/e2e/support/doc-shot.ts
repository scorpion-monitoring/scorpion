// `docShot(page, 'j06', 'wizard-basics')`: a screenshot of the screen a journey shows, in the light and the dark theme, at one fixed
// viewport, for the knowledge base (issue #134). It does nothing unless `DOC_SHOTS=1` is set, so the default suite is not slower, and it
// runs in the project on the root base path only, so there is one picture of each screen and not two.
//
//     docShot(page, 'j06', 'wizard-basics');   // reports/doc-shots/j06/01-wizard-basics.light.png and ...dark.png
//
// The number is the order of the calls in the test, so the pictures sort as the story goes. A slug is used once per journey (a test checks it),
// so two tests of one journey never write the same file. A picture shows only what the spec put on the screen: demo data from
// `scorpion seed --demo`, or the fictional data the spec made itself. If a screen could show a real name or address, pass `mask`.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  DOC_SHOT_SCHEMES,
  DOC_SHOT_VIEWPORT,
  DOC_SHOTS_DIR,
  docShotFile,
} from './doc-shot-names.ts';

export { DOC_SHOT_SCHEMES, DOC_SHOT_VIEWPORT, DOC_SHOTS_DIR, docShotFile };

export const docShotsEnabled = () => process.env.DOC_SHOTS === '1';

const counters = new Map<string, number>();

export interface DocShotOptions {
  /** Parts of the screen to cover with a plain box, for anything that is not fictional. */
  mask?: Locator[];
  /** Bring this part of the page into view first: a change of the viewport can leave the page scrolled somewhere else. */
  scrollTo?: Locator;
  /** Take the number from here instead of counting the calls of the test (a journey whose tests each tell a part). */
  number?: number;
}

/**
 * Takes the pictures. The page keeps its viewport and its colour scheme afterwards, so the test goes on as it would without the call.
 * Returns the files written, relative to `DOC_SHOTS_DIR` (none when pictures are off).
 */
export async function docShot(
  page: Page,
  journey: string,
  slug: string,
  options: DocShotOptions = {},
): Promise<string[]> {
  const info = test.info();
  const key = `${info.testId}:${info.retry}`;
  const number = options.number ?? (counters.get(key) ?? 0) + 1;
  counters.set(key, number);
  if (!docShotsEnabled() || info.project.name !== 'root') return [];

  const before = page.viewportSize();
  await page.setViewportSize(DOC_SHOT_VIEWPORT);
  const written: string[] = [];
  try {
    for (const scheme of DOC_SHOT_SCHEMES) {
      const file = docShotFile(journey, number, slug, scheme);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      // The charts and the theme follow the media query; a short wait lets a chart redraw before the picture.
      await page.waitForTimeout(300);
      await options.scrollTo?.scrollIntoViewIfNeeded();
      const path = resolve(DOC_SHOTS_DIR, file);
      mkdirSync(dirname(path), { recursive: true });
      await page.screenshot({
        path,
        animations: 'disabled',
        caret: 'hide',
        mask: options.mask ?? [],
        maskColor: '#808080',
      });
      written.push(file);
    }
  } finally {
    await page.emulateMedia({ colorScheme: null, reducedMotion: null });
    if (before) await page.setViewportSize(before);
  }
  return written;
}
