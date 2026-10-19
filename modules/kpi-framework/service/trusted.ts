// The trusted read of the effective KPI set (M10 sprint 2, ADR-0041 "Amended in sprint 2"): the rows a service may report with
// what a writer of values needs to check them (value type, unit, bounds), and no permission check. The caller checks its own
// (`kpi.ingestion` calls it after its scoped `measurement.submit`), so a token needs the scopes of the route and of that one
// permission and not those of every read on the way. It is the same set `serviceKpis.get` answers with, read through the same
// function, so there is one rule.
import type { Db } from '@scorpion/kernel';
import { inArray } from 'drizzle-orm';
import { indicator } from '../db/schema.ts';
import { effectiveSet } from './effective.ts';
import { iriFor } from './iri.ts';

/** A row of the effective set of a service, with the bounds of its indicator. Never a value of a measurement. */
export interface EffectiveIndicatorRow {
  indicatorId: string;
  name: string;
  valueType: string;
  unit: string | null;
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
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
