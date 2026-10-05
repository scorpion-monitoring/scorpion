// The kernel's maintenance surface, hosted here (M4 decision 9): the state of the outbox and the
// repair of a dead delivery. The kernel keeps the queries; this adds the permission checks, the
// views and the audit entry. Nothing here returns an event payload.
import { Conflict, NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import {
  listDeadDeliveries,
  outboxStats,
  requeueDelivery,
  type DeadDelivery,
  type Db,
  type OutboxStats,
} from '@scorpion/kernel';
import { sql } from 'drizzle-orm';
import type { Store } from './store.ts';

export const PERMISSION_SYSTEM_READ = 'core.audit.system.read';
export const PERMISSION_SYSTEM_MANAGE = 'core.audit.system.manage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OutboxOverview {
  stats: OutboxStats;
  /** Deliveries that ran out of attempts, newest first (at most 100). Names, counts and a masked error; no payload. */
  dead: DeadDelivery[];
}

export interface SystemService {
  /** Needs `core.audit.system.read`. */
  outbox(actor: Actor): Promise<OutboxOverview>;
  /**
   * Needs `core.audit.system.manage`. Puts a `dead` outbox delivery back in the queue. `NotFound` for an
   * unknown id, `Conflict` for a delivery that is not dead. The audit entry (`system.outbox.requeued`)
   * is written in the same transaction, so the repair never happens without its trail.
   */
  requeue(
    actor: Actor,
    deliveryId: string,
  ): Promise<{ deliveryId: string; eventName: string; subscriber: string }>;
}

export function createSystem(deps: {
  db: Db;
  authz: Pick<AuthzService, 'require'>;
  store: Store;
}): SystemService {
  const { db, authz, store } = deps;
  return {
    async outbox(actor) {
      await authz.require(actor, PERMISSION_SYSTEM_READ);
      return { stats: await outboxStats(db), dead: await listDeadDeliveries(db, { limit: 100 }) };
    },

    async requeue(actor, deliveryId) {
      await authz.require(actor, PERMISSION_SYSTEM_MANAGE);
      if (!UUID.test(deliveryId)) throw new NotFound('There is no such delivery.');
      const id = deliveryId.toLowerCase();
      return db.tx(async (tx) => {
        const requeued = await requeueDelivery(tx, id);
        if (!requeued) {
          const { rows } = await tx.execute<{ status: string }>(
            sql`select status from kernel_outbox_delivery where id = ${id}`,
          );
          if (rows.length === 0) throw new NotFound('There is no such delivery.');
          throw new Conflict('Only a dead delivery can be put back in the queue.');
        }
        await store.recordAlways(
          {
            action: 'system.outbox.requeued',
            outcome: 'ok',
            source: 'event',
            actor:
              actor.kind === 'user'
                ? {
                    kind: actor.via === 'token' ? 'token' : 'user',
                    userId: actor.userId,
                    tokenId: actor.tokenId ?? null,
                  }
                : { kind: 'anonymous' },
            subject: { type: 'outbox-delivery', id },
            payload: {
              event: requeued.eventName,
              subscriber: requeued.subscriber,
              attempts: requeued.attempts,
            },
          },
          tx,
        );
        return { deliveryId: id, eventName: requeued.eventName, subscriber: requeued.subscriber };
      });
    },
  };
}
