// The four facets this module contributes to `service.facet` (ADR-0035): consortium, stage, licence and
// provider, and the builder for a facet whose value lives in `svc_field_value` (the category of M9). The
// catalogue (`catalogue.ts`) builds the conditions and the set to count over; an entry only knows its own
// column, role or field key, and never names a table of another module.
import type { Db } from '@scorpion/kernel';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { fieldValue, service, serviceOrganisation } from '../db/schema.ts';
import { BRAND_ROLE, OWNER_ROLE } from './permissions.ts';
import type { FacetEntry, FacetSelection, FacetValue } from './registries.ts';

type Described = Pick<FacetEntry, 'labels' | 'order' | 'emptyLabel'>;

/** Orders values by key, the services with none last; the catalogue sorts by count where it wants to. */
const byKey = (a: FacetValue, b: FacetValue) =>
  a.key === b.key ? 0 : a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key);

/** `keys` (OR), and the services with none when `empty`; nothing is chosen only when both are empty. */
const either = (have: SQL | undefined, none: SQL, selection: FacetSelection): SQL =>
  or(selection.keys.length > 0 ? have : undefined, selection.empty ? none : undefined) ??
  sql`false`;

function columnFacet(
  id: string,
  column: typeof service.stage | typeof service.license,
  entry: Described,
  vocabulary?: string,
): FacetEntry {
  return {
    id,
    ...entry,
    where: (selection) =>
      either(
        selection.keys.length > 0 ? inArray(column, [...selection.keys]) : undefined,
        isNull(column),
        selection,
      ),
    async values(matching: SQL, db: Db) {
      const rows = await db
        .select({ key: column, count: sql<number>`count(*)::int` })
        .from(service)
        .where(sql`${service.id} in (${matching})`)
        .groupBy(column);
      return rows.map((row) => ({ key: row.key, count: row.count })).sort(byKey);
    },
    ...(vocabulary && {
      async labelsOf(_keys, env) {
        return env.termLabels(vocabulary);
      },
      async unknownOf(keys, env) {
        const known = await env.termLabels(vocabulary);
        return keys.filter((key) => !known.has(key));
      },
    }),
  };
}

function roleFacet(id: string, role: string, entry: Described): FacetEntry {
  const holds = (serviceId: SQL) =>
    sql`exists (select 1 from ${serviceOrganisation} where ${serviceOrganisation.serviceId} = ${serviceId} and ${serviceOrganisation.role} = ${role})`;
  return {
    id,
    ...entry,
    where: (selection, serviceId) =>
      either(
        sql`exists (select 1 from ${serviceOrganisation} where ${serviceOrganisation.serviceId} = ${serviceId} and ${serviceOrganisation.role} = ${role} and ${inArray(serviceOrganisation.organisationId, [...selection.keys])})`,
        sql`not ${holds(serviceId)}`,
        selection,
      ),
    async values(matching: SQL, db: Db) {
      const held = await db
        .select({
          key: serviceOrganisation.organisationId,
          count: sql<number>`count(distinct ${serviceOrganisation.serviceId})::int`,
        })
        .from(serviceOrganisation)
        .where(
          and(
            eq(serviceOrganisation.role, role),
            sql`${serviceOrganisation.serviceId} in (${matching})`,
          ),
        )
        .groupBy(serviceOrganisation.organisationId);
      const [without] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(service)
        .where(and(sql`${service.id} in (${matching})`, sql`not ${holds(sql`${service.id}`)}`));
      const values: FacetValue[] = held.map((row) => ({ key: row.key, count: row.count }));
      if (without && without.count > 0) values.push({ key: null, count: without.count });
      return values.sort(byKey);
    },
    async labelsOf(keys, env) {
      return env.organisationNames(keys);
    },
    async unknownOf(keys, env) {
      const known = await env.organisationNames(keys);
      return keys.filter((key) => !known.has(key));
    },
  };
}

/**
 * A facet over a configured field kept in `svc_field_value` (ADR-0035): a string value, or a list of them
 * (a multi-select), counted once per service. This is what M9's category contributes, so it needs no SQL
 * of its own and no knowledge of the table. `labelsOf` names the keys when the key is not the label.
 */
export function fieldValueFacet(
  id: string,
  fieldKey: string,
  entry: Described & { labelsOf?: FacetEntry['labelsOf'] },
): FacetEntry {
  const has = (serviceId: SQL) =>
    sql`exists (select 1 from ${fieldValue} f where f.service_id = ${serviceId} and f.field_key = ${fieldKey} and not (jsonb_typeof(f.value) = 'array' and jsonb_array_length(f.value) = 0))`;
  const { labelsOf, ...described } = entry;
  return {
    id,
    ...described,
    ...(labelsOf && { labelsOf }),
    where: (selection, serviceId) =>
      either(
        sql`exists (select 1 from ${fieldValue} f, jsonb_array_elements_text(case when jsonb_typeof(f.value) = 'array' then f.value else jsonb_build_array(f.value) end) as v(text) where f.service_id = ${serviceId} and f.field_key = ${fieldKey} and v.text in (${sql.join(
          selection.keys.map((key) => sql`${key}`),
          sql`, `,
        )}))`,
        sql`not ${has(serviceId)}`,
        selection,
      ),
    async values(matching: SQL, db: Db) {
      const held = await db.execute<{ key: string; count: number }>(
        sql`select v.text as key, count(distinct f.service_id)::int as count
          from ${fieldValue} f, jsonb_array_elements_text(case when jsonb_typeof(f.value) = 'array' then f.value else jsonb_build_array(f.value) end) as v(text)
          where f.field_key = ${fieldKey} and f.service_id in (${matching})
          group by v.text`,
      );
      const [without] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(service)
        .where(and(sql`${service.id} in (${matching})`, sql`not ${has(sql`${service.id}`)}`));
      const values: FacetValue[] = held.rows.map((row) => ({ key: row.key, count: row.count }));
      if (without && without.count > 0) values.push({ key: null, count: without.count });
      return values.sort(byKey);
    },
  };
}

export const SEED_FACETS: FacetEntry[] = [
  roleFacet('consortium', BRAND_ROLE, {
    labels: { en: 'Consortium', de: 'Konsortium' },
    order: 10,
    emptyLabel: { en: 'No consortium', de: 'Kein Konsortium' },
  }),
  columnFacet(
    'stage',
    service.stage,
    {
      labels: { en: 'Stage', de: 'Stufe' },
      order: 20,
    },
    'stage',
  ),
  {
    ...columnFacet('license', service.license, {
      labels: { en: 'Licence', de: 'Lizenz' },
      order: 30,
      emptyLabel: { en: 'Unknown', de: 'Unbekannt' },
    }),
    // A licence a service has can always be chosen, even when SPDX no longer lists it: the facet counts it.
    async unknownOf(keys, env, db) {
      const held = await db
        .selectDistinct({ key: service.license })
        .from(service)
        .where(inArray(service.license, [...keys]));
      const stored = new Set(held.map((row) => row.key));
      const found = await Promise.all(
        keys.map((key) => (stored.has(key) ? true : env.findLicence(key))),
      );
      return keys.filter((_key, index) => !found[index]);
    },
  },
  roleFacet('provider', OWNER_ROLE, {
    labels: { en: 'Provider', de: 'Anbieter' },
    order: 40,
  }),
];
