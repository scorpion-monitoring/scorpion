// The screen-reader gate of the faceted search (sprint 3 of M12a, item 7): the keyboard path of the look `combined`
// on the harness scene `facet-search`, with real NVDA (the required check, Windows) and real VoiceOver (nightly, for
// information: on hosted runners it is not stable, decision Q3). Keys go through the reader, as a person's do; sent
// over CDP, NVDA hears nothing. Each step must speak its key phrases: phrases, not whole strings, because the
// readers word them differently across versions (NVDA says "Bio Net" or "BioNet"). The spoken log of every step is
// attached to the report.
import { nvdaTest, voiceOverTest } from '@guidepup/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

interface Reader {
  spokenPhraseLog(): Promise<string[]>;
  press(key: string): Promise<void>;
  navigateToWebContent(): Promise<void>;
}

interface Step {
  name: string;
  key: string;
  /** Key phrases, each matched case-insensitively against what was spoken during the step. */
  phrases: RegExp[];
}

const STEPS: Step[] = [
  {
    name: 'Tab into the box: the combobox, its name and that it is expanded',
    key: 'Tab',
    phrases: [/search services/i, /combo ?box/i, /expanded/i],
  },
  { name: '↓: the first facet', key: 'ArrowDown', phrases: [/consortium/i] },
  { name: '↓: the second facet', key: 'ArrowDown', phrases: [/stage/i] },
  { name: '↑: back to the first', key: 'ArrowUp', phrases: [/consortium/i] },
  {
    name: 'Enter opens the facet: a value, its count and that it is not chosen',
    key: 'Enter',
    phrases: [/bio ?net/i, /\d/, /not selected|not checked/i],
  },
  {
    name: 'Space chooses it: chosen, and the live region says how many match',
    key: ' ',
    phrases: [/selected|checked/i, /\d+ services match/i],
  },
  { name: 'Escape: back to the facets', key: 'Escape', phrases: [/consortium/i, /1 chosen/i] },
  { name: 'Escape: the list closes', key: 'Escape', phrases: [/collapsed/i] },
  {
    name: 'Backspace removes the chip, and says so',
    key: 'Backspace',
    phrases: [/removed/i, /\d+ services match/i],
  },
];

async function heard(reader: Reader, from: number, wanted: RegExp[], timeout = 8000) {
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
  await page.goto('/?scene=facet-search&look=combined', { waitUntil: 'commit', timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Facet search' })).toBeVisible({
    timeout: 60_000,
  });
  await reader.navigateToWebContent();

  const log: { step: string; spoken: string[]; missing: string[] }[] = [];
  for (const step of STEPS) {
    const from = (await reader.spokenPhraseLog()).length;
    await reader.press(step.key);
    const spoken = await heard(reader, from, step.phrases);
    const missing = step.phrases
      .filter((phrase) => !spoken.some((said) => phrase.test(said)))
      .map(String);
    log.push({ step: step.name, spoken, missing });
    expect.soft(missing, `${step.name}: ${JSON.stringify(spoken)}`).toEqual([]);
  }
  const text = JSON.stringify({ reader: testInfo.project.name, log }, null, 2);
  console.log(text);
  await testInfo.attach('spoken-log.json', { body: text, contentType: 'application/json' });
}

// `initial` (the default) keeps only the first phrase of a command; the live region speaks after it.
voiceOverTest.use({ voiceOverStartOptions: { capture: true } });
nvdaTest.use({ nvdaStartOptions: { capture: true } });

if (process.env.SCREEN_READER === 'voiceover') {
  voiceOverTest(
    'the combined keyboard path, under VoiceOver',
    async ({ page, voiceOver }, testInfo) => {
      await path(page, voiceOver, testInfo);
    },
  );
} else {
  nvdaTest('the combined keyboard path, under NVDA', async ({ page, nvda }, testInfo) => {
    await path(page, nvda, testInfo);
  });
}
