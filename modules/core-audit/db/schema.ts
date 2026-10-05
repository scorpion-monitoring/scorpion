// The table of core.audit. The name starts with `audit_` (the manifest's `tablePrefix`, ADR 0004).
// Create a migration after a change: `pnpm db:generate --filter @scorpion/core-audit`. The migration
// that makes the table append-only (the trigger, ADR 0021) is hand-written SQL beside the generated one.
//
// No foreign keys: an actor or subject id is kept as written, also after the account is purged, and
// the module must not block a purge (ADR 0014, 0019).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** One thing that happened: an event of a module, an API call, or a `ctx.audit` entry. Append-only. */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid().primaryKey(), // UUIDv7
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    /** `event`: a domain or administrative action. `api`: the log of a request. */
    source: text().notNull(),
    /** The event name (`authz.role.assigned@1`), `api.POST`, or the action of a `ctx.audit` entry. */
    action: text().notNull(),
    /** `ok`, `denied` (401, 403, 429) or `error`. */
    outcome: text().notNull(),
    /** `user`, `token`, `anonymous` or `system`. */
    actorKind: text('actor_kind').notNull(),
    /** An opaque id, as written by the sender. */
    userId: text('user_id'),
    /** The id of the access token used, never the token. */
    tokenId: text('token_id'),
    /** The client address; cut to a network prefix (`203.0.113.0/24`) by the retention job after a while. */
    ip: text(),
    method: text(),
    /** The route template, `/api/internal/users/{id}/approve`, not the concrete URL. */
    path: text(),
    status: integer(),
    /** Redacted and capped. Only a route that opted in has one. */
    query: jsonb(),
    body: jsonb(),
    /** True when `query`, `body` or `payload` was cut to the size limit. */
    truncated: boolean().notNull().default(false),
    requestId: text('request_id'),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    /** The outbox event this row records: unique, so a redelivered event makes no second row. */
    eventId: uuid('event_id'),
    /** The event payload, or the payload of a `ctx.audit` entry. No secret by design (a test proves it). */
    payload: jsonb(),
  },
  (table) => [
    uniqueIndex('audit_event_event_id_idx').on(table.eventId),
    index('audit_event_occurred_at_idx').on(table.occurredAt.desc(), table.id.desc()),
    index('audit_event_user_idx').on(table.userId, table.occurredAt),
    index('audit_event_action_idx').on(table.action, table.occurredAt),
    index('audit_event_source_idx').on(table.source, table.occurredAt),
    check('audit_event_source_check', sql`${table.source} in ('event', 'api')`),
    check('audit_event_outcome_check', sql`${table.outcome} in ('ok', 'denied', 'error')`),
    check(
      'audit_event_actor_kind_check',
      sql`${table.actorKind} in ('user', 'token', 'anonymous', 'system')`,
    ),
  ],
);
