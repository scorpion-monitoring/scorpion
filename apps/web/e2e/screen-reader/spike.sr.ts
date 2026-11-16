// SPIKE (sprint 3 of M12a, item 7): does a real screen reader run stably on a hosted runner, and what does it
// say for each step of a combobox path? Runs the same steps under VoiceOver (macOS) and NVDA (Windows) and
// writes every step's spoken phrases to the report and to stdout. The key phrases are soft checks so one run
// gives the whole log. Replaced by the gate of the real component.
import { nvdaTest, voiceOverTest } from '@guidepup/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

interface Reader {
  spokenPhraseLog(): Promise<string[]>;
  press(key: string): Promise<void>;
  navigateToWebContent(): Promise<void>;
}

/** `page`: keys go to the browser (CDP), the reader only listens. `reader`: keys go through the reader. */
const KEYS = process.env.SR_KEYS === 'reader' ? 'reader' : 'page';

interface Step {
  name: string;
  keys: string[];
  /** Key phrases, matched case-insensitively against what was spoken during the step. */
  expect: RegExp[];
}

const STEPS: Step[] = [
  {
    name: 'Tab into the box',
    keys: ['Tab'],
    expect: [/search and filter services/i, /combo ?box/i],
  },
  { name: 'Down to Stage', keys: ['ArrowDown'], expect: [/stage/i] },
  { name: 'Up to Consortium', keys: ['ArrowUp'], expect: [/consortium/i] },
  { name: 'Enter opens Consortium', keys: ['Enter'], expect: [/de\.?nbi/i, /12/] },
  {
    name: 'Space chooses de.NBI',
    keys: ['Space'],
    expect: [/selected|checked/i, /12 services match/i],
  },
  { name: 'Escape back to the facets', keys: ['Escape'], expect: [/consortium/i] },
  { name: 'Escape closes the list', keys: ['Escape'], expect: [/collapsed|search and filter/i] },
];

async function heard(reader: Reader, from: number, wanted: RegExp[], timeout = 6000) {
  const until = Date.now() + timeout;
  let spoken: string[] = [];
  do {
    spoken = (await reader.spokenPhraseLog()).slice(from);
    if (wanted.every((phrase) => spoken.some((said) => phrase.test(said)))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < until);
  return spoken;
}

async function path(page: Page, reader: Reader, testInfo: TestInfo) {
  await page.goto('/?scene=sr-spike', { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Screen reader spike' })).toBeVisible();
  await reader.navigateToWebContent();
  await page.getByRole('button', { name: 'Before' }).focus();

  const log: { step: string; spoken: string[]; missing: string[] }[] = [];
  for (const step of STEPS) {
    const from = (await reader.spokenPhraseLog()).length;
    for (const key of step.keys) {
      if (KEYS === 'reader') await reader.press(key === 'Space' ? ' ' : key);
      else await page.keyboard.press(key);
    }
    const spoken = await heard(reader, from, step.expect);
    const missing = step.expect
      .filter((phrase) => !spoken.some((said) => phrase.test(said)))
      .map(String);
    log.push({ step: step.name, spoken, missing });
    expect.soft(missing, `${step.name}: ${JSON.stringify(spoken)}`).toEqual([]);
  }
  const text = JSON.stringify({ keys: KEYS, browser: testInfo.project.name, log }, null, 2);
  console.log(text);
  await testInfo.attach('spoken-log.json', { body: text, contentType: 'application/json' });
}

if (process.env.SCREEN_READER === 'voiceover') {
  voiceOverTest('combobox path under VoiceOver', async ({ page, voiceOver }, testInfo) => {
    await path(page, voiceOver, testInfo);
  });
} else {
  nvdaTest('combobox path under NVDA', async ({ page, nvda }, testInfo) => {
    await path(page, nvda, testInfo);
  });
}
