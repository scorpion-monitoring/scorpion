// Security-scoped paths and the ASVS chapters each one can change (docs/implementation.md §8.4).
// The same list is in CLAUDE.md ("Security assurance") and .github/CODEOWNERS; scope.test.ts keeps the three together.
import { CHAPTERS, PATHS } from './config.ts';

export interface ScopedPath {
  /** A file, or a directory written `dir/**`. */
  path: string;
  chapters: readonly string[];
}

export const ALL_CHAPTERS: readonly string[] = CHAPTERS.map((c) => c.chapter);

export const SCOPED_PATHS: readonly ScopedPath[] = [
  { path: 'modules/core-identity/**', chapters: ['V6', 'V7', 'V10'] },
  { path: 'modules/core-authz/**', chapters: ['V8'] },
  { path: 'apps/server/src/pipeline/**', chapters: ['V7', 'V8'] },
  { path: 'packages/contracts/src/route.ts', chapters: ['V8'] },
  { path: 'docs/security/**', chapters: ALL_CHAPTERS },
];

function matches(pattern: string, file: string): boolean {
  return pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : file === pattern;
}

/** The assessment data of a chapter: its YAML, its generated report. They are the update, not a scoped change. */
export function isChapterFile(file: string): boolean {
  return CHAPTERS.some(
    (c) =>
      file === `${PATHS.assessmentDir}/${c.slug}.yaml` ||
      file === `${PATHS.assessmentDir}/${c.slug}.md`,
  );
}

/** The chapters whose assessment a change to this file can make wrong. */
export function chaptersForPath(file: string): string[] {
  if (isChapterFile(file)) return [];
  const chapters = new Set<string>();
  for (const scoped of SCOPED_PATHS) {
    if (matches(scoped.path, file)) for (const chapter of scoped.chapters) chapters.add(chapter);
  }
  return ALL_CHAPTERS.filter((chapter) => chapters.has(chapter));
}

/** The chapters touched by a set of changed files, in chapter order. */
export function chaptersForFiles(files: readonly string[]): string[] {
  const chapters = new Set(files.flatMap(chaptersForPath));
  return ALL_CHAPTERS.filter((chapter) => chapters.has(chapter));
}
