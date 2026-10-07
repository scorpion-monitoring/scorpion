// The `asvs-impact` rule (CLAUDE.md "Security assurance", docs/implementation.md §8.4): a change to a
// security-scoped path must come with a change to the matching chapter's assessment file, or with the
// label `asvs-no-impact` and a line `ASVS impact: none because …` in the pull request description.
// Everything here is data: the labels and the description are never executed or interpolated into a command.
import { CHAPTERS, yamlPath } from './config.ts';
import { chaptersForFiles } from './scope.ts';

export const NO_IMPACT_LABEL = 'asvs-no-impact';

export interface ImpactInput {
  changedFiles: readonly string[];
  labels: readonly string[];
  description: string;
}

export interface ImpactResult {
  ok: boolean;
  /** Chapters whose scoped paths changed. */
  impacted: string[];
  /** Impacted chapters whose YAML file did not change. */
  missing: string[];
  message: string;
}

/** The reason after `ASVS impact: none because`, or undefined when there is none. The template's "…" is not a reason. */
export function noImpactReason(description: string): string | undefined {
  const match = /^[ \t]*ASVS impact:[ \t]*none because[ \t]+(\S.*)$/im.exec(description);
  const reason = match?.[1]?.trim();
  if (!reason || /^(…|\.\.\.|<[^>]*>)$/.test(reason) || !/\p{L}{3}/u.test(reason)) return undefined;
  return reason;
}

export function checkImpact({ changedFiles, labels, description }: ImpactInput): ImpactResult {
  const impacted = chaptersForFiles(changedFiles);
  if (impacted.length === 0) {
    return { ok: true, impacted, missing: [], message: 'No security-scoped path changed.' };
  }
  const changed = new Set(changedFiles);
  const missing = impacted.filter((chapter) => {
    const config = CHAPTERS.find((c) => c.chapter === chapter)!;
    return !changed.has(yamlPath(config));
  });
  if (missing.length === 0) {
    return {
      ok: true,
      impacted,
      missing,
      message: `Security-scoped paths changed; the assessment of ${impacted.join(', ')} changed too.`,
    };
  }
  const labelled = labels.includes(NO_IMPACT_LABEL);
  const reason = noImpactReason(description);
  if (labelled && reason) {
    return {
      ok: true,
      impacted,
      missing,
      message: `No ASVS impact declared for ${missing.join(', ')}: ${reason}`,
    };
  }
  const fixes = [
    `update ${missing.map((m) => yamlPath(CHAPTERS.find((c) => c.chapter === m)!)).join(', ')}`,
  ];
  fixes.push(
    labelled
      ? `the label ${NO_IMPACT_LABEL} is set, but the description has no line "ASVS impact: none because <reason>"`
      : `or add the label ${NO_IMPACT_LABEL} and a line "ASVS impact: none because <reason>" to the description`,
  );
  return {
    ok: false,
    impacted,
    missing,
    message: `Security-scoped paths changed that affect ${missing.join(', ')}. ${fixes.join('; ')}.`,
  };
}
