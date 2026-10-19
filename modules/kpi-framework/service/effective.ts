// The effective KPI set of a service (plan §7 item 2): the rows of its KPI set with their necessity, plus the
// extra indicators it opted into that the set does not already contain, each with the necessity `optional`.
// An indicator in the set cannot be an extra; the set's rows are never removed or changed by an extra; the
// order is stable (set rows first, then the extras, each by name without case, then name, then id).
//
// `mergeEffective` is the rule, pure and without a database, so the browser draws the same list the server
// answers with (the wizard shows it before the service exists). `effectiveSet` is the one query function that
// reads the two tables and applies it.
import type { Db } from '@scorpion/kernel';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  compareIndicators,
  mergeEffective,
  type EffectiveRow,
  type NamedIndicator,
} from './merge.ts';

export {
  compareIndicators,
  EXTRA_NECESSITY,
  mergeEffective,
  type EffectiveRow,
  type NamedIndicator,
} from './merge.ts';
import {
  indicator,
  kpiSet,
  kpiSetIndicator,
  serviceExtraIndicator,
  serviceSet,
} from '../db/schema.ts';

/** The necessity of an extra. A term of the vocabulary `necessity` that every instance is seeded with. */
/** What a row of the effective set tells about its indicator (never a value: those are M10's). */
export interface EffectiveIndicator extends NamedIndicator {
  slug: string;
  valueType: string;
  unit: string | null;
  thematic: string;
  qualitative: boolean;
}

export interface EffectiveSet {
  /** The service's KPI set, or `null` while it has none. */
  set: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    rimoCategory: string | null;
  } | null;
  /** The stored extras, in order, including any that the set contains (a set changed under them). */
  extras: EffectiveIndicator[];
  rows: EffectiveRow<EffectiveIndicator>[];
}

const columns = {
  indicatorId: indicator.id,
  slug: indicator.slug,
  name: indicator.name,
  valueType: indicator.valueType,
  unit: indicator.unit,
  thematic: indicator.thematic,
  qualitative: indicator.qualitative,
};

/**
 * The effective list of a given state: a KPI set (or none) and the stored extras. The one place that reads the rows of
 * a set and applies `mergeEffective`, for the state a service has now (`effectiveSet`) and for one it had in a past
 * month (`kpisInPeriod`). An id that no longer exists (a set or an extra that was deleted) contributes nothing.
 */
export async function effectiveOf(
  db: Pick<Db, 'select'>,
  state: { setId: string | null; extraIds: readonly string[] },
): Promise<EffectiveSet> {
  const [[assigned], extras] = await Promise.all([
    state.setId === null
      ? Promise.resolve([] as EffectiveSet['set'][])
      : db
          .select({
            id: kpiSet.id,
            slug: kpiSet.slug,
            name: kpiSet.name,
            description: kpiSet.description,
            rimoCategory: kpiSet.rimoCategory,
          })
          .from(kpiSet)
          .where(eq(kpiSet.id, state.setId)),
    state.extraIds.length === 0
      ? Promise.resolve([])
      : db
          .select(columns)
          .from(indicator)
          .where(inArray(indicator.id, [...state.extraIds]))
          .orderBy(sql`lower(${indicator.name})`, indicator.name, indicator.id),
  ]);
  const setRows = assigned
    ? await db
        .select({ ...columns, necessity: kpiSetIndicator.necessity })
        .from(kpiSetIndicator)
        .innerJoin(indicator, eq(indicator.id, kpiSetIndicator.indicatorId))
        .where(eq(kpiSetIndicator.setId, assigned.id))
    : [];
  return {
    set: assigned ?? null,
    extras: [...extras].sort(compareIndicators),
    rows: mergeEffective(setRows, extras),
  };
}

/** The effective KPI set of one service: its two links, then `effectiveOf`. Any caller (route, job, export) uses this. */
export async function effectiveSet(
  db: Pick<Db, 'select'>,
  serviceId: string,
): Promise<EffectiveSet> {
  const [[assigned], extras] = await Promise.all([
    db
      .select({ setId: serviceSet.setId })
      .from(serviceSet)
      .where(eq(serviceSet.serviceId, serviceId)),
    db
      .select({ id: serviceExtraIndicator.indicatorId })
      .from(serviceExtraIndicator)
      .where(eq(serviceExtraIndicator.serviceId, serviceId)),
  ]);
  return effectiveOf(db, {
    setId: assigned?.setId ?? null,
    extraIds: extras.map((row) => row.id),
  });
}
