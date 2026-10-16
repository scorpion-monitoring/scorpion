// The indicators: create, read, list, change and delete. The service layer is the only way to change this data
// (CLAUDE.md rule 5). Every method takes the `actor` and checks the permission first; the terms an indicator
// names are checked against their vocabularies before the transaction opens (`checkTerms`), the value type and
// the bounds against the registry (`boundsProblem`), and everything a write touches is one transaction with the
// event in the outbox.
import { Conflict, Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { ids, type Db, type ModuleContext } from '@scorpion/kernel';
import { and, asc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  evaluation,
  indicator,
  indicatorMeans,
  indicatorTool,
  kpiSetIndicator,
} from '../db/schema.ts';
import { Duplicate, InUse, type Use } from './errors.ts';
import {
  createIndicatorSchema,
  parseInput,
  requireId,
  updateIndicatorSchema,
  type CreateIndicatorInput,
  type IndicatorFilter,
  type UpdateIndicatorInput,
} from './input.ts';
import { iriFor } from './iri.ts';
import { PERMISSION_INDICATOR_MANAGE, PERMISSION_INDICATOR_READ } from './permissions.ts';
import { actorId, iriBaseOf, uniqueViolation } from './shared.ts';
import { checkTerms, indicatorTermChecks } from './terms.ts';
import { escapeLike, slugCandidate, slugFromName } from './text.ts';
import { boundsProblem, QUALITATIVE_VALUE_TYPE, type ValueTypeEntry } from './value-types.ts';

type Row = typeof indicator.$inferSelect;

export interface IndicatorView {
  id: string;
  slug: string;
  /** The identifier of the indicator (ADR-0040); it identifies and does not dereference. */
  iri: string;
  name: string;
  description: string | null;
  example: string | null;
  qualitative: boolean;
  valueType: string;
  unit: string | null;
  min: number | null;
  max: number | null;
  thematic: string;
  measuredBy: string[];
  canBeAutomatedBy: string[];
  /** In how many KPI sets the indicator is a row (a delete is refused while this is above 0). */
  setCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ValueTypeView {
  id: string;
  labels: { en: string; de?: string | undefined };
  numeric: boolean;
  range: { min?: number | undefined; max?: number | undefined } | undefined;
  aggregates: string[];
}

export interface IndicatorsService {
  list(
    actor: Actor,
    filter: IndicatorFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ indicators: IndicatorView[]; total: number }>;
  get(actor: Actor, id: string): Promise<IndicatorView>;
  create(actor: Actor, input: CreateIndicatorInput): Promise<IndicatorView>;
  /** Replaces the editable fields (a field left out is cleared); the slug never changes. */
  update(actor: Actor, id: string, input: UpdateIndicatorInput): Promise<IndicatorView>;
  delete(actor: Actor, id: string): Promise<void>;
  /** The registered value types, with what the pages need to draw the form. */
  valueTypes(actor: Actor): Promise<ValueTypeView[]>;
}

export interface IndicatorsDeps {
  authz: Pick<AuthzService, 'require'>;
  settings: Pick<SettingsService, 'validateTerm'>;
  valueTypes: () => readonly ValueTypeEntry[];
}

const CONSTRAINT_FIELDS: Record<string, 'name' | 'slug'> = {
  kpif_indicator_slug_idx: 'slug',
  kpif_indicator_name_idx: 'name',
};

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const numberOrNull = (value: string | null) => (value === null ? null : Number(value));

export function createIndicatorsService(
  ctx: ModuleContext,
  deps: IndicatorsDeps,
): IndicatorsService {
  const db: Db = ctx.db;
  const iriBase = iriBaseOf(ctx);
  const typeOf = (id: string) => deps.valueTypes().find((entry) => entry.id === id);

  /** Rows with their links and their set counts, in the order of `rows`. */
  async function views(rows: readonly Row[]): Promise<IndicatorView[]> {
    if (rows.length === 0) return [];
    const idList = rows.map((row) => row.id);
    const [means, tools, counts, base] = await Promise.all([
      db.select().from(indicatorMeans).where(inArray(indicatorMeans.indicatorId, idList)),
      db.select().from(indicatorTool).where(inArray(indicatorTool.indicatorId, idList)),
      db
        .select({ id: kpiSetIndicator.indicatorId, n: sql<number>`count(*)::int` })
        .from(kpiSetIndicator)
        .where(inArray(kpiSetIndicator.indicatorId, idList))
        .groupBy(kpiSetIndicator.indicatorId),
      iriBase(),
    ]);
    const group = (list: { indicatorId: string; termKey: string }[]) => {
      const map = new Map<string, string[]>();
      for (const link of list)
        (map.get(link.indicatorId) ?? map.set(link.indicatorId, []).get(link.indicatorId)!).push(
          link.termKey,
        );
      for (const keys of map.values()) keys.sort();
      return map;
    };
    const meansOf = group(means);
    const toolsOf = group(tools);
    const countOf = new Map(counts.map((count) => [count.id, count.n]));
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      iri: iriFor('indicator', row.slug, base),
      name: row.name,
      description: row.description,
      example: row.example,
      qualitative: row.qualitative,
      valueType: row.valueType,
      unit: row.unit,
      min: numberOrNull(row.minValue),
      max: numberOrNull(row.maxValue),
      thematic: row.thematic,
      measuredBy: meansOf.get(row.id) ?? [],
      canBeAutomatedBy: toolsOf.get(row.id) ?? [],
      setCount: countOf.get(row.id) ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    }));
  }

  async function load(tx: Pick<Db, 'select'>, id: string, lock = false): Promise<Row> {
    const query = tx.select().from(indicator).where(eq(indicator.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFound('There is no such indicator.');
    return row;
  }

  /**
   * What the registry decides: the value type exists, a qualitative indicator is a `text` one without bounds,
   * and the bounds fit the type. One 422 names every path. Never branches on a type's id: a `numeric` type may
   * have bounds, and the one qualitative type is the constant of the value-type module.
   */
  function checkShape(input: {
    valueType: string;
    qualitative?: boolean | undefined;
    min?: number | null | undefined;
    max?: number | null | undefined;
  }) {
    const problems: FieldProblem[] = [];
    const type = typeOf(input.valueType);
    if (!type) {
      problems.push({
        in: 'body',
        path: 'valueType',
        message: `"${input.valueType}" is not a registered value type.`,
      });
    } else {
      const bad = boundsProblem(type, { min: input.min ?? null, max: input.max ?? null });
      if (bad)
        problems.push({
          in: 'body',
          path: bad.field === 'min' ? 'min' : 'max',
          message: bad.problem,
        });
    }
    if (input.qualitative) {
      if (input.valueType !== QUALITATIVE_VALUE_TYPE)
        problems.push({
          in: 'body',
          path: 'qualitative',
          message: `A qualitative indicator has the value type "${QUALITATIVE_VALUE_TYPE}".`,
        });
      if (input.min != null || input.max != null)
        problems.push({
          in: 'body',
          path: input.min != null ? 'min' : 'max',
          message: 'A qualitative indicator has no bounds.',
        });
    }
    if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
  }

  async function freeSlug(tx: Pick<Db, 'select'>, name: string): Promise<string> {
    const base = slugFromName(name, 'indicator');
    for (let attempt = 1; attempt < 1000; attempt++) {
      const candidate = slugCandidate(base, attempt);
      const [taken] = await tx
        .select({ id: indicator.id })
        .from(indicator)
        .where(sql`lower(${indicator.slug}) = lower(${candidate})`)
        .limit(1);
      if (!taken) return candidate;
    }
    throw new Conflict('No free slug could be made from this name; give one.');
  }

  async function writeLinks(
    tx: Pick<Db, 'insert' | 'delete'>,
    id: string,
    next: { measuredBy: readonly string[]; canBeAutomatedBy: readonly string[] },
    replace: boolean,
  ) {
    if (replace) {
      await tx.delete(indicatorMeans).where(eq(indicatorMeans.indicatorId, id));
      await tx.delete(indicatorTool).where(eq(indicatorTool.indicatorId, id));
    }
    if (next.measuredBy.length > 0)
      await tx
        .insert(indicatorMeans)
        .values(next.measuredBy.map((termKey) => ({ indicatorId: id, termKey })));
    if (next.canBeAutomatedBy.length > 0)
      await tx
        .insert(indicatorTool)
        .values(next.canBeAutomatedBy.map((termKey) => ({ indicatorId: id, termKey })));
  }

  return {
    async valueTypes(actor) {
      await deps.authz.require(actor, PERMISSION_INDICATOR_READ);
      return [...deps.valueTypes()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => ({
          id: entry.id,
          labels: entry.labels,
          numeric: entry.numeric,
          range: entry.range,
          aggregates: [...entry.aggregates],
        }));
    },

    async list(actor, filter, page) {
      await deps.authz.require(actor, PERMISSION_INDICATOR_READ);
      const conditions: (SQL | undefined)[] = [];
      const q = filter.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        conditions.push(
          sql`(${indicator.name} ilike ${pattern} escape '\\' or ${indicator.slug} ilike ${pattern} escape '\\' or ${indicator.description} ilike ${pattern} escape '\\')`,
        );
      }
      if (filter.thematic) conditions.push(eq(indicator.thematic, filter.thematic));
      if (filter.unit) conditions.push(eq(indicator.unit, filter.unit));
      if (filter.qualitative !== undefined)
        conditions.push(eq(indicator.qualitative, filter.qualitative));
      const where = and(...conditions);
      const first = {
        name: undefined,
        thematic: sql`${indicator.thematic}`,
        unit: sql`${indicator.unit} nulls last`,
        valueType: sql`${indicator.valueType}`,
      }[filter.sort ?? 'name'];
      const [rows, [count]] = await Promise.all([
        db
          .select()
          .from(indicator)
          .where(where)
          .orderBy(
            ...(first ? [first] : []),
            sql`lower(${indicator.name})`,
            asc(indicator.name),
            asc(indicator.id),
          )
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(indicator)
          .where(where),
      ]);
      return { indicators: await views(rows), total: count?.total ?? 0 };
    },

    async get(actor, id) {
      await deps.authz.require(actor, PERMISSION_INDICATOR_READ);
      requireId(id);
      return (await views([await load(db, id)]))[0]!;
    },

    async create(actor, input) {
      await deps.authz.require(actor, PERMISSION_INDICATOR_MANAGE);
      const body = parseInput(createIndicatorSchema, input);
      checkShape(body);
      const measuredBy = body.measuredBy ?? [];
      const canBeAutomatedBy = body.canBeAutomatedBy ?? [];
      await checkTerms(
        deps.settings,
        indicatorTermChecks({ ...body, measuredBy, canBeAutomatedBy }),
      );
      const id = ids.uuidv7();
      try {
        const row = await db.tx(async (tx) => {
          const slug = body.slug ?? (await freeSlug(tx, body.name));
          const [inserted] = await tx
            .insert(indicator)
            .values({
              id,
              slug,
              name: body.name,
              description: body.description ?? null,
              example: body.example ?? null,
              qualitative: body.qualitative ?? false,
              valueType: body.valueType,
              unit: body.unit ?? null,
              minValue: body.min == null ? null : String(body.min),
              maxValue: body.max == null ? null : String(body.max),
              thematic: body.thematic,
              createdBy: actorId(actor),
              updatedBy: actorId(actor),
            })
            .returning();
          await writeLinks(tx, id, { measuredBy, canBeAutomatedBy }, false);
          await ctx.events.emit('kpi.indicator.changed@1', {
            indicatorId: id,
            change: 'created',
            fields: [],
            actorId: actorId(actor),
          });
          return inserted!;
        });
        return (await views([row]))[0]!;
      } catch (error) {
        const field = CONSTRAINT_FIELDS[uniqueViolation(error) ?? ''];
        if (field) throw new Duplicate('indicator', field);
        throw error;
      }
    },

    async update(actor, id, input) {
      await deps.authz.require(actor, PERMISSION_INDICATOR_MANAGE);
      requireId(id);
      const body = parseInput(updateIndicatorSchema, input);
      const before = await load(db, id);
      const [meansBefore, toolsBefore] = await Promise.all([
        db.select().from(indicatorMeans).where(eq(indicatorMeans.indicatorId, id)),
        db.select().from(indicatorTool).where(eq(indicatorTool.indicatorId, id)),
      ]);
      checkShape(body);
      const measuredBy = body.measuredBy ?? [];
      const canBeAutomatedBy = body.canBeAutomatedBy ?? [];
      // A term the row already has passes even when it was deactivated since; a new one must be active.
      const kept = new Set<string>();
      if (before.thematic === body.thematic) kept.add('thematic');
      if (before.unit === (body.unit ?? null)) kept.add('unit');
      for (const link of meansBefore) kept.add(`measuredBy:${link.termKey}`);
      for (const link of toolsBefore) kept.add(`canBeAutomatedBy:${link.termKey}`);
      await checkTerms(
        deps.settings,
        indicatorTermChecks({ ...body, measuredBy, canBeAutomatedBy }, kept),
      );
      try {
        const row = await db.tx(async (tx) => {
          const current = await load(tx, id, true);
          const next = {
            name: body.name,
            description: body.description ?? null,
            example: body.example ?? null,
            qualitative: body.qualitative ?? false,
            valueType: body.valueType,
            unit: body.unit ?? null,
            minValue: body.min == null ? null : String(body.min),
            maxValue: body.max == null ? null : String(body.max),
            thematic: body.thematic,
          };
          const [currentMeans, currentTools] = await Promise.all([
            tx.select().from(indicatorMeans).where(eq(indicatorMeans.indicatorId, id)),
            tx.select().from(indicatorTool).where(eq(indicatorTool.indicatorId, id)),
          ]);
          const changed: string[] = [];
          if (current.name !== next.name) changed.push('name');
          if (current.description !== next.description) changed.push('description');
          if (current.example !== next.example) changed.push('example');
          if (current.qualitative !== next.qualitative) changed.push('qualitative');
          if (current.valueType !== next.valueType) changed.push('valueType');
          if (current.unit !== next.unit) changed.push('unit');
          if (numberOrNull(current.minValue) !== numberOrNull(next.minValue)) changed.push('min');
          if (numberOrNull(current.maxValue) !== numberOrNull(next.maxValue)) changed.push('max');
          if (current.thematic !== next.thematic) changed.push('thematic');
          const sorted = (list: readonly string[]) => [...list].sort();
          const linksChanged = {
            measuredBy: !same(sorted(currentMeans.map((l) => l.termKey)), sorted(measuredBy)),
            canBeAutomatedBy: !same(
              sorted(currentTools.map((l) => l.termKey)),
              sorted(canBeAutomatedBy),
            ),
          };
          if (linksChanged.measuredBy) changed.push('measuredBy');
          if (linksChanged.canBeAutomatedBy) changed.push('canBeAutomatedBy');
          if (changed.length === 0) return current;

          // A headline keeps an aggregate its value type allows: a change of type must not strand one.
          if (changed.includes('valueType')) {
            const type = typeOf(next.valueType)!;
            const stranded = await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(evaluation)
              .where(
                and(
                  eq(evaluation.indicatorId, id),
                  type.aggregates.length > 0
                    ? notInArray(evaluation.aggregate, [...type.aggregates])
                    : undefined,
                ),
              );
            if ((stranded[0]?.n ?? 0) > 0)
              throw new Conflict(
                `A KPI set uses this indicator as its headline with an aggregate that the value type "${next.valueType}" does not allow; change the evaluation first.`,
              );
          }

          const [updated] = await tx
            .update(indicator)
            .set({ ...next, updatedAt: new Date(), updatedBy: actorId(actor) })
            .where(eq(indicator.id, id))
            .returning();
          if (linksChanged.measuredBy || linksChanged.canBeAutomatedBy)
            await writeLinks(tx, id, { measuredBy, canBeAutomatedBy }, true);
          // The names of the fields, never their values (a test checks the payload).
          await ctx.events.emit('kpi.indicator.changed@1', {
            indicatorId: id,
            change: 'updated',
            fields: changed,
            actorId: actorId(actor),
          });
          return updated!;
        });
        return (await views([row]))[0]!;
      } catch (error) {
        const field = CONSTRAINT_FIELDS[uniqueViolation(error) ?? ''];
        if (field) throw new Duplicate('indicator', field);
        throw error;
      }
    },

    async delete(actor, id) {
      await deps.authz.require(actor, PERMISSION_INDICATOR_MANAGE);
      requireId(id);
      await db.tx(async (tx) => {
        await load(tx, id, true);
        // The database would refuse (`restrict`) with a 500; the answer names the module and the count.
        const [rows, evaluations] = await Promise.all([
          tx
            .select({ n: sql<number>`count(*)::int` })
            .from(kpiSetIndicator)
            .where(eq(kpiSetIndicator.indicatorId, id)),
          tx
            .select({ n: sql<number>`count(*)::int` })
            .from(evaluation)
            .where(eq(evaluation.indicatorId, id)),
        ]);
        const uses: Use[] = [];
        if ((rows[0]?.n ?? 0) > 0)
          uses.push({ module: 'kpi.framework', what: 'sets', count: rows[0]!.n });
        if ((evaluations[0]?.n ?? 0) > 0)
          uses.push({ module: 'kpi.framework', what: 'evaluations', count: evaluations[0]!.n });
        if (uses.length > 0) throw new InUse('indicator', uses);
        // By id and nothing else; the links go with it (cascade).
        await tx.delete(indicator).where(eq(indicator.id, id));
        await ctx.events.emit('kpi.indicator.changed@1', {
          indicatorId: id,
          change: 'deleted',
          fields: [],
          actorId: actorId(actor),
        });
      });
    },
  };
}
