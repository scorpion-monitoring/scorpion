// A miniature repository for the tests: a small pinned source, four assessment files, a README with the badge block.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import type { Assessment, Entry } from './assessment.ts';
import { BADGE_END, BADGE_START, CHAPTERS, PATHS, yamlPath } from './config.ts';
import { run } from './cli.ts';
import { sha256 } from './source.ts';

interface Item {
  number: string;
  level: '1' | '2' | '3';
}

/** Per chapter: the requirements of the mini source. Each chapter has one Level 3 requirement that must not be assessed. */
export const MINI: Record<string, Item[]> = {
  V6: [
    { number: '6.1.1', level: '1' },
    { number: '6.1.2', level: '2' },
    { number: '6.1.3', level: '3' },
  ],
  V7: [{ number: '7.1.1', level: '1' }],
  V8: [{ number: '8.1.1', level: '2' }],
  V10: [{ number: '10.1.1', level: '2' }],
};

export function miniSource(): string {
  return JSON.stringify({
    Name: 'ASVS',
    Version: '5.0.0',
    Requirements: CHAPTERS.map((config) => ({
      Shortcode: config.chapter,
      Name: config.name,
      Items: [
        {
          Shortcode: `${config.chapter}.1`,
          Name: 'Section',
          Items: (MINI[config.chapter] ?? []).map((item) => ({
            Shortcode: `V${item.number}`,
            Description: `Verify requirement ${item.number} | with a pipe`,
            L: item.level,
          })),
        },
      ],
    })),
  });
}

export const requirementId = (number: string) => `v5.0.0-${number}`;

/** An `n/a` entry for every L1 and L2 requirement, each with its own reason. */
export function naEntries(chapter: string): Entry[] {
  return (MINI[chapter] ?? [])
    .filter((item) => item.level !== '3')
    .map((item) => ({
      id: requirementId(item.number),
      status: 'n/a',
      reason: `Scorpion cannot do ${item.number}`,
    }));
}

export function baseAssessment(
  chapter: string,
  requirements: Entry[] = naEntries(chapter),
): Assessment {
  return {
    asvs_version: '5.0.0',
    level: 2,
    chapter,
    assessment_type: null,
    assessed_commit: null,
    assessed_on: null,
    assessor: null,
    second_pass: null,
    reviewer: null,
    requirements,
  };
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export const writeAssessment = (root: string, chapter: string, assessment: Assessment): void =>
  write(root, yamlPath(CHAPTERS.find((c) => c.chapter === chapter)!), stringify(assessment));

/** A repository root in which `run()` finds nothing to complain about; the reports and the badge block are generated. */
export function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'asvs-report-'));
  const source = miniSource();
  write(root, PATHS.source, source);
  write(root, PATHS.sourceReadme, `# Source\n\nSHA-256: \`${sha256(source)}\`\n`);
  write(root, PATHS.readme, `# Project\n\n${BADGE_START}\nold\n${BADGE_END}\n`);
  for (const config of CHAPTERS)
    writeAssessment(root, config.chapter, baseAssessment(config.chapter));
  run({ root, write: true, ci: false, release: false });
  return root;
}
