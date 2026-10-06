// `pnpm security:asvs [--write] [--ci] [--release]`
//
// Validates the four assessment files against the pinned ASVS source and the test reports, and checks
// (or with --write, regenerates) the chapter reports and the README badge block.
//   --write    write the reports and the README block instead of failing when they differ
//   --ci       strict: a missing or empty JUnit report is an error (also on when CI is set)
//   --release  derive `stale` for a chapter whose scoped paths changed after its assessed_commit
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveStatus, parseAssessment, validate, type DerivedStatus } from './assessment.ts';
import { CHAPTERS, PATHS, reportPath, yamlPath } from './config.ts';
import { collectTags, parseJunit, type TagResults, type TestCase } from './junit.ts';
import { renderBadgeBlock, renderReport, replaceBadgeBlock } from './report.ts';
import { headingAnchors } from './markdown.ts';
import { chaptersForFiles } from './scope.ts';
import { checkSourceHash, readChapter } from './source.ts';

interface Options {
  root: string;
  write: boolean;
  ci: boolean;
  release: boolean;
}

export interface Outcome {
  problems: string[];
  /** Tags that no report could confirm (a local run without reports). */
  unverified: string[];
  statuses: Map<string, DerivedStatus>;
  written: string[];
}

function loadReports(options: Options, problems: string[]): TagResults | undefined {
  const cases: TestCase[] = [];
  let missing = false;
  for (const path of [PATHS.vitestReport, PATHS.playwrightReport]) {
    const file = join(options.root, path);
    if (!existsSync(file)) {
      missing = true;
      if (options.ci)
        problems.push(
          `the JUnit report ${path} is missing (the tests must write it before this check runs)`,
        );
      continue;
    }
    const parsed = parseJunit(readFileSync(file, 'utf8'));
    if (parsed.length === 0 && options.ci)
      problems.push(`the JUnit report ${path} holds no test case`);
    cases.push(...parsed);
  }
  // Without every report, a local run cannot tell "no passing test" from "report not written".
  return missing ? undefined : collectTags(cases);
}

function changedSince(root: string, commit: string): string[] {
  return execFileSync('git', ['diff', '--name-only', `${commit}..HEAD`], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

export function run(options: Options): Outcome {
  const problems: string[] = [];
  const statuses = new Map<string, DerivedStatus>();
  const written: string[] = [];
  const read = (path: string) => readFileSync(join(options.root, path), 'utf8');

  const sourceBytes = readFileSync(join(options.root, PATHS.source));
  const sourceReadme = existsSync(join(options.root, PATHS.sourceReadme))
    ? read(PATHS.sourceReadme)
    : undefined;
  problems.push(...checkSourceHash(sourceBytes, sourceReadme));
  const sourceText = sourceBytes.toString('utf8');

  const reportProblems: string[] = [];
  const tags = loadReports(options, reportProblems);
  problems.push(...reportProblems);
  const unverified: string[] = [];

  for (const config of CHAPTERS) {
    const chapter = readChapter(sourceText, config);
    const assessment = parseAssessment(read(yamlPath(config)));
    const validation = validate(assessment, config, chapter, {
      tags,
      exists: (path) => existsSync(join(options.root, path)),
      anchors: (path) =>
        existsSync(join(options.root, path)) ? headingAnchors(read(path)) : undefined,
    });
    problems.push(...validation.problems);
    unverified.push(...validation.unverified.map((tag) => `ASVS-${tag}`));

    let stale = false;
    if (options.release && assessment.assessed_commit) {
      stale = chaptersForFiles(changedSince(options.root, assessment.assessed_commit)).includes(
        config.chapter,
      );
      if (stale) {
        problems.push(
          `${config.chapter}: scoped paths changed after assessed_commit ${assessment.assessed_commit}; re-assess, or confirm and bump assessed_commit with a new second pass`,
        );
      }
    }
    const status = deriveStatus({ assessment, validation, staleSinceAssessment: stale });
    statuses.set(config.chapter, status);

    // Rule 6: the generated report must be what the tool writes.
    const expected = renderReport(assessment, config, chapter, validation, status);
    const path = reportPath(config);
    const current = existsSync(join(options.root, path)) ? read(path) : undefined;
    if (current !== expected) {
      if (options.write) {
        writeFileSync(join(options.root, path), expected);
        written.push(path);
      } else
        problems.push(
          `${path} is not what \`pnpm security:asvs --write\` generates (never edit a report by hand)`,
        );
    }
  }

  const readme = read(PATHS.readme);
  const updated = replaceBadgeBlock(readme, renderBadgeBlock(statuses));
  if (updated === undefined) {
    problems.push(
      `${PATHS.readme} has no security-badges block (the markers <!-- security-badges:start --> and :end -->)`,
    );
  } else if (updated !== readme) {
    if (options.write) {
      writeFileSync(join(options.root, PATHS.readme), updated);
      written.push(PATHS.readme);
    } else
      problems.push(
        `the badge block in ${PATHS.readme} is not what \`pnpm security:asvs --write\` generates (never edit a badge by hand)`,
      );
  }

  return { problems, unverified: [...new Set(unverified)].sort(), statuses, written };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const known = ['--write', '--ci', '--release'];
  const unknown = args.filter((a) => !known.includes(a));
  if (unknown.length > 0) {
    console.error(
      `unknown argument ${unknown.join(' ')}; usage: security:asvs [--write] [--ci] [--release]`,
    );
    process.exit(2);
  }
  const outcome = run({
    root: process.cwd(),
    write: args.includes('--write'),
    ci: args.includes('--ci') || process.env.CI === 'true',
    release: args.includes('--release'),
  });
  for (const path of outcome.written) console.log(`wrote ${path}`);
  for (const [chapter, status] of outcome.statuses) console.log(`${chapter}: ${status}`);
  if (outcome.unverified.length > 0) {
    console.log(
      `No complete test reports in reports/: could not check ${outcome.unverified.length} test tags (${outcome.unverified.join(', ')}). Run \`pnpm test\` and \`pnpm test:e2e\` with CI=true first; CI checks them.`,
    );
  }
  if (outcome.problems.length > 0) {
    for (const problem of outcome.problems) console.error(`- ${problem}`);
    process.exit(1);
  }
}
