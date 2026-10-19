// The vocabularies this module declares and the ones it starts using (ADR-0040). `core.settings` stores the
// terms; this module says which terms exist at the start and whether a term is in use, so that a term that
// is used is deactivated and never deleted. Every `usage` answers from this module's own tables.
import type { VocabularyContribution } from '@scorpion/core-settings/public';
import type { Db } from '@scorpion/kernel';
import { eq } from 'drizzle-orm';
import seed from '../config/rimo-seed.json' with { type: 'json' };
import { SEED_UNITS } from '../config/units.ts';
import {
  evaluation,
  indicator,
  indicatorMeans,
  indicatorTool,
  kpiSet,
  kpiSetIndicator,
} from '../db/schema.ts';

/** The registry of vocabularies, declared by core.settings. */
export const VOCABULARY_REGISTRY = 'vocabulary';

/** Vocabularies this module owns. */
export const UNIT_VOCABULARY = 'kpi.unit';
export const MEASURED_BY_VOCABULARY = 'kpi.measured-by';
export const AUTOMATION_TOOL_VOCABULARY = 'kpi.automation-tool';
export const SERVICE_CATEGORY_VOCABULARY = 'kpi.service-category';
/** Built-in vocabularies of core.settings that this module starts to store keys of. */
export const THEMATIC_CATEGORY_VOCABULARY = 'thematic-category';
export const NECESSITY_VOCABULARY = 'necessity';
export const AGGREGATE_VOCABULARY = 'aggregate';

/** One question per vocabulary: is any row of this module using the term? */
export type UsageChecks = Record<string, (termKey: string) => Promise<boolean>>;

const exists = async (query: Promise<unknown[]>): Promise<boolean> => (await query).length > 0;

/** The checks, over the database. Each reads one indexed column of one of this module's tables. */
export function createUsageChecks(db: Pick<Db, 'select'>): UsageChecks {
  return {
    [UNIT_VOCABULARY]: (key) =>
      exists(
        db.select({ id: indicator.id }).from(indicator).where(eq(indicator.unit, key)).limit(1),
      ),
    [MEASURED_BY_VOCABULARY]: (key) =>
      exists(
        db
          .select({ id: indicatorMeans.indicatorId })
          .from(indicatorMeans)
          .where(eq(indicatorMeans.termKey, key))
          .limit(1),
      ),
    [AUTOMATION_TOOL_VOCABULARY]: (key) =>
      exists(
        db
          .select({ id: indicatorTool.indicatorId })
          .from(indicatorTool)
          .where(eq(indicatorTool.termKey, key))
          .limit(1),
      ),
    [SERVICE_CATEGORY_VOCABULARY]: (key) =>
      exists(
        db.select({ id: kpiSet.id }).from(kpiSet).where(eq(kpiSet.rimoCategory, key)).limit(1),
      ),
    [THEMATIC_CATEGORY_VOCABULARY]: (key) =>
      exists(
        db.select({ id: indicator.id }).from(indicator).where(eq(indicator.thematic, key)).limit(1),
      ),
    [NECESSITY_VOCABULARY]: (key) =>
      exists(
        db
          .select({ id: kpiSetIndicator.setId })
          .from(kpiSetIndicator)
          .where(eq(kpiSetIndicator.necessity, key))
          .limit(1),
      ),
    [AGGREGATE_VOCABULARY]: (key) =>
      exists(
        db
          .select({ id: evaluation.setId })
          .from(evaluation)
          .where(eq(evaluation.aggregate, key))
          .limit(1),
      ),
  };
}

/**
 * The entries this module contributes to the registry `vocabulary`. `usage` is looked up when it is asked, so
 * the manifest can be built before the database exists (the pattern of registry.services' `stage`).
 */
export function vocabularyContributions(
  usage: () => UsageChecks | undefined,
): VocabularyContribution[] {
  const inUse = (id: string) => (termKey: string) =>
    usage()?.[id]?.(termKey) ?? Promise.resolve(false);
  return [
    {
      id: UNIT_VOCABULARY,
      description: 'Units of an indicator value (seeded with Units Ontology terms)',
      terms: SEED_UNITS.map((unit, index) => ({
        key: unit.key,
        labels: unit.labels,
        sortOrder: (index + 1) * 10,
      })),
      usage: inUse(UNIT_VOCABULARY),
    },
    {
      id: MEASURED_BY_VOCABULARY,
      description: 'Means of measurement of an indicator (rimo:MeasurementMeans); none are seeded',
      terms: [],
      usage: inUse(MEASURED_BY_VOCABULARY),
    },
    {
      id: AUTOMATION_TOOL_VOCABULARY,
      description: 'Tools that can automate an indicator (rimo:AutomationTool); none are seeded',
      terms: [],
      usage: inUse(AUTOMATION_TOOL_VOCABULARY),
    },
    {
      id: SERVICE_CATEGORY_VOCABULARY,
      description: `Service categories of the Research Infrastructure Metrics Ontology (RIMO ${seed.ontology.version})`,
      terms: seed.categories.map((category, index) => ({
        key: category.key,
        labels: { en: category.label },
        sortOrder: (index + 1) * 10,
      })),
      usage: inUse(SERVICE_CATEGORY_VOCABULARY),
    },
    // The built-in vocabularies are declared and seeded by core.settings; this module adds the check.
    { id: THEMATIC_CATEGORY_VOCABULARY, usage: inUse(THEMATIC_CATEGORY_VOCABULARY) },
    { id: NECESSITY_VOCABULARY, usage: inUse(NECESSITY_VOCABULARY) },
    { id: AGGREGATE_VOCABULARY, usage: inUse(AGGREGATE_VOCABULARY) },
  ];
}
