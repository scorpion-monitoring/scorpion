// The names and the numbers of the pictures `docShot()` takes (no browser here, so a unit test can read them).
import { resolve } from 'node:path';

/** The one viewport of every picture: a laptop screen, wide enough for the sidebar and a table, short enough to read in a page. */
export const DOC_SHOT_VIEWPORT = { width: 1280, height: 800 } as const;

export const DOC_SHOT_SCHEMES = ['light', 'dark'] as const;
export type DocShotScheme = (typeof DOC_SHOT_SCHEMES)[number];

/** Where the pictures go: `DOC_SHOTS_DIR`, else `reports/doc-shots` at the root of the repository. */
export const DOC_SHOTS_DIR =
  process.env.DOC_SHOTS_DIR ?? resolve(import.meta.dirname, '../../../../reports/doc-shots');

const JOURNEY = /^j\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `j06/01-wizard-basics.light.png`: the path of a picture under the folder of the pictures. */
export function docShotFile(
  journey: string,
  number: number,
  slug: string,
  scheme: DocShotScheme,
): string {
  if (!JOURNEY.test(journey)) throw new Error(`docShot: "${journey}" is not a journey id like j06`);
  if (!SLUG.test(slug)) throw new Error(`docShot: "${slug}" is not a slug of lower-case words`);
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new Error(`docShot: the number ${number} is not between 1 and 99`);
  }
  return `${journey}/${String(number).padStart(2, '0')}-${slug}.${scheme}.png`;
}
