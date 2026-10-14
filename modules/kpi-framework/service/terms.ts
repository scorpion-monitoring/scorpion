// The vocabulary checks of a save (CLAUDE.md rule 8): every term a row names is checked against its vocabulary
// before anything is written, and all the problems of one request come back in one 422 that names each path.
// The services of sprint 2 call these before they open their transaction.
import { Invalid, type FieldProblem } from '@scorpion/contracts';
import type { SettingsService } from '@scorpion/core-settings/public';
import {
  AGGREGATE_VOCABULARY,
  AUTOMATION_TOOL_VOCABULARY,
  MEASURED_BY_VOCABULARY,
  NECESSITY_VOCABULARY,
  SERVICE_CATEGORY_VOCABULARY,
  THEMATIC_CATEGORY_VOCABULARY,
  UNIT_VOCABULARY,
} from './vocabularies.ts';

/** One term to check: a vocabulary, a key and the path of the field in the request. */
export interface TermCheck {
  vocabulary: string;
  key: string;
  path: string;
  /** The row keeps a term it already has (an update that does not change it), so a deactivated term passes. */
  keep?: boolean;
}

/** Runs every check and throws one `Invalid` with a problem per refused term. */
export async function checkTerms(
  settings: Pick<SettingsService, 'validateTerm'>,
  checks: readonly TermCheck[],
): Promise<void> {
  const problems: FieldProblem[] = [];
  for (const check of checks) {
    try {
      await settings.validateTerm(check.vocabulary, check.key, {
        path: check.path,
        allowInactive: check.keep === true,
      });
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      problems.push(...(error.errors ?? []));
    }
  }
  if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
}

/** The terms an indicator names. `kept` lists the fields of an update that were not changed. */
export function indicatorTermChecks(
  input: {
    unit?: string | null;
    thematic: string;
    measuredBy?: readonly string[];
    canBeAutomatedBy?: readonly string[];
  },
  kept: ReadonlySet<string> = new Set(),
): TermCheck[] {
  const checks: TermCheck[] = [
    {
      vocabulary: THEMATIC_CATEGORY_VOCABULARY,
      key: input.thematic,
      path: 'thematic',
      keep: kept.has('thematic'),
    },
  ];
  if (input.unit)
    checks.push({
      vocabulary: UNIT_VOCABULARY,
      key: input.unit,
      path: 'unit',
      keep: kept.has('unit'),
    });
  (input.measuredBy ?? []).forEach((key, index) =>
    checks.push({
      vocabulary: MEASURED_BY_VOCABULARY,
      key,
      path: `measuredBy[${index}]`,
      keep: kept.has(`measuredBy:${key}`),
    }),
  );
  (input.canBeAutomatedBy ?? []).forEach((key, index) =>
    checks.push({
      vocabulary: AUTOMATION_TOOL_VOCABULARY,
      key,
      path: `canBeAutomatedBy[${index}]`,
      keep: kept.has(`canBeAutomatedBy:${key}`),
    }),
  );
  return checks;
}

/** The terms a KPI set names: its optional RIMO category. */
export function setTermChecks(
  input: { rimoCategory?: string | null },
  kept: ReadonlySet<string> = new Set(),
): TermCheck[] {
  return input.rimoCategory
    ? [
        {
          vocabulary: SERVICE_CATEGORY_VOCABULARY,
          key: input.rimoCategory,
          path: 'rimoCategory',
          keep: kept.has('rimoCategory'),
        },
      ]
    : [];
}

/** The necessity of each row of a set. A necessity of `''` is never a term, so it is refused here (defect 14). */
export function setRowTermChecks(
  rows: readonly { necessity: string }[],
  keptNecessity: ReadonlySet<number> = new Set(),
): TermCheck[] {
  return rows.map((row, index) => ({
    vocabulary: NECESSITY_VOCABULARY,
    key: row.necessity,
    path: `indicators[${index}].necessity`,
    keep: keptNecessity.has(index),
  }));
}

/** The aggregate of a set's evaluation. */
export function evaluationTermChecks(input: { aggregate: string }, keep = false): TermCheck[] {
  return [{ vocabulary: AGGREGATE_VOCABULARY, key: input.aggregate, path: 'aggregate', keep }];
}
