// The catalogue: the read model of the services screen (ADR-0035). A tested query function, not a view: it
// closes defect 2 (the old `service_view` joined every service to every consortium). One query per concern:
// the page of rows, the total, the organisation links of the rows on the page, and one count per facet. A
// service is a row of `svc_service` and nothing else joins to it, so it appears once whatever the number of
// its consortia; a consortium filter is an `exists` on the links, never a join.
//
// Facets count over the set filtered by the search and by *all the other* facets (Decision 13): OR within a
// facet, AND across facets, so a person sees what one more choice would give. A value that no service has
// in the current set shows with count 0 only when it is selected. The facets come from the registry
// `service.facet`; nothing here names one.
import { Invalid } from '@scorpion/contracts';
import type { Db } from '@scorpion/kernel';
import { and, asc, desc, sql, type SQL } from 'drizzle-orm';
import { service, serviceOrganisation } from '../db/schema.ts';
import { escapeLike } from './fields.ts';
import { OWNER_ROLE } from './permissions.ts';
import {
  FACET_EMPTY,
  SORT_BY_OWNER,
  type CatalogueSort,
  type FacetEntry,
  type FacetEnv,
  type FacetSelection,
} from './registries.ts';
import type { ServiceOrganisation } from './services.ts';

/** The most values one facet may be given and the longest one: a bound on the request, not a list of values. */
export const MAX_FILTER_VALUES = 50;
export const MAX_FILTER_VALUE_LENGTH = 100;
export const MAX_SEARCH_LENGTH = 100;
const MAX_FILTERS = 40;

export interface CatalogueQuery {
  q?: string | undefined;
  /** The chosen values by facet id; `FACET_EMPTY` stands for the services that have none. */
  filters?: Readonly<Record<string, readonly string[]>> | undefined;
  sort?: CatalogueSort | undefined;
  dir?: 'asc' | 'desc' | undefined;
}

/** What a row of the catalogue shows: never the contact point, `sameAs` or the description. */
export interface CatalogueRow {
  id: string;
  slug: string;
  name: string;
  stage: string;
  license: string | null;
  /** The icon as a path below the base path; absent without an icon. */
  iconUrl?: string;
  public: boolean;
  /** The organisation that owns the service; `null` only for a record the roles do not describe. */
  provider: ServiceOrganisation | null;
  /** Zero, one or many; by name. */
  consortia: ServiceOrganisation[];
}

export interface CatalogueFacetValue {
  /** The value to send back as a filter; `FACET_EMPTY` for the services that have none. */
  key: string;
  label: string;
  count: number;
  selected: boolean;
  /** Set for the value that stands for "none". */
  empty?: true;
}

export interface CatalogueFacet {
  id: string;
  label: string;
  labels: { en: string; de?: string | undefined };
  values: CatalogueFacetValue[];
}

const localised = (labels: { en: string; de?: string | undefined }, locale: string) =>
  (labels as Record<string, string | undefined>)[locale] ?? labels.en;

/** Splits the chosen values of one facet into real keys and the "none" choice. */
export function selectionOf(values: readonly string[]): FacetSelection {
  return {
    keys: [...new Set(values.filter((value) => value !== FACET_EMPTY))],
    empty: values.includes(FACET_EMPTY),
  };
}

const isActive = (selection: FacetSelection) => selection.keys.length > 0 || selection.empty;

/** The search as a condition: slug or name, without case, with `%`, `_` and `\` taken literally. */
export function searchCondition(q: string | undefined): SQL | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  const pattern = `%${escapeLike(text)}%`;
  return sql`(${service.slug} ilike ${pattern} escape '\\' or ${service.name} ilike ${pattern} escape '\\')`;
}

/**
 * The condition of the search and of every facet that has a choice except `except` (AND across facets,
 * each facet OR within itself). With no `except` it is the condition of the rows; with a facet's id it is
 * the set that facet counts over.
 */
export function catalogueCondition(
  facets: readonly FacetEntry[],
  query: Pick<CatalogueQuery, 'q' | 'filters'>,
  except?: string,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [searchCondition(query.q)];
  for (const facet of facets) {
    if (facet.id === except) continue;
    const selection = selectionOf(query.filters?.[facet.id] ?? []);
    if (isActive(selection)) conditions.push(facet.where(selection, sql`${service.id}`));
  }
  return and(...conditions);
}

export interface CatalogueDeps {
  db: Db;
  facets: readonly FacetEntry[];
  /** The organisation links of these services with their names: one query for any number of services. */
  organisationsOf: (ids: readonly string[]) => Promise<Map<string, ServiceOrganisation[]>>;
  iconPath: (hash: string) => string;
  env: (locale: string) => FacetEnv;
}

type Row = typeof service.$inferSelect;

export function createCatalogue(deps: CatalogueDeps) {
  const { db } = deps;
  const ordered = [...deps.facets].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  /** 422 for a facet nobody registered and for a value that names nothing, so a typo never reads as "no results". */
  async function validate(filters: CatalogueQuery['filters'] = {}, locale: string): Promise<void> {
    if (Object.keys(filters).length > MAX_FILTERS) {
      throw new Invalid('The request is not valid.', [
        { in: 'query', path: 'filters', message: 'Too many filters.' },
      ]);
    }
    const known = new Map(ordered.map((facet) => [facet.id, facet]));
    const problems: { in: 'query'; path: string; message: string }[] = [];
    const env = deps.env(locale);
    for (const [id, values] of Object.entries(filters)) {
      const facet = known.get(id);
      if (!facet) {
        problems.push({ in: 'query', path: id, message: `There is no filter "${id}".` });
        continue;
      }
      if (values.length > MAX_FILTER_VALUES) {
        problems.push({
          in: 'query',
          path: id,
          message: `Choose at most ${MAX_FILTER_VALUES} values.`,
        });
        continue;
      }
      if (values.some((value) => value === '' || value.length > MAX_FILTER_VALUE_LENGTH)) {
        problems.push({ in: 'query', path: id, message: 'A value is empty or too long.' });
        continue;
      }
      const { keys, empty } = selectionOf(values);
      if (empty && !facet.emptyLabel) {
        problems.push({
          in: 'query',
          path: id,
          message: `"${FACET_EMPTY}" is not a value of this filter.`,
        });
        continue;
      }
      const unknown = (await facet.unknownOf?.(keys, env, db)) ?? [];
      for (const value of unknown) {
        problems.push({ in: 'query', path: id, message: `"${value}" is not a known value.` });
      }
    }
    if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
  }

  /** The order of the providers by name, as a position the query can sort by (the names live in another module). */
  async function providerPositions(locale: string): Promise<SQL> {
    const held = await db
      .selectDistinct({ id: serviceOrganisation.organisationId })
      .from(serviceOrganisation)
      .where(sql`${serviceOrganisation.role} = ${OWNER_ROLE}`);
    const names = await deps.env(locale).organisationNames(held.map((row) => row.id));
    const sorted = held
      .map((row) => ({ id: row.id, name: (names.get(row.id) ?? '').toLowerCase() }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const list = sql.join(
      sorted.map((entry) => sql`${entry.id}`),
      sql`, `,
    );
    return sql`coalesce((select t.pos from unnest(array[${list}]::uuid[]) with ordinality as t(id, pos) where t.id = (select so.organisation_id from ${serviceOrganisation} so where so.service_id = ${service.id} and so.role = ${OWNER_ROLE} limit 1)), 2147483647)`;
  }

  const summary = (row: Row, organisations: ServiceOrganisation[]): CatalogueRow => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    stage: row.stage,
    license: row.license,
    ...(row.iconHash && { iconUrl: deps.iconPath(row.iconHash) }),
    public: row.public,
    provider: organisations.find((organisation) => organisation.role === OWNER_ROLE) ?? null,
    consortia: organisations.filter((organisation) => organisation.role !== OWNER_ROLE),
  });

  return {
    validate,

    /** The page of rows in the order asked for (the sort key, then the id) and the number of services in all. */
    async rows(
      query: CatalogueQuery,
      page: { page: number; pageSize: number },
      locale: string,
    ): Promise<{ rows: CatalogueRow[]; total: number }> {
      await validate(query.filters, locale);
      const where = catalogueCondition(ordered, query);
      const direction = query.dir === 'desc' ? desc : asc;
      const key = query.sort ?? 'name';
      const sortKey =
        key === 'slug'
          ? sql`lower(${service.slug})`
          : key === 'stage'
            ? sql`${service.stage}`
            : key === SORT_BY_OWNER
              ? await providerPositions(locale)
              : sql`lower(${service.name})`;
      const [rows, [count]] = await Promise.all([
        db
          .select()
          .from(service)
          .where(where)
          .orderBy(direction(sortKey), asc(service.id))
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(service)
          .where(where),
      ]);
      const organisations = await deps.organisationsOf(rows.map((row) => row.id));
      return {
        rows: rows.map((row) => summary(row, organisations.get(row.id) ?? [])),
        total: count?.total ?? 0,
      };
    },

    /** Every facet with its values counted over the set the *other* facets and the search leave. */
    async facets(query: CatalogueQuery, locale: string): Promise<CatalogueFacet[]> {
      await validate(query.filters, locale);
      const env = deps.env(locale);
      return Promise.all(
        ordered.map(async (facet): Promise<CatalogueFacet> => {
          const scope = catalogueCondition(ordered, query, facet.id);
          const matching = db.select({ id: service.id }).from(service).where(scope).getSQL();
          const counted = await facet.values(sql`${matching}`, db);
          const selection = selectionOf(query.filters?.[facet.id] ?? []);
          const counts = new Map(counted.map((value) => [value.key, value.count]));
          // A chosen value that the current set has no service for is shown with count 0.
          const keys = [
            ...new Set([
              ...counted.flatMap((value) => (value.key === null ? [] : [value.key])),
              ...selection.keys,
            ]),
          ];
          const labels: Map<string, string> =
            (keys.length > 0 ? await facet.labelsOf?.(keys, env) : undefined) ??
            new Map<string, string>();
          const values: CatalogueFacetValue[] = keys.map((key) => ({
            key,
            label: labels.get(key) ?? key,
            count: counts.get(key) ?? 0,
            selected: selection.keys.includes(key),
          }));
          // Most services first, then by label, so the choice that matters is on top.
          values.sort(
            (a, b) =>
              b.count - a.count ||
              a.label.localeCompare(b.label, locale) ||
              a.key.localeCompare(b.key),
          );
          const none = counts.get(null) ?? 0;
          if (facet.emptyLabel && (none > 0 || selection.empty)) {
            values.push({
              key: FACET_EMPTY,
              label: localised(facet.emptyLabel, locale),
              count: none,
              selected: selection.empty,
              empty: true,
            });
          }
          return {
            id: facet.id,
            label: localised(facet.labels, locale),
            labels: facet.labels,
            values,
          };
        }),
      );
    },
  };
}

export type Catalogue = ReturnType<typeof createCatalogue>;
