// The KPIs of a service: its KPI set and the extra indicators it opted into (Decision 6 of the M9 plan). The link
// lives in this module's own tables with the service id as a plain column; whether the service exists is asked of
// `registry.services/public`. A change replaces the set and the extras in one transaction with its event in the
// outbox. The same writer serves the route and the create wizard (the field type's `store`), so there is one
// place that decides what an extra is.
import { Conflict, Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { DbTx, Db, ModuleContext } from '@scorpion/kernel';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  indicator,
  kpiSet,
  kpiSetIndicator,
  serviceExtraIndicator,
  serviceSet,
} from '../db/schema.ts';
import { effectiveSet, type EffectiveIndicator, type EffectiveRow } from './effective.ts';
import { appendHistory } from './history.ts';
import { parseInput, requireId, serviceKpisSchema, type ServiceKpisInput } from './input.ts';
import { iriFor } from './iri.ts';
import {
  PERMISSION_SERVICE_KPIS_EDIT,
  PERMISSION_SET_READ,
  RESOURCE_SERVICE,
} from './permissions.ts';
import { actorId, iriBaseOf } from './shared.ts';

export interface ServiceKpisView {
  serviceId: string;
  set: {
    id: string;
    slug: string;
    iri: string;
    name: string;
    description: string | null;
    rimoCategory: string | null;
  } | null;
  /** The effective set (the set's rows with their necessity, then the extras as `optional`), in a stable order. */
  rows: EffectiveRow<EffectiveIndicator>[];
  /** The indicators the service chose beyond its set, as stored. */
  extras: EffectiveIndicator[];
  /** Whether the caller may change them (managers and Admin): the answer to the question the page would otherwise guess. */
  canEdit: boolean;
}

export interface ServiceKpisService {
  /** The set, the extras and the effective list of one service. `NotFound` for a service that does not exist. */
  get(actor: Actor, serviceId: string): Promise<ServiceKpisView>;
  /**
   * Replaces the service's KPI set and extras in one transaction. An unknown set or indicator is 422 naming the
   * path, never a 500; an extra the new set already contains is dropped; an extra that is left out is removed.
   * Needs `kpi.framework.service.kpis.edit` on the service (Admin, or an approved manager of its provider).
   */
  set(actor: Actor, serviceId: string, input: ServiceKpisInput): Promise<ServiceKpisView>;
}

export interface ServiceKpisDeps {
  authz: Pick<AuthzService, 'require' | 'can'>;
  services: Pick<ServicesPublic, 'existsAsSystem'>;
}

/** What the writer needs to know about the caller of the create wizard: who, never what they may do. */
export interface KpisWriter {
  /** Validates `input` against the tables, as the route does. 422 for an unknown set or indicator. */
  check(input: ServiceKpisInput): Promise<void>;
  /** Writes inside the transaction of the caller and emits the event there. Returns what changed. */
  write(tx: DbTx, serviceId: string, input: ServiceKpisInput, by: string | null): Promise<string[]>;
}

export function createKpisWriter(ctx: ModuleContext): KpisWriter {
  const db: Db = ctx.db;
  return {
    async check(input) {
      const problems: FieldProblem[] = [];
      if (input.setId) {
        const [found] = await db
          .select({ id: kpiSet.id })
          .from(kpiSet)
          .where(eq(kpiSet.id, input.setId));
        if (!found)
          problems.push({ in: 'body', path: 'setId', message: 'There is no such KPI set.' });
      }
      if (input.extras.length > 0) {
        const known = new Set(
          (
            await db
              .select({ id: indicator.id })
              .from(indicator)
              .where(inArray(indicator.id, input.extras))
          ).map((row) => row.id),
        );
        input.extras.forEach((id, index) => {
          if (!known.has(id))
            problems.push({
              in: 'body',
              path: `extras[${index}]`,
              message: 'There is no such indicator.',
            });
        });
      }
      if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
    },

    async write(tx, serviceId, input, by) {
      // Writers of one service wait for each other, so two changes never interleave their two tables.
      await tx.execute(sqlLock(serviceId));
      // An extra the set already contains is not an extra: it is dropped here, once, whoever the caller is.
      const inSet = input.setId
        ? new Set(
            (
              await tx
                .select({ id: kpiSetIndicator.indicatorId })
                .from(kpiSetIndicator)
                .where(eq(kpiSetIndicator.setId, input.setId))
            ).map((row) => row.id),
          )
        : new Set<string>();
      const wanted = input.extras.filter((id) => !inSet.has(id));

      const fields: string[] = [];
      const [before] = await tx
        .select()
        .from(serviceSet)
        .where(eq(serviceSet.serviceId, serviceId));
      if ((before?.setId ?? null) !== input.setId) {
        if (input.setId === null) {
          await tx.delete(serviceSet).where(eq(serviceSet.serviceId, serviceId));
        } else {
          await tx
            .insert(serviceSet)
            .values({ serviceId, setId: input.setId, updatedBy: by })
            .onConflictDoUpdate({
              target: serviceSet.serviceId,
              set: { setId: input.setId, updatedAt: new Date(), updatedBy: by },
            });
        }
        fields.push('set');
      }
      const had = new Set(
        (
          await tx
            .select({ id: serviceExtraIndicator.indicatorId })
            .from(serviceExtraIndicator)
            .where(eq(serviceExtraIndicator.serviceId, serviceId))
        ).map((row) => row.id),
      );
      const gone = [...had].filter((id) => !wanted.includes(id));
      const added = wanted.filter((id) => !had.has(id));
      // By the service and the indicator, nothing wider: one service's extras never touch another's.
      if (gone.length > 0)
        await tx
          .delete(serviceExtraIndicator)
          .where(
            and(
              eq(serviceExtraIndicator.serviceId, serviceId),
              inArray(serviceExtraIndicator.indicatorId, gone),
            ),
          );
      if (added.length > 0)
        await tx
          .insert(serviceExtraIndicator)
          .values(added.map((indicatorId) => ({ serviceId, indicatorId })));
      if (gone.length > 0 || added.length > 0) fields.push('extras');

      // The history gets its row in this transaction: a rolled-back change leaves none (ADR-0041 Decision 3).
      if (fields.length > 0)
        await appendHistory(tx, serviceId, { setId: input.setId, extras: wanted }, by);
      if (fields.length > 0)
        await ctx.events.emit('kpi.serviceSet.changed@1', {
          serviceId,
          setId: input.setId,
          fields,
          actorId: by,
        });
      return fields;
    },
  };
}

function sqlLock(serviceId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`kpif:${serviceId}`}, 0))`;
}

export function createServiceKpisService(
  ctx: ModuleContext,
  deps: ServiceKpisDeps,
  writer: KpisWriter,
): ServiceKpisService {
  const db: Db = ctx.db;
  const iriBase = iriBaseOf(ctx);

  async function requireService(serviceId: string): Promise<void> {
    requireId(serviceId, 'id');
    if (!(await deps.services.existsAsSystem(serviceId)))
      throw new NotFound('There is no such service.');
  }

  async function view(actor: Actor, serviceId: string): Promise<ServiceKpisView> {
    const [current, base, canEdit] = await Promise.all([
      effectiveSet(db, serviceId),
      iriBase(),
      deps.authz.can(actor, PERMISSION_SERVICE_KPIS_EDIT, {
        type: RESOURCE_SERVICE,
        id: serviceId,
      }),
    ]);
    return {
      serviceId,
      set: current.set && { ...current.set, iri: iriFor('set', current.set.slug, base) },
      rows: current.rows,
      extras: current.extras,
      canEdit,
    };
  }

  return {
    async get(actor, serviceId) {
      await deps.authz.require(actor, PERMISSION_SET_READ);
      await requireService(serviceId);
      return view(actor, serviceId);
    },

    async set(actor, serviceId, input) {
      // The route carries the plain read permission (ADR-0034), so this method is the authorization: the
      // service first (404 reveals nothing, a service is readable by everybody), then the access, then the input.
      await deps.authz.require(actor, PERMISSION_SET_READ);
      await requireService(serviceId);
      await deps.authz.require(actor, PERMISSION_SERVICE_KPIS_EDIT, {
        type: RESOURCE_SERVICE,
        id: serviceId,
      });
      const body = parseInput(serviceKpisSchema, input);
      await writer.check(body);
      try {
        await db.tx((tx) => writer.write(tx, serviceId, body, actorId(actor)));
      } catch (error) {
        // A set or an indicator deleted between the check and the write: the key refuses, nothing is kept.
        if ((error as { cause?: { code?: string } }).cause?.code === '23503')
          throw new Conflict('The set or an indicator was deleted meanwhile; try again.');
        throw error;
      }
      return view(actor, serviceId);
    },
  };
}
