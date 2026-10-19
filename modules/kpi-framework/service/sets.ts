// The KPI sets: create, read, list, change and delete, and the replacement of a set's rows. Every method takes the
// `actor` and checks the permission first. The terms a set names are checked before the transaction opens
// (`checkTerms`); a write of more than one row is one transaction with its event in the outbox.
import { Conflict, Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { ids, type Db, type ModuleContext } from '@scorpion/kernel';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { evaluation, indicator, kpiSet, kpiSetIndicator, serviceSet } from '../db/schema.ts';
import { Duplicate, InUse } from './errors.ts';
import {
  createSetSchema,
  parseInput,
  requireId,
  setIndicatorsSchema,
  updateSetSchema,
  type CreateSetInput,
  type SetFilter,
  type SetIndicatorsInput,
  type UpdateSetInput,
} from './input.ts';
import { iriFor } from './iri.ts';
import { PERMISSION_SET_MANAGE, PERMISSION_SET_READ } from './permissions.ts';
import { actorId, iriBaseOf, uniqueViolation } from './shared.ts';
import { checkTerms, setRowTermChecks, setTermChecks } from './terms.ts';
import { escapeLike, slugCandidate, slugFromName } from './text.ts';

type Row = typeof kpiSet.$inferSelect;

/** What a list of sets shows: the counts, never the rows. */
export interface SetSummary {
  id: string;
  slug: string;
  iri: string;
  name: string;
  description: string | null;
  rimoCategory: string | null;
  indicatorCount: number;
  /** How many rows each necessity has, for the badges: `{ mandatory: 3, optional: 1 }`. */
  necessityCounts: Record<string, number>;
  hasEvaluation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SetRowView {
  indicatorId: string;
  slug: string;
  name: string;
  necessity: string;
  valueType: string;
  unit: string | null;
  thematic: string;
  qualitative: boolean;
}

export interface EvaluationView {
  setId: string;
  indicatorId: string;
  aggregate: string;
  updatedAt: Date;
}

export interface SetView extends SetSummary {
  /** By indicator name, then id. */
  indicators: SetRowView[];
  evaluation: EvaluationView | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SetsService {
  list(
    actor: Actor,
    filter: SetFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ sets: SetSummary[]; total: number }>;
  get(actor: Actor, id: string): Promise<SetView>;
  create(actor: Actor, input: CreateSetInput): Promise<SetView>;
  /** Replaces the editable fields (a field left out is cleared); the slug never changes. */
  update(actor: Actor, id: string, input: UpdateSetInput): Promise<SetView>;
  delete(actor: Actor, id: string): Promise<void>;
  /**
   * Replaces the rows of the set in one transaction: an indicator that is not listed is removed (and the
   * evaluation with it when it was the headline), a new one is added, a listed one gets its necessity.
   */
  setIndicators(actor: Actor, id: string, input: SetIndicatorsInput): Promise<SetView>;
}

export interface SetsDeps {
  authz: Pick<AuthzService, 'require'>;
  settings: Pick<SettingsService, 'validateTerm'>;
}

const CONSTRAINT_FIELDS: Record<string, 'name' | 'slug'> = {
  kpif_kpi_set_slug_idx: 'slug',
  kpif_kpi_set_name_idx: 'name',
};

/** The set or a 404. With `lock` the row is held until the transaction ends, which orders writers of one set. */
export async function loadSet(tx: Pick<Db, 'select'>, id: string, lock = false): Promise<Row> {
  const query = tx.select().from(kpiSet).where(eq(kpiSet.id, id));
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new NotFound('There is no such KPI set.');
  return row;
}

export function createSetsService(ctx: ModuleContext, deps: SetsDeps): SetsService {
  const db: Db = ctx.db;
  const iriBase = iriBaseOf(ctx);

  async function rowsOf(tx: Pick<Db, 'select'>, setId: string): Promise<SetRowView[]> {
    const rows = await tx
      .select({
        indicatorId: kpiSetIndicator.indicatorId,
        necessity: kpiSetIndicator.necessity,
        slug: indicator.slug,
        name: indicator.name,
        valueType: indicator.valueType,
        unit: indicator.unit,
        thematic: indicator.thematic,
        qualitative: indicator.qualitative,
      })
      .from(kpiSetIndicator)
      .innerJoin(indicator, eq(indicator.id, kpiSetIndicator.indicatorId))
      .where(eq(kpiSetIndicator.setId, setId))
      .orderBy(sql`lower(${indicator.name})`, asc(indicator.name), asc(indicator.id));
    return rows;
  }

  async function evaluationOf(
    tx: Pick<Db, 'select'>,
    setId: string,
  ): Promise<EvaluationView | null> {
    const [row] = await tx.select().from(evaluation).where(eq(evaluation.setId, setId));
    return row
      ? {
          setId: row.setId,
          indicatorId: row.indicatorId,
          aggregate: row.aggregate,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  async function summaries(rows: readonly Row[]): Promise<SetSummary[]> {
    if (rows.length === 0) return [];
    const idList = rows.map((row) => row.id);
    const [counts, evaluations, base] = await Promise.all([
      db
        .select({
          setId: kpiSetIndicator.setId,
          necessity: kpiSetIndicator.necessity,
          n: sql<number>`count(*)::int`,
        })
        .from(kpiSetIndicator)
        .where(inArray(kpiSetIndicator.setId, idList))
        .groupBy(kpiSetIndicator.setId, kpiSetIndicator.necessity),
      db
        .select({ setId: evaluation.setId })
        .from(evaluation)
        .where(inArray(evaluation.setId, idList)),
      iriBase(),
    ]);
    const withEvaluation = new Set(evaluations.map((e) => e.setId));
    return rows.map((row) => {
      const necessityCounts: Record<string, number> = {};
      let indicatorCount = 0;
      for (const count of counts) {
        if (count.setId !== row.id) continue;
        necessityCounts[count.necessity] = count.n;
        indicatorCount += count.n;
      }
      return {
        id: row.id,
        slug: row.slug,
        iri: iriFor('set', row.slug, base),
        name: row.name,
        description: row.description,
        rimoCategory: row.rimoCategory,
        indicatorCount,
        necessityCounts,
        hasEvaluation: withEvaluation.has(row.id),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async function view(row: Row): Promise<SetView> {
    const [summary] = await summaries([row]);
    const [indicators, current] = await Promise.all([rowsOf(db, row.id), evaluationOf(db, row.id)]);
    return {
      ...summary!,
      indicators,
      evaluation: current,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  async function freeSlug(tx: Pick<Db, 'select'>, name: string): Promise<string> {
    const base = slugFromName(name, 'set');
    for (let attempt = 1; attempt < 1000; attempt++) {
      const candidate = slugCandidate(base, attempt);
      const [taken] = await tx
        .select({ id: kpiSet.id })
        .from(kpiSet)
        .where(sql`lower(${kpiSet.slug}) = lower(${candidate})`)
        .limit(1);
      if (!taken) return candidate;
    }
    throw new Conflict('No free slug could be made from this name; give one.');
  }

  return {
    async list(actor, filter, page) {
      await deps.authz.require(actor, PERMISSION_SET_READ);
      const conditions: (SQL | undefined)[] = [];
      const q = filter.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        conditions.push(
          sql`(${kpiSet.name} ilike ${pattern} escape '\\' or ${kpiSet.slug} ilike ${pattern} escape '\\' or ${kpiSet.description} ilike ${pattern} escape '\\')`,
        );
      }
      if (filter.rimoCategory) conditions.push(eq(kpiSet.rimoCategory, filter.rimoCategory));
      const where = and(...conditions);
      const [rows, [count]] = await Promise.all([
        db
          .select()
          .from(kpiSet)
          .where(where)
          .orderBy(
            ...(filter.sort === 'rimoCategory' ? [sql`${kpiSet.rimoCategory} nulls last`] : []),
            sql`lower(${kpiSet.name})`,
            asc(kpiSet.name),
            asc(kpiSet.id),
          )
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(kpiSet)
          .where(where),
      ]);
      return { sets: await summaries(rows), total: count?.total ?? 0 };
    },

    async get(actor, id) {
      await deps.authz.require(actor, PERMISSION_SET_READ);
      requireId(id);
      return view(await loadSet(db, id));
    },

    async create(actor, input) {
      await deps.authz.require(actor, PERMISSION_SET_MANAGE);
      const body = parseInput(createSetSchema, input);
      await checkTerms(deps.settings, setTermChecks(body));
      const id = ids.uuidv7();
      try {
        const row = await db.tx(async (tx) => {
          const slug = body.slug ?? (await freeSlug(tx, body.name));
          const [inserted] = await tx
            .insert(kpiSet)
            .values({
              id,
              slug,
              name: body.name,
              description: body.description ?? null,
              rimoCategory: body.rimoCategory ?? null,
              createdBy: actorId(actor),
              updatedBy: actorId(actor),
            })
            .returning();
          await ctx.events.emit('kpi.set.changed@1', {
            setId: id,
            change: 'created',
            fields: [],
            actorId: actorId(actor),
          });
          return inserted!;
        });
        return view(row);
      } catch (error) {
        const field = CONSTRAINT_FIELDS[uniqueViolation(error) ?? ''];
        if (field) throw new Duplicate('KPI set', field);
        throw error;
      }
    },

    async update(actor, id, input) {
      await deps.authz.require(actor, PERMISSION_SET_MANAGE);
      requireId(id);
      const body = parseInput(updateSetSchema, input);
      const before = await loadSet(db, id);
      const kept = new Set<string>();
      if (before.rimoCategory === (body.rimoCategory ?? null)) kept.add('rimoCategory');
      await checkTerms(deps.settings, setTermChecks(body, kept));
      try {
        const row = await db.tx(async (tx) => {
          const current = await loadSet(tx, id, true);
          const next = {
            name: body.name,
            description: body.description ?? null,
            rimoCategory: body.rimoCategory ?? null,
          };
          const changed = (['name', 'description', 'rimoCategory'] as const).filter(
            (field) => current[field] !== next[field],
          );
          if (changed.length === 0) return current;
          const [updated] = await tx
            .update(kpiSet)
            .set({ ...next, updatedAt: new Date(), updatedBy: actorId(actor) })
            .where(eq(kpiSet.id, id))
            .returning();
          await ctx.events.emit('kpi.set.changed@1', {
            setId: id,
            change: 'updated',
            fields: changed,
            actorId: actorId(actor),
          });
          return updated!;
        });
        return view(row);
      } catch (error) {
        const field = CONSTRAINT_FIELDS[uniqueViolation(error) ?? ''];
        if (field) throw new Duplicate('KPI set', field);
        throw error;
      }
    },

    async delete(actor, id) {
      await deps.authz.require(actor, PERMISSION_SET_MANAGE);
      requireId(id);
      await db.tx(async (tx) => {
        await loadSet(tx, id, true);
        // The database would refuse (`restrict`) with a 500; the answer names the module and the count.
        const [used] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(serviceSet)
          .where(eq(serviceSet.setId, id));
        if ((used?.n ?? 0) > 0)
          throw new InUse('KPI set', [
            { module: 'kpi.framework', what: 'services', count: used!.n },
          ]);
        // By id and nothing else; the rows and the evaluation go with it (cascade).
        await tx.delete(kpiSet).where(eq(kpiSet.id, id));
        await ctx.events.emit('kpi.set.changed@1', {
          setId: id,
          change: 'deleted',
          fields: [],
          actorId: actorId(actor),
        });
      });
    },

    async setIndicators(actor, id, input) {
      await deps.authz.require(actor, PERMISSION_SET_MANAGE);
      requireId(id);
      const body = parseInput(setIndicatorsSchema, input);
      await loadSet(db, id);
      const problems: FieldProblem[] = [];
      const seen = new Set<string>();
      body.indicators.forEach((row, index) => {
        if (seen.has(row.indicatorId))
          problems.push({
            in: 'body',
            path: `indicators[${index}].indicatorId`,
            message: 'This indicator is listed twice.',
          });
        seen.add(row.indicatorId);
      });
      const known = new Set(
        (
          await db
            .select({ id: indicator.id })
            .from(indicator)
            .where(inArray(indicator.id, [...seen]))
        ).map((row) => row.id),
      );
      body.indicators.forEach((row, index) => {
        if (!known.has(row.indicatorId))
          problems.push({
            in: 'body',
            path: `indicators[${index}].indicatorId`,
            message: 'There is no such indicator.',
          });
      });
      // A necessity the row already has passes even when the term was deactivated since.
      const existing = new Map(
        (await rowsOf(db, id)).map((row) => [row.indicatorId, row.necessity] as const),
      );
      const keptNecessity = new Set<number>();
      body.indicators.forEach((row, index) => {
        if (existing.get(row.indicatorId) === row.necessity) keptNecessity.add(index);
      });
      try {
        await checkTerms(deps.settings, setRowTermChecks(body.indicators, keptNecessity));
      } catch (error) {
        if (!(error instanceof Invalid)) throw error;
        problems.push(...(error.errors ?? []));
      }
      if (problems.length > 0) throw new Invalid('The request is not valid.', problems);

      try {
        const row = await db.tx(async (tx) => {
          const current = await loadSet(tx, id, true);
          const had = new Map(
            (await rowsOf(tx, id)).map((row) => [row.indicatorId, row.necessity] as const),
          );
          const wanted = new Map(body.indicators.map((row) => [row.indicatorId, row.necessity]));
          const removed = [...had.keys()].filter((key) => !wanted.has(key));
          const added = body.indicators.filter((row) => !had.has(row.indicatorId));
          const changed = body.indicators.filter(
            (row) => had.has(row.indicatorId) && had.get(row.indicatorId) !== row.necessity,
          );
          if (removed.length === 0 && added.length === 0 && changed.length === 0) return current;

          const fields = ['indicators'];
          // The evaluation names a row of the set (a composite key without cascade): it goes first when its
          // headline is removed, in this transaction, so that no set keeps a headline it does not have.
          if (removed.length > 0) {
            const gone = await tx
              .delete(evaluation)
              .where(and(eq(evaluation.setId, id), inArray(evaluation.indicatorId, removed)))
              .returning({ setId: evaluation.setId });
            if (gone.length > 0) fields.push('evaluation');
            await tx
              .delete(kpiSetIndicator)
              .where(
                and(eq(kpiSetIndicator.setId, id), inArray(kpiSetIndicator.indicatorId, removed)),
              );
          }
          if (added.length > 0)
            await tx.insert(kpiSetIndicator).values(
              added.map((row) => ({
                setId: id,
                indicatorId: row.indicatorId,
                necessity: row.necessity,
              })),
            );
          for (const row of changed)
            await tx
              .update(kpiSetIndicator)
              .set({ necessity: row.necessity })
              .where(
                and(
                  eq(kpiSetIndicator.setId, id),
                  eq(kpiSetIndicator.indicatorId, row.indicatorId),
                ),
              );
          const [touched] = await tx
            .update(kpiSet)
            .set({ updatedAt: new Date(), updatedBy: actorId(actor) })
            .where(eq(kpiSet.id, id))
            .returning();
          await ctx.events.emit('kpi.set.changed@1', {
            setId: id,
            change: 'updated',
            fields,
            actorId: actorId(actor),
          });
          return touched!;
        });
        return view(row);
      } catch (error) {
        // An indicator deleted between the check and the insert: the key refuses, the whole write is undone.
        if ((error as { cause?: { code?: string } }).cause?.code === '23503')
          throw new Conflict('An indicator of the list was deleted meanwhile; try again.');
        throw error;
      }
    },
  };
}
