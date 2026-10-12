// The four facets this module contributes to `service.facet` (ADR-0035): consortium, stage, licence and
// provider. The catalogue (sprint 4) builds `scope` from the search and the other facets' conditions and
// asks each facet to count its values over the services that match it; here a facet only knows its own
// column or role. Another module adds one (M9: the category) by contributing an entry.
import type { Db } from '@scorpion/kernel';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { service, serviceOrganisation } from '../db/schema.ts';
import type { FacetEntry, FacetValue } from './registries.ts';

/** Orders values by key, the services with none last; the catalogue sorts by count where it wants to. */
const byKey = (a: FacetValue, b: FacetValue) =>
  a.key === b.key ? 0 : a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key);

function columnFacet(
  id: string,
  column: typeof service.stage | typeof service.license,
  entry: Pick<FacetEntry, 'labels' | 'order' | 'emptyLabel'>,
): FacetEntry {
  return {
    id,
    ...entry,
    where: (selected) => (selected.length > 0 ? inArray(column, [...selected]) : sql`false`) as SQL,
    async values(scope: SQL | undefined, db: Db) {
      const rows = await db
        .select({ key: column, count: sql<number>`count(*)::int` })
        .from(service)
        .where(scope)
        .groupBy(column);
      return rows.map((row) => ({ key: row.key, count: row.count })).sort(byKey);
    },
  };
}

function roleFacet(
  id: string,
  role: string,
  entry: Pick<FacetEntry, 'labels' | 'order' | 'emptyLabel'>,
): FacetEntry {
  return {
    id,
    ...entry,
    where: (selected) =>
      selected.length === 0
        ? sql`false`
        : sql`exists (select 1 from ${serviceOrganisation} where ${serviceOrganisation.serviceId} = ${service.id} and ${serviceOrganisation.role} = ${role} and ${inArray(serviceOrganisation.organisationId, [...selected])})`,
    async values(scope: SQL | undefined, db: Db) {
      const held = await db
        .select({ key: serviceOrganisation.organisationId, count: sql<number>`count(*)::int` })
        .from(serviceOrganisation)
        .innerJoin(service, eq(service.id, serviceOrganisation.serviceId))
        .where(and(eq(serviceOrganisation.role, role), scope))
        .groupBy(serviceOrganisation.organisationId);
      const [without] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(service)
        .leftJoin(
          serviceOrganisation,
          and(eq(serviceOrganisation.serviceId, service.id), eq(serviceOrganisation.role, role)),
        )
        .where(and(isNull(serviceOrganisation.id), scope));
      const values: FacetValue[] = held.map((row) => ({ key: row.key, count: row.count }));
      if (without && without.count > 0) values.push({ key: null, count: without.count });
      return values.sort(byKey);
    },
  };
}

export const SEED_FACETS: FacetEntry[] = [
  roleFacet('consortium', 'consortium', {
    labels: { en: 'Consortium', de: 'Konsortium' },
    order: 10,
    emptyLabel: { en: 'No consortium', de: 'Kein Konsortium' },
  }),
  columnFacet('stage', service.stage, {
    labels: { en: 'Stage', de: 'Stufe' },
    order: 20,
  }),
  columnFacet('license', service.license, {
    labels: { en: 'Licence', de: 'Lizenz' },
    order: 30,
    emptyLabel: { en: 'Unknown', de: 'Unbekannt' },
  }),
  roleFacet('provider', 'provider', {
    labels: { en: 'Provider', de: 'Anbieter' },
    order: 40,
  }),
];
