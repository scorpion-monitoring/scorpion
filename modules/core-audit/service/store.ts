// Writing the trail: the kernel sink (`ctx.audit` and the request pipeline) and the subscriber that
// turns the events of other modules into rows. One insert, one redaction path (ADR 0021).
import { isIP } from 'node:net';
import {
  activeTransaction,
  ids,
  type AuditEntry,
  type Db,
  type DbTx,
  type DomainEvent,
} from '@scorpion/kernel';
import { auditEvent } from '../db/schema.ts';
import type { AuditSettings } from '../settings-schema.ts';
import { EVENT_DECISIONS, PAYLOAD_DROPPED_KEYS } from './decisions.ts';
import { cleanText, EVENT_REDACT_KEYS, prepare } from './redact.ts';

type Row = typeof auditEvent.$inferInsert;

export interface Store {
  /** The kernel sink: applies the `channels` setting, redacts, caps and inserts. Joins the caller's transaction if there is one. */
  record(entry: AuditEntry): Promise<void>;
  /** Like `record`, but the channel setting does not apply: for actions the module itself takes (an export, a requeue). */
  recordAlways(entry: AuditEntry, tx?: DbTx): Promise<void>;
  /** The subscriber: one row per event, idempotent through the event id. */
  recordEvent(event: DomainEvent): Promise<void>;
}

export interface StoreDeps {
  db: Db;
  settings: () => Promise<AuditSettings>;
}

const MAX = { action: 200, path: 500, text: 200, ip: 64 } as const;

function toRow(entry: AuditEntry): Row {
  const query = prepare(entry.query, entry.redact);
  const body = prepare(entry.body, entry.redact);
  const payload = prepare(entry.payload, entry.redact);
  const ip = entry.ip && isIP(entry.ip) !== 0 ? entry.ip : null;
  return {
    id: ids.uuidv7(),
    source: entry.source ?? 'event',
    action: cleanText(entry.action, MAX.action) ?? 'unknown',
    outcome: entry.outcome,
    actorKind: entry.actor.kind,
    userId: cleanText(entry.actor.userId, MAX.text),
    tokenId: cleanText(entry.actor.tokenId, MAX.text),
    ip,
    method: cleanText(entry.method, 16),
    path: cleanText(entry.path, MAX.path),
    status: entry.status ?? null,
    query: query.value ?? null,
    body: body.value ?? null,
    truncated: query.truncated || body.truncated || payload.truncated,
    requestId: cleanText(entry.requestId, MAX.text),
    subjectType: cleanText(entry.subject?.type, MAX.text),
    subjectId: cleanText(entry.subject?.id, MAX.text),
    payload: payload.value ?? null,
  };
}

export function createStore({ db, settings }: StoreDeps): Store {
  const executor = (tx?: DbTx): Db | DbTx => tx ?? activeTransaction() ?? db;

  return {
    async record(entry) {
      const channels = (await settings()).channels;
      // A request on the public API is the `api` channel; everything else is administrative.
      const channel = entry.source === 'api' && entry.surface === 'v1' ? 'api' : 'admin';
      if (!channels[channel]) return;
      await executor().insert(auditEvent).values(toRow(entry));
    },

    async recordAlways(entry, tx) {
      await executor(tx).insert(auditEvent).values(toRow(entry));
    },

    async recordEvent(event) {
      const decision = EVENT_DECISIONS[event.name];
      if (decision?.decision !== 'log') return;
      const payload = (
        typeof event.payload === 'object' && event.payload !== null ? event.payload : {}
      ) as Record<string, unknown>;
      const critical =
        typeof decision.critical === 'function' ? decision.critical(payload) : decision.critical;
      if (!critical && !(await settings()).channels.admin) return;
      const kept = Object.fromEntries(
        Object.entries(payload).filter(([key]) => !PAYLOAD_DROPPED_KEYS.includes(key)),
      );
      const actor = decision.actor(payload);
      const subject = decision.subject(payload);
      const stored = prepare(kept, [], EVENT_REDACT_KEYS);
      await db
        .insert(auditEvent)
        .values({
          id: ids.uuidv7(),
          occurredAt: event.occurredAt,
          source: 'event',
          action: event.name,
          outcome: 'ok',
          actorKind: actor.kind,
          userId: cleanText(actor.userId, MAX.text),
          tokenId: cleanText(actor.tokenId, MAX.text),
          truncated: stored.truncated,
          subjectType: cleanText(subject?.type, MAX.text),
          subjectId: cleanText(subject?.id, MAX.text),
          eventId: event.id,
          payload: stored.value ?? null,
        })
        .onConflictDoNothing({ target: auditEvent.eventId });
    },
  };
}
