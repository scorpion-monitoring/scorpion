// The assessment file of one chapter and the rules of docs/implementation.md §8.2.
import { parse } from 'yaml';
import { ASVS_LEVEL, ASVS_VERSION, REPOSITORY, type ChapterConfig } from './config.ts';
import type { TagResults } from './junit.ts';
import { assessed, type Chapter } from './source.ts';

export type Status = 'pass' | 'fail' | 'n/a';
export type AssessmentType = 'self' | 'peer' | 'external';

export interface Evidence {
  test?: string;
  code?: string;
  doc?: string;
}

export interface Entry {
  id: string;
  status: Status;
  evidence?: Evidence[];
  note?: string;
  reason?: string;
}

export interface Assessment {
  asvs_version: string;
  level: number;
  chapter: string;
  assessment_type: AssessmentType | null;
  assessed_commit: string | null;
  assessed_on: string | null;
  assessor: string | null;
  second_pass: { by: string | null; on: string | null } | null;
  reviewer: string | null;
  requirements: Entry[];
}

export type DerivedStatus =
  'in progress' | 'self-assessed' | 'peer-reviewed' | 'externally verified' | 'stale';

export function parseAssessment(text: string): Assessment {
  const data: unknown = parse(text);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('the assessment file is not a YAML mapping');
  }
  const value = data as Partial<Assessment>;
  return {
    asvs_version: String(value.asvs_version ?? ''),
    level: Number(value.level ?? 0),
    chapter: String(value.chapter ?? ''),
    assessment_type: value.assessment_type ?? null,
    assessed_commit: value.assessed_commit ?? null,
    assessed_on: value.assessed_on ?? null,
    assessor: value.assessor ?? null,
    second_pass: value.second_pass ?? null,
    reviewer: value.reviewer ?? null,
    requirements: Array.isArray(value.requirements) ? value.requirements : [],
  };
}

export interface ValidationContext {
  /** What the test reports say about each tag; undefined when no report is available (local run). */
  tags: TagResults | undefined;
  /** True when a repository path exists. */
  exists: (path: string) => boolean;
}

export interface Validation {
  problems: string[];
  /** Test tags that `pass` entries rely on and that no report could confirm. */
  unverified: string[];
  counts: Record<Status, number>;
}

const STATUSES: readonly string[] = ['pass', 'fail', 'n/a'];
const TYPES: readonly string[] = ['self', 'peer', 'external'];
const ISSUE_LINK = new RegExp(
  `(?:^|[^\\w/])#\\d+\\b|https://github\\.com/${REPOSITORY.org}/${REPOSITORY.repo}/issues/\\d+`,
);
const SHA = /^[0-9a-f]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const blank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim() === '';

function days(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

function safePath(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.split('/').includes('..');
}

export function validate(
  assessment: Assessment,
  config: ChapterConfig,
  chapter: Chapter,
  context: ValidationContext,
): Validation {
  const problems: string[] = [];
  const unverified = new Set<string>();
  const counts: Record<Status, number> = { pass: 0, fail: 0, 'n/a': 0 };
  const where = config.chapter;

  if (assessment.asvs_version !== ASVS_VERSION)
    problems.push(`${where}: asvs_version must be ${ASVS_VERSION}`);
  if (assessment.level !== ASVS_LEVEL) problems.push(`${where}: level must be ${ASVS_LEVEL}`);
  if (assessment.chapter !== config.chapter)
    problems.push(`${where}: chapter must be ${config.chapter}`);

  // Rule 1: every L1 and L2 requirement exactly once, nothing else.
  const required = new Map(assessed(chapter).map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const entry of assessment.requirements) {
    if (!required.has(entry.id)) {
      problems.push(
        `${where}: unknown requirement id ${entry.id} (not a Level 1 or 2 requirement of ${config.chapter})`,
      );
      continue;
    }
    if (seen.has(entry.id)) problems.push(`${where}: ${entry.id} appears more than once`);
    seen.add(entry.id);
  }
  for (const id of required.keys())
    if (!seen.has(id)) problems.push(`${where}: missing requirement ${id}`);

  const reasons = new Map<string, string>();
  for (const entry of assessment.requirements) {
    const requirement = required.get(entry.id);
    if (!requirement) continue;
    if (!STATUSES.includes(entry.status)) {
      problems.push(`${entry.id}: status must be pass, fail or n/a, not "${String(entry.status)}"`);
      continue;
    }
    counts[entry.status]++;

    if (entry.status === 'pass') {
      // Rule 2: evidence that exists and runs.
      const evidence = entry.evidence ?? [];
      if (evidence.length === 0)
        problems.push(`${entry.id}: pass needs at least one piece of evidence`);
      for (const item of evidence) {
        const kinds = (['test', 'code', 'doc'] as const).filter((k) => item[k] !== undefined);
        if (kinds.length !== 1) {
          problems.push(`${entry.id}: each evidence item has exactly one of test, code or doc`);
          continue;
        }
        if (item.test !== undefined) {
          const tag = `ASVS-${requirement.number}`;
          if (item.test !== tag) {
            problems.push(
              `${entry.id}: test evidence must be the tag "${tag}", not "${item.test}"`,
            );
          } else if (context.tags === undefined) {
            unverified.add(requirement.number);
          } else if (context.tags.failed.has(requirement.number)) {
            problems.push(`${entry.id}: a test tagged [${tag}] failed in this run`);
          } else if (!context.tags.passed.has(requirement.number)) {
            problems.push(`${entry.id}: no test tagged [${tag}] passed in this run`);
          }
        } else {
          const path = (item.code ?? item.doc)!;
          if (!safePath(path))
            problems.push(
              `${entry.id}: evidence path "${path}" must be relative and inside the repository`,
            );
          else if (!context.exists(path))
            problems.push(`${entry.id}: evidence path ${path} does not exist`);
        }
      }
    } else if (entry.status === 'n/a') {
      // Rule 3: a reason, specific to the requirement.
      if (blank(entry.reason)) problems.push(`${entry.id}: n/a needs a reason`);
      else {
        const key = entry.reason!.trim().replace(/\s+/g, ' ');
        const other = reasons.get(key);
        if (other)
          problems.push(
            `${entry.id}: n/a reason is the same text as ${other}; give each requirement its own reason`,
          );
        reasons.set(key, entry.id);
      }
    } else if (blank(entry.note) || !ISSUE_LINK.test(entry.note!)) {
      problems.push(
        `${entry.id}: fail needs a note that links to an issue (#123 or the issue URL)`,
      );
    }
  }

  // Rule 4: the human fields.
  if (assessment.assessment_type !== null && !TYPES.includes(assessment.assessment_type)) {
    problems.push(`${where}: assessment_type must be self, peer or external`);
  }
  if (!blank(assessment.assessed_commit) && !SHA.test(assessment.assessed_commit!)) {
    problems.push(`${where}: assessed_commit must be a full 40-character SHA`);
  }
  for (const [field, value] of [
    ['assessed_on', assessment.assessed_on],
    ['second_pass.on', assessment.second_pass?.on],
  ] as const) {
    if (!blank(value) && !DAY.test(value!))
      problems.push(`${where}: ${field} must be a date written YYYY-MM-DD`);
  }
  const secondOn = assessment.second_pass?.on;
  if (!blank(secondOn)) {
    if (blank(assessment.assessed_on))
      problems.push(`${where}: second_pass.on is set but assessed_on is not`);
    else if (
      DAY.test(secondOn!) &&
      DAY.test(assessment.assessed_on!) &&
      days(assessment.assessed_on!, secondOn!) < 7
    ) {
      problems.push(`${where}: second_pass.on must be at least 7 days after assessed_on`);
    }
  }
  if (assessment.assessment_type === 'peer' || assessment.assessment_type === 'external') {
    if (blank(assessment.reviewer))
      problems.push(`${where}: a ${assessment.assessment_type} assessment needs a reviewer`);
    else if (assessment.reviewer === assessment.assessor)
      problems.push(`${where}: the reviewer must differ from the assessor`);
  }

  return { problems, unverified: [...unverified].sort(), counts };
}

export interface DeriveInput {
  assessment: Assessment;
  validation: Validation;
  /** Scoped paths changed since `assessed_commit`; only computed on a release branch. */
  staleSinceAssessment?: boolean;
}

/**
 * Rule 5. The status is derived, never stored. `stale` applies only to a chapter that has an
 * `assessed_commit` (plan §9, Decision 6), and only when the caller found a scoped change after it.
 */
export function deriveStatus({
  assessment,
  validation,
  staleSinceAssessment,
}: DeriveInput): DerivedStatus {
  if (!blank(assessment.assessed_commit) && staleSinceAssessment) return 'stale';
  const complete =
    validation.problems.length === 0 &&
    validation.counts.fail === 0 &&
    assessment.assessment_type !== null &&
    !blank(assessment.assessor) &&
    !blank(assessment.assessed_commit) &&
    !blank(assessment.assessed_on) &&
    !blank(assessment.second_pass?.by) &&
    !blank(assessment.second_pass?.on);
  if (!complete) return 'in progress';
  if (assessment.assessment_type === 'peer') return 'peer-reviewed';
  if (assessment.assessment_type === 'external') return 'externally verified';
  return 'self-assessed';
}
