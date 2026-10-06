// The pinned ASVS source: the official JSON export, verified against the SHA-256 recorded in its README.
import { createHash } from 'node:crypto';
import { ASVS_VERSION, type ChapterConfig } from './config.ts';

export interface Requirement {
  /** `v5.0.0-6.2.1`, the id used in the assessment files. */
  id: string;
  /** `6.2.1`, the id in a test tag `[ASVS-6.2.1]`. */
  number: string;
  level: 1 | 2 | 3;
  text: string;
  /** The section, `V6.2 Password Security`. */
  section: string;
}

export interface Chapter {
  /** Every requirement of the chapter, all levels. */
  requirements: Requirement[];
}

interface SourceItem {
  Shortcode: string;
  Description: string;
  L: string;
}
interface SourceSection {
  Shortcode: string;
  Name: string;
  Items: SourceItem[];
}
interface SourceChapter {
  Shortcode: string;
  Name: string;
  Items: SourceSection[];
}
interface SourceFile {
  Version: string;
  Requirements: SourceChapter[];
}

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** The hash written in the source README as ``SHA-256: `<64 hex>` ``. */
export function recordedHash(readme: string): string | undefined {
  return /^SHA-256:\s*`([0-9a-f]{64})`/m.exec(readme)?.[1];
}

/** Problems with the pinned file itself: a missing record, or a hash that does not match. */
export function checkSourceHash(raw: Uint8Array, readme: string | undefined): string[] {
  const recorded = readme === undefined ? undefined : recordedHash(readme);
  if (recorded === undefined) {
    return [
      'the source README does not record the SHA-256 of the pinned file (a line "SHA-256: `<hex>`")',
    ];
  }
  const actual = sha256(raw);
  return actual === recorded
    ? []
    : [
        `the pinned ASVS source does not match its recorded SHA-256 (recorded ${recorded}, file ${actual})`,
      ];
}

/** Reads the chapter from the source file. Throws when the file is not the expected ASVS version or chapter. */
export function readChapter(raw: string, config: ChapterConfig): Chapter {
  const file = JSON.parse(raw) as SourceFile;
  if (file.Version !== ASVS_VERSION) {
    throw new Error(`the pinned source is ASVS ${file.Version}, expected ${ASVS_VERSION}`);
  }
  const chapter = file.Requirements.find((c) => c.Shortcode === config.chapter);
  if (!chapter) throw new Error(`the pinned source has no chapter ${config.chapter}`);
  if (chapter.Name !== config.name) {
    throw new Error(
      `chapter ${config.chapter} is "${chapter.Name}" in the pinned source, not "${config.name}": fix config.ts and docs/implementation.md §8.1`,
    );
  }
  const requirements = chapter.Items.flatMap((section) =>
    section.Items.map((item): Requirement => {
      const number = item.Shortcode.replace(/^V/, '');
      return {
        id: `v${ASVS_VERSION}-${number}`,
        number,
        level: Number(item.L) as 1 | 2 | 3,
        text: item.Description,
        section: `${section.Shortcode} ${section.Name}`,
      };
    }),
  );
  return { requirements };
}

/** The requirements the assessment must cover: Level 1 and Level 2 (Level 2 includes Level 1). */
export const assessed = (chapter: Chapter): Requirement[] =>
  chapter.requirements.filter((r) => r.level <= 2);
