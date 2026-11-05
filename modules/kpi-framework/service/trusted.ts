// The trusted read of the effective KPI set (M10 sprint 2, ADR-0041 "Amended in sprint 2"): the rows a service may report with
// what a writer of values needs to check them (value type, unit, bounds), and no permission check. The caller checks its own
// (`kpi.ingestion` calls it after its scoped `measurement.submit`), so a token needs the scopes of the route and of that one
// permission and not those of every read on the way. It is the same set `serviceKpis.get` answers with, read through the same
// function, so there is one rule.
import type { Db } from '@scorpion/kernel';
import { asc, eq, inArray } from 'drizzle-orm';
import { evaluation, indicator, serviceSet } from '../db/schema.ts';
import { effectiveSet } from './effective.ts';
import { iriFor } from './iri.ts';

/** A row of the effective set of a service, with the bounds of its indicator. Never a value of a measurement. */
export interface EffectiveIndicatorRow {
  indicatorId: string;
  name: string;
  valueType: string;
  unit: string | null;
  /** A term of the vocabulary `thematic-category` (M11: `kpi.analytics` filters by it). */
  thematic: string;
  /** A term of the vocabulary `necessity`; `optional` for an extra. */
  necessity: string;
  source: 'set' | 'extra';
  min: number | null;
  max: number | null;
}

const numberOrNull = (value: string | null) => (value === null ? null : Number(value));

/**
 * The effective KPI set of a service with the bounds of each indicator, in the usual order (set rows, then extras, each by name
 * without case, then name, then id). A service that does not exist or has no KPIs gives `[]`. A trusted read: it checks no
 * permission and names no caller; the caller checks its own, and checks that the service exists.
 */
export async function effectiveIndicatorsAsSystem(
  db: Pick<Db, 'select'>,
  serviceId: string,
): Promise<EffectiveIndicatorRow[]> {
  const { rows } = await effectiveSet(db, serviceId);
  if (rows.length === 0) return [];
  const bounds = await db
    .select({ id: indicator.id, min: indicator.minValue, max: indicator.maxValue })
    .from(indicator)
    .where(
      inArray(
        indicator.id,
        rows.map((row) => row.indicatorId),
      ),
    );
  const byId = new Map(bounds.map((row) => [row.id, row]));
  return rows.map((row) => ({
    indicatorId: row.indicatorId,
    name: row.name,
    valueType: row.valueType,
    unit: row.unit,
    thematic: row.thematic,
    necessity: row.necessity,
    source: row.source,
    min: numberOrNull(byId.get(row.indicatorId)?.min ?? null),
    max: numberOrNull(byId.get(row.indicatorId)?.max ?? null),
  }));
}

/** What the reads of measurements show of an indicator, whether or not a service still has it: the descriptive fields only. */
export interface IndicatorRowAsSystem {
  id: string;
  /** The identifier of the indicator; it identifies, it does not dereference. */
  iri: string;
  name: string;
  valueType: string;
  unit: string | null;
  /** A term of the vocabulary `thematic-category`. */
  thematic: string;
}

/**
 * Indicators by id (at most 5 000; an id that does not exist or is not an id is left out), for a module that keeps rows about
 * an indicator and must show them after the service dropped it (a measurement stays when its KPI leaves the set). A trusted
 * read: it checks no permission; the caller checks its own. It returns descriptive fields and never an audit column.
 */
export async function indicatorsByIdAsSystem(
  db: Pick<Db, 'select'>,
  iriBase: () => Promise<string>,
  ids: readonly string[],
): Promise<IndicatorRowAsSystem[]> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, 5000);
  if (wanted.length === 0) return [];
  const [rows, base] = await Promise.all([
    db
      .select({
        id: indicator.id,
        slug: indicator.slug,
        name: indicator.name,
        valueType: indicator.valueType,
        unit: indicator.unit,
        thematic: indicator.thematic,
      })
      .from(indicator)
      .where(inArray(indicator.id, wanted)),
    iriBase(),
  ]);
  return rows.map((row) => ({
    id: row.id,
    iri: iriFor('indicator', row.slug, base),
    name: row.name,
    valueType: row.valueType,
    unit: row.unit,
    thematic: row.thematic,
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most services `servicesOfSetAsSystem` returns. */
export const MAX_SERVICES_OF_SET = 5000;

/** The KPI set a service has and, when the set has one, its headline with what a reader needs to use it (M12 sprint 2). */
export interface EvaluationOfService {
  setId: string;
  /** The headline of the set, `null` when the set has none (an administrator has not set it, or removed its indicator from the set). */
  headline: {
    indicatorId: string;
    name: string;
    valueType: string;
    unit: string | null;
    /** A term of the vocabulary `aggregate`. */
    aggregate: string;
  } | null;
}

/**
 * The set a service has now and the evaluation of that set (the current one, not the one of an earlier year), or `null` when the service has no
 * set. A set with no evaluation gives `headline: null`; an evaluation never names an indicator that left the set (the key refuses it, and
 * `sets.setIndicators` removes the evaluation with it), so that case reads as no headline. A trusted read: it checks no permission and names no
 * caller; the caller checks its own and that the service exists. Descriptive fields only.
 */
export async function evaluationOfServiceAsSystem(
  db: Pick<Db, 'select'>,
  serviceId: string,
): Promise<EvaluationOfService | null> {
  if (!UUID.test(serviceId)) return null;
  const [row] = await db
    .select({
      setId: serviceSet.setId,
      indicatorId: evaluation.indicatorId,
      aggregate: evaluation.aggregate,
      name: indicator.name,
      valueType: indicator.valueType,
      unit: indicator.unit,
    })
    .from(serviceSet)
    .leftJoin(evaluation, eq(evaluation.setId, serviceSet.setId))
    .leftJoin(indicator, eq(indicator.id, evaluation.indicatorId))
    .where(eq(serviceSet.serviceId, serviceId));
  if (!row) return null;
  return {
    setId: row.setId,
    headline:
      row.indicatorId === null || row.aggregate === null || row.name === null
        ? null
        : {
            indicatorId: row.indicatorId,
            name: row.name,
            valueType: row.valueType!,
            unit: row.unit,
            aggregate: row.aggregate,
          },
  };
}

/**
 * The ids of the services that have the set, sorted by id, at most 5 000 (the caller that needs more asks again from the last id). `[]` for a set
 * no service has, one that does not exist and an id that is no id. A trusted read: no permission, ids only.
 */
export async function servicesOfSetAsSystem(
  db: Pick<Db, 'select'>,
  setId: string,
): Promise<string[]> {
  if (!UUID.test(setId)) return [];
  const rows = await db
    .select({ serviceId: serviceSet.serviceId })
    .from(serviceSet)
    .where(eq(serviceSet.setId, setId))
    .orderBy(asc(serviceSet.serviceId))
    .limit(MAX_SERVICES_OF_SET);
  return rows.map((row) => row.serviceId);
}
