// The evaluation of a KPI set: its headline, one indicator of the set and an aggregate. The indicator must be in
// the set, and the aggregate must be one that the indicator's value type allows and that the vocabulary
// `aggregate` has active. What the value type allows is registry data, so nothing here names a type.
import { Invalid, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { Db, ModuleContext } from '@scorpion/kernel';
import { and, eq } from 'drizzle-orm';
import { evaluation, indicator, kpiSetIndicator } from '../db/schema.ts';
import { evaluationSchema, parseInput, requireId, type EvaluationInput } from './input.ts';
import { PERMISSION_SET_MANAGE, PERMISSION_SET_READ } from './permissions.ts';
import { loadSet, type EvaluationView } from './sets.ts';
import { actorId } from './shared.ts';
import { checkTerms, evaluationTermChecks } from './terms.ts';
import type { ValueTypeEntry } from './value-types.ts';

export interface EvaluationService {
  /** The headline of the set, or `null` when it has none. `NotFound` for a set that does not exist. */
  get(actor: Actor, setId: string): Promise<EvaluationView | null>;
  /** Sets or replaces the headline. */
  set(actor: Actor, setId: string, input: EvaluationInput): Promise<EvaluationView>;
}

export interface EvaluationDeps {
  authz: Pick<AuthzService, 'require'>;
  settings: Pick<SettingsService, 'validateTerm'>;
  valueTypes: () => readonly ValueTypeEntry[];
}

export function createEvaluationService(
  ctx: ModuleContext,
  deps: EvaluationDeps,
): EvaluationService {
  const db: Db = ctx.db;

  const read = async (tx: Pick<Db, 'select'>, setId: string): Promise<EvaluationView | null> => {
    const [row] = await tx.select().from(evaluation).where(eq(evaluation.setId, setId));
    return row
      ? {
          setId: row.setId,
          indicatorId: row.indicatorId,
          aggregate: row.aggregate,
          updatedAt: row.updatedAt,
        }
      : null;
  };

  /** The value type of the set's row `indicatorId`, or the 422 that says it is not in the set. */
  async function headlineType(tx: Pick<Db, 'select'>, setId: string, indicatorId: string) {
    const [row] = await tx
      .select({ valueType: indicator.valueType })
      .from(kpiSetIndicator)
      .innerJoin(indicator, eq(indicator.id, kpiSetIndicator.indicatorId))
      .where(and(eq(kpiSetIndicator.setId, setId), eq(kpiSetIndicator.indicatorId, indicatorId)));
    if (!row)
      throw new Invalid('The request is not valid.', [
        {
          in: 'body',
          path: 'indicatorId',
          message: 'The headline indicator must be one of the indicators of the set.',
        },
      ]);
    return row.valueType;
  }

  function checkAggregate(valueType: string, aggregate: string) {
    const type = deps.valueTypes().find((entry) => entry.id === valueType);
    if (!type || !type.aggregates.includes(aggregate))
      throw new Invalid('The request is not valid.', [
        {
          in: 'body',
          path: 'aggregate',
          message: type
            ? `The aggregate "${aggregate}" does not fit the value type "${valueType}".`
            : `The value type "${valueType}" of the indicator is not registered.`,
        },
      ]);
  }

  return {
    async get(actor, setId) {
      await deps.authz.require(actor, PERMISSION_SET_READ);
      requireId(setId);
      await loadSet(db, setId);
      return read(db, setId);
    },

    async set(actor, setId, input) {
      await deps.authz.require(actor, PERMISSION_SET_MANAGE);
      requireId(setId);
      const body = parseInput(evaluationSchema, input);
      await loadSet(db, setId);
      const before = await read(db, setId);
      checkAggregate(await headlineType(db, setId, body.indicatorId), body.aggregate);
      // The aggregate the headline already has passes even when the term was deactivated since.
      await checkTerms(
        deps.settings,
        evaluationTermChecks(body, before?.aggregate === body.aggregate),
      );
      return db.tx(async (tx) => {
        await loadSet(tx, setId, true);
        // Checked again under the lock: a writer of the rows may have removed the indicator meanwhile.
        checkAggregate(await headlineType(tx, setId, body.indicatorId), body.aggregate);
        const current = await read(tx, setId);
        if (
          current &&
          current.indicatorId === body.indicatorId &&
          current.aggregate === body.aggregate
        )
          return current;
        const now = new Date();
        await tx
          .insert(evaluation)
          .values({
            setId,
            indicatorId: body.indicatorId,
            aggregate: body.aggregate,
            updatedAt: now,
            updatedBy: actorId(actor),
          })
          .onConflictDoUpdate({
            target: evaluation.setId,
            set: {
              indicatorId: body.indicatorId,
              aggregate: body.aggregate,
              updatedAt: now,
              updatedBy: actorId(actor),
            },
          });
        await ctx.events.emit('kpi.set.changed@1', {
          setId,
          change: 'updated',
          fields: ['evaluation'],
          actorId: actorId(actor),
        });
        return (await read(tx, setId))!;
      });
    },
  };
}
