// The journey specs of the web app (`apps/web/e2e/journeys/jNN-<slug>.spec.ts`) read as data: the journey id and slug from the
// file name, the title from its `test.describe`, and the titles of its `test.step` calls in the order they are written. The
// docs export and the knowledge base show these steps, so a spec names what a person sees, one step at a time. The reader is
// static (no browser, no Playwright run): a step whose title is not a plain string literal is a problem, not a guess.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `j06-create-service.spec.ts`: two digits, then a slug of lower-case words. */
export const JOURNEY_FILE = /^j(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.spec\.ts$/;

export interface Journey {
  /** `j06` */
  id: string;
  /** `create-service` */
  slug: string;
  file: string;
  /** The text after `J06:` in the title of the `test.describe` ('' when there is none). */
  title: string;
  /** The titles of `test.step` calls, in the order they appear in the file. */
  steps: string[];
  /** How many `test(` calls the file has. */
  tests: number;
  /** What is wrong with the spec as a journey (empty for a good one). */
  problems: string[];
}

const LITERAL = String.raw`(['"\`])((?:\\.|(?!\1)[^\\\n])*)\1`;
const STEP_CALL = /\btest\.step\(/g;
const STEP_TITLE = new RegExp(String.raw`\btest\.step\(\s*${LITERAL}`, 'g');
const DESCRIBE = new RegExp(String.raw`\btest\.describe\(\s*${LITERAL}`);
const TEST_CALL = /^\s*test\(/gm;

const unescape = (text: string) => text.replace(/\\(['"`\\])/g, '$1');

/** A step title is a short imperative sentence: it starts with a capital letter and has no full stop at its end. */
export function stepTitleProblem(title: string): string | undefined {
  if (title.trim() !== title || title === '') return 'has spaces around it or is empty';
  if (title.length > 120) return 'is longer than 120 characters';
  if (!/^[A-Z]/.test(title)) return 'does not start with a capital letter';
  if (/[.!?:;,]$/.test(title)) return 'ends with punctuation';
  if (/\$\{/.test(title)) return 'is built from a value; write the words';
  return undefined;
}

/** One spec file as a journey. `file` is the base name, `source` its text. */
export function parseJourney(file: string, source: string): Journey {
  const named = JOURNEY_FILE.exec(file);
  const problems: string[] = [];
  if (!named) problems.push(`the file name is not jNN-<slug>.spec.ts`);
  const steps = [...source.matchAll(STEP_TITLE)].map((match) => unescape(match[2]!));
  const calls = [...source.matchAll(STEP_CALL)].length;
  if (calls !== steps.length) {
    problems.push(
      `${calls - steps.length} test.step call(s) have a title that is not a plain string`,
    );
  }
  if (steps.length === 0) problems.push('has no test.step');
  for (const title of steps) {
    const problem = stepTitleProblem(title);
    if (problem) problems.push(`step "${title}" ${problem}`);
  }
  const id = named ? `j${named[1]}` : '';
  const describe = DESCRIBE.exec(source);
  const heading = describe ? unescape(describe[2]!) : '';
  const prefix = `${id.toUpperCase()}: `;
  if (named && !heading.startsWith(prefix)) {
    problems.push(`the title of the test.describe must start with "${prefix}"`);
  }
  return {
    id,
    slug: named?.[2] ?? '',
    file,
    title: heading.startsWith(prefix) ? heading.slice(prefix.length) : heading,
    steps,
    tests: [...source.matchAll(TEST_CALL)].length,
    problems,
  };
}

/** Every `jNN-*.spec.ts` in a folder, by journey id. Other files are reported as a problem of their own journey entry. */
export function readJourneys(dir: string): Journey[] {
  const journeys = readdirSync(dir)
    .filter((file) => file.endsWith('.spec.ts'))
    .sort()
    .map((file) => parseJourney(file, readFileSync(join(dir, file), 'utf8')));
  const seen = new Map<string, string>();
  for (const journey of journeys) {
    const other = seen.get(journey.id);
    if (other && journey.id)
      journey.problems.push(`the journey id ${journey.id} is also used by ${other}`);
    seen.set(journey.id, journey.file);
  }
  return journeys;
}
