// A factory for the table of `core.audit`. It inserts a row directly, so a test can set up an entry of
// any age or shape without going through the sink. It knows the column names: a change to the schema
// breaks the audit integration tests, which is the point. It needs the module's migrations to have run.
// (INSERT is the one thing the append-only trigger allows.)
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let sequence = 0;
const next = () => ++sequence;

export interface MakeAuditEvent {
  id?: string;
  /** Default: now. Retention and the IP cut count from here. */
  occurredAt?: Date;
  source?: 'event' | 'api';
  action?: string;
  outcome?: 'ok' | 'denied' | 'error';
  actorKind?: 'user' | 'token' | 'anonymous' | 'system';
  userId?: string | null;
  tokenId?: string | null;
  ip?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  query?: unknown;
  body?: unknown;
  truncated?: boolean;
  requestId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  eventId?: string | null;
  payload?: unknown;
}

export interface AuditEventRow {
  id: string;
  occurred_at: Date;
  source: 'event' | 'api';
  action: string;
  outcome: 'ok' | 'denied' | 'error';
  actor_kind: 'user' | 'token' | 'anonymous' | 'system';
  user_id: string | null;
  token_id: string | null;
  ip: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  query: unknown;
  body: unknown;
  truncated: boolean;
  request_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  event_id: string | null;
  payload: unknown;
}

const json = (value: unknown) =>
  value === undefined || value === null ? null : JSON.stringify(value);

/** An `api` row by default (a request); pass `source: 'event'` for a domain action. */
export async function makeAuditEvent(
  db: Queryable,
  overrides: MakeAuditEvent = {},
): Promise<AuditEventRow> {
  const n = next();
  const source = overrides.source ?? 'api';
  const { rows } = await db.query<AuditEventRow>(
    `insert into audit_event
       (id, occurred_at, source, action, outcome, actor_kind, user_id, token_id, ip, method, path,
        status, query, body, truncated, request_id, subject_type, subject_id, event_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17,
             $18, $19, $20::jsonb)
     returning *`,
    [
      overrides.id ?? randomUUID(),
      overrides.occurredAt ?? new Date(),
      source,
      overrides.action ?? (source === 'api' ? 'api.GET' : `test.action${n}`),
      overrides.outcome ?? 'ok',
      overrides.actorKind ?? 'user',
      overrides.userId === undefined ? randomUUID() : overrides.userId,
      overrides.tokenId ?? null,
      overrides.ip ?? null,
      overrides.method === undefined ? (source === 'api' ? 'GET' : null) : overrides.method,
      overrides.path === undefined
        ? source === 'api'
          ? `/api/internal/things/${n}`
          : null
        : overrides.path,
      overrides.status === undefined ? (source === 'api' ? 200 : null) : overrides.status,
      json(overrides.query),
      json(overrides.body),
      overrides.truncated ?? false,
      overrides.requestId ?? null,
      overrides.subjectType ?? null,
      overrides.subjectId ?? null,
      overrides.eventId ?? null,
      json(overrides.payload),
    ],
  );
  return rows[0]!;
}
