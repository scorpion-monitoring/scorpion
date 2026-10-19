// The public API reads of kpi.framework (`/api/v1`, ADR-0037): the KPI sets as `categories` and the indicators.
// They keep the legacy shape and add fields. A token with `kpi.framework.v1.read` reaches them; every list is
// sorted by a stable key, then the id, so pages never overlap. The filters filter the rows and the count alike
// (defect 15: the legacy `totalCount` ignored them). An unknown filter value is 422 naming the parameter.
import { Invalid, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { Db, ModuleContext } from '@scorpion/kernel';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import seed from '../config/rimo-seed.json' with { type: 'json' };
import { unitMetadata } from '../config/units.ts';
import { indicator, indicatorMeans, indicatorTool, kpiSet, kpiSetIndicator } from '../db/schema.ts';
import { effectiveSet } from './effective.ts';
import { iriFor } from './iri.ts';
import { PERMISSION_V1_READ } from './permissions.ts';
import { iriBaseOf } from './shared.ts';

export interface CategoryV1 {
  id: string;
  name: string;
  iri: string;
  description: string | null;
  rimoCategory: string | null;
  indicators: number;
}

export interface UnitV1 {
  key: string;
  symbol: string | null;
  iri: string;
}

export interface IndicatorV1 {
  id: string;
  iri: string;
  name: string;
  description: string | null;
  example: string | null;
  /** The legacy name of the value type: `number` for `integer`, otherwise the key of `kpi.valueType`. */
  type: string;
  valueType: string;
  qualitative: boolean;
  thematicCategory: string;
  unit: UnitV1 | null;
  min: number | null;
  max: number | null;
  measuredBy: string[];
  canBeAutomatedBy: string[];
  /** Whether the indicator is in the effective KPI set of the `service` asked for; `false` without one. */
  selected: boolean;
  /** Its necessity in the `category` asked for, else in the service's effective set; `null` when neither applies. */
  necessity: string | null;
}

export interface IndicatorsV1Filter {
  /** The name of a KPI set, without case. */
  category?: string | undefined;
  /** The abbreviation (slug) of a service, without case. */
  service?: string | undefined;
}

export interface V1Service {
  categories(
    actor: Actor,
    page: { page: number; pageSize: number },
  ): Promise<{ categories: CategoryV1[]; total: number }>;
  indicators(
    actor: Actor,
    filter: IndicatorsV1Filter,
    page: { page: number; pageSize: number },
  ): Promise<{ indicators: IndicatorV1[]; total: number }>;
}

export interface V1Deps {
  authz: Pick<AuthzService, 'require'>;
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
}

/** The legacy API called an integer `number`; every other type keeps its key. */
export const legacyType = (valueType: string): string =>
  valueType === 'integer' ? 'number' : valueType;

const RIMO_IRI = new Map(seed.categories.map((category) => [category.key, category.iri]));

export function createV1Service(ctx: ModuleContext, deps: V1Deps): V1Service {
  const db: Db = ctx.db;
  const iriBase = iriBaseOf(ctx);

  return {
    async categories(actor, page) {
      await deps.authz.require(actor, PERMISSION_V1_READ);
      const [rows, [count], base] = await Promise.all([
        db
          .select()
          .from(kpiSet)
          .orderBy(sql`lower(${kpiSet.name})`, kpiSet.name, kpiSet.id)
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db.select({ total: sql<number>`count(*)::int` }).from(kpiSet),
        iriBase(),
      ]);
      const counts =
        rows.length === 0
          ? []
          : await db
              .select({ setId: kpiSetIndicator.setId, n: sql<number>`count(*)::int` })
              .from(kpiSetIndicator)
              .where(
                inArray(
                  kpiSetIndicator.setId,
                  rows.map((row) => row.id),
                ),
              )
              .groupBy(kpiSetIndicator.setId);
      const counted = new Map(counts.map((row) => [row.setId, row.n]));
      return {
        categories: rows.map((row) => ({
          id: row.id,
          name: row.name,
          iri: iriFor('set', row.slug, base),
          description: row.description,
          rimoCategory: row.rimoCategory ? (RIMO_IRI.get(row.rimoCategory) ?? null) : null,
          indicators: counted.get(row.id) ?? 0,
        })),
        total: count?.total ?? 0,
      };
    },

    async indicators(actor, filter, page) {
      await deps.authz.require(actor, PERMISSION_V1_READ);
      const problems: FieldProblem[] = [];
      let setId: string | undefined;
      if (filter.category !== undefined) {
        const [found] = await db
          .select({ id: kpiSet.id })
          .from(kpiSet)
          .where(sql`lower(${kpiSet.name}) = lower(${filter.category})`);
        setId = found?.id;
        if (!setId)
          problems.push({
            in: 'query',
            path: 'category',
            message: `"${filter.category.slice(0, 64)}" is not the name of a KPI set.`,
          });
      }
      let serviceId: string | undefined;
      if (filter.service !== undefined) {
        serviceId = (await deps.services.findBySlugAsSystem(filter.service))?.id;
        if (!serviceId)
          problems.push({
            in: 'query',
            path: 'service',
            message: `"${filter.service.slice(0, 64)}" is not the abbreviation of a service.`,
          });
      }
      if (problems.length > 0) throw new Invalid('The request is not valid.', problems);

      // The rows of the asked-for set (with their necessity), or every indicator.
      const where: SQL | undefined = setId ? eq(kpiSetIndicator.setId, setId) : undefined;
      const select = db
        .select({
          row: indicator,
          necessity: setId ? kpiSetIndicator.necessity : sql<string | null>`null`,
        })
        .from(indicator);
      const counted = db.select({ total: sql<number>`count(*)::int` }).from(indicator);
      const [rows, [count], base, effective] = await Promise.all([
        (setId
          ? select.innerJoin(kpiSetIndicator, eq(kpiSetIndicator.indicatorId, indicator.id))
          : select
        )
          .where(where)
          .orderBy(sql`lower(${indicator.name})`, indicator.name, indicator.id)
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        (setId
          ? counted.innerJoin(kpiSetIndicator, eq(kpiSetIndicator.indicatorId, indicator.id))
          : counted
        ).where(where),
        iriBase(),
        serviceId ? effectiveSet(db, serviceId) : undefined,
      ]);
      const chosen = new Map(
        (effective?.rows ?? []).map((row) => [row.indicatorId, row.necessity]),
      );
      const ids = rows.map(({ row }) => row.id);
      const [means, tools] =
        ids.length === 0
          ? [[], []]
          : await Promise.all([
              db
                .select()
                .from(indicatorMeans)
                .where(inArray(indicatorMeans.indicatorId, ids))
                .orderBy(indicatorMeans.termKey),
              db
                .select()
                .from(indicatorTool)
                .where(inArray(indicatorTool.indicatorId, ids))
                .orderBy(indicatorTool.termKey),
            ]);
      const termsOf = (links: readonly { indicatorId: string; termKey: string }[], id: string) =>
        links.filter((link) => link.indicatorId === id).map((link) => link.termKey);
      const number = (value: string | null) => (value === null ? null : Number(value));

      return {
        indicators: rows.map(({ row, necessity }) => {
          const meta = row.unit ? unitMetadata(row.unit) : undefined;
          return {
            id: row.id,
            iri: iriFor('indicator', row.slug, base),
            name: row.name,
            description: row.description,
            example: row.example,
            type: legacyType(row.valueType),
            valueType: row.valueType,
            qualitative: row.qualitative,
            thematicCategory: row.thematic,
            unit: row.unit
              ? {
                  key: row.unit,
                  symbol: meta?.symbol ?? null,
                  iri: meta?.iri ?? iriFor('unit', row.unit, base),
                }
              : null,
            min: number(row.minValue),
            max: number(row.maxValue),
            measuredBy: termsOf(means, row.id),
            canBeAutomatedBy: termsOf(tools, row.id),
            selected: chosen.has(row.id),
            necessity: necessity ?? chosen.get(row.id) ?? null,
          };
        }),
        total: count?.total ?? 0,
      };
    },
  };
}
