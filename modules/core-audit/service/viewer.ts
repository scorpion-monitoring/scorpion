// Reading the trail: a filtered, paged list, one entry, and the CSV export. Needs `core.audit.read`
// and `core.audit.export` and nothing else (the permission is checked in the route and again here).
// Nothing in a row is a secret: bodies were redacted and capped when they were written.
import { Readable } from 'node:stream';
import { NotFound, z, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { Db } from '@scorpion/kernel';
import { and, desc, eq, gte, like, lte, sql, type SQL } from 'drizzle-orm';
import { auditEvent } from '../db/schema.ts';
import type { AuditSettings } from '../settings-schema.ts';
import { csvRow } from './csv.ts';
import type { Store } from './store.ts';

export const PERMISSION_READ = 'core.audit.read';
export const PERMISSION_EXPORT = 'core.audit.export';

export const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const auditFilterSchema = z.strictObject({
  method: z.enum(METHODS).optional(),
  /** The id of the user (or the opaque id the event carried). */
  user: z.string().min(1).max(200).optional(),
  /** The route template starts with this: `/api/internal/users`. */
  endpoint: z.string().min(1).max(500).optional(),
  action: z.string().min(1).max(200).optional(),
  outcome: z.enum(['ok', 'denied', 'error']).optional(),
  source: z.enum(['event', 'api']).optional(),
  /** At or after. */
  from: z.date().optional(),
  /** At or before. */
  to: z.date().optional(),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

export interface AuditEventView {
  id: string;
  occurredAt: Date;
  source: 'event' | 'api';
  action: string;
  outcome: 'ok' | 'denied' | 'error';
  actorKind: 'user' | 'token' | 'anonymous' | 'system';
  userId: string | null;
  tokenId: string | null;
  ip: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  query: unknown;
  body: unknown;
  truncated: boolean;
  requestId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  payload: unknown;
  /** The username of `userId` now, or `null` when there is no user id or the account no longer exists (purged). */
  userName: string | null;
}

export interface ExportResult {
  /** UTF-8 CSV, written in batches as it is read. */
  stream: ReadableStream<Uint8Array>;
  /** Rows the file will hold. */
  rows: number;
  /** True when more rows matched than the cap allows. */
  capped: boolean;
  cap: number;
}

export interface ViewerService {
  list(
    actor: Actor,
    filter: AuditFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ events: AuditEventView[]; total: number }>;
  get(actor: Actor, id: string): Promise<AuditEventView>;
  /**
   * Needs `core.audit.export`. Counts the matching rows, caps them at the `csvMaxRows` setting, writes
   * the audit entry for the export itself (who, which filters, how many rows) and returns the stream.
   * Cells are quoted, and a cell that starts with `= + - @`, a tab or a line break gets a leading `'`.
   */
  exportCsv(actor: Actor, filter: AuditFilter): Promise<ExportResult>;
}

export const CSV_COLUMNS = [
  'id',
  'occurred_at',
  'source',
  'action',
  'outcome',
  'actor_kind',
  'user_id',
  'token_id',
  'ip',
  'method',
  'path',
  'status',
  'subject_type',
  'subject_id',
  'request_id',
  'truncated',
  'query',
  'body',
  'payload',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPORT_BATCH = 500;

/** `100%_a\b` → `100\%\_a\\b`, so a prefix typed by a person is matched literally. */
export function escapeLike(text: string): string {
  return text.replaceAll(/[\\%_]/g, (c) => `\\${c}`);
}

export function whereOf(filter: AuditFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    filter.method ? eq(auditEvent.method, filter.method) : undefined,
    filter.user ? eq(auditEvent.userId, filter.user) : undefined,
    filter.endpoint ? like(auditEvent.path, `${escapeLike(filter.endpoint)}%`) : undefined,
    filter.action ? eq(auditEvent.action, filter.action) : undefined,
    filter.outcome ? eq(auditEvent.outcome, filter.outcome) : undefined,
    filter.source ? eq(auditEvent.source, filter.source) : undefined,
    filter.from ? gte(auditEvent.occurredAt, filter.from) : undefined,
    filter.to ? lte(auditEvent.occurredAt, filter.to) : undefined,
  ];
  const present = parts.filter((part): part is SQL => part !== undefined);
  return present.length > 0 ? and(...present) : undefined;
}

const columns = {
  id: auditEvent.id,
  occurredAt: auditEvent.occurredAt,
  source: auditEvent.source,
  action: auditEvent.action,
  outcome: auditEvent.outcome,
  actorKind: auditEvent.actorKind,
  userId: auditEvent.userId,
  tokenId: auditEvent.tokenId,
  ip: auditEvent.ip,
  method: auditEvent.method,
  path: auditEvent.path,
  status: auditEvent.status,
  query: auditEvent.query,
  body: auditEvent.body,
  truncated: auditEvent.truncated,
  requestId: auditEvent.requestId,
  subjectType: auditEvent.subjectType,
  subjectId: auditEvent.subjectId,
  payload: auditEvent.payload,
};

/** The filters that were set, for the audit entry of an export: values, no more. */
const filtersOf = (filter: AuditFilter) =>
  Object.fromEntries(
    Object.entries(filter).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

export interface ViewerDeps {
  db: Db;
  authz: Pick<AuthzService, 'require'>;
  settings: () => Promise<AuditSettings>;
  store: Store;
  /** Usernames by id for the ids that still have an account; an id without one is left out. */
  usernames: (ids: string[]) => Promise<Map<string, string>>;
}

type Row = Omit<AuditEventView, 'userName'>;

export function createViewer({ db, authz, settings, store, usernames }: ViewerDeps): ViewerService {
  /** The events carry ids, never names (a purge cannot erase an append-only table); the name is joined when read. */
  async function named(rows: Row[]): Promise<AuditEventView[]> {
    const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => !!id))];
    const names = ids.length > 0 ? await usernames(ids) : new Map<string, string>();
    return rows.map((row) => ({
      ...row,
      userName: row.userId ? (names.get(row.userId) ?? null) : null,
    }));
  }

  return {
    async list(actor, filter, page) {
      await authz.require(actor, PERMISSION_READ);
      const where = whereOf(filter);
      const [events, [counted]] = await Promise.all([
        db
          .select(columns)
          .from(auditEvent)
          .where(where)
          .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(auditEvent)
          .where(where),
      ]);
      return { events: await named(events as Row[]), total: counted!.n };
    },

    async get(actor, id) {
      await authz.require(actor, PERMISSION_READ);
      // A malformed id is not found either: the same answer, and no query for it.
      if (!UUID.test(id)) throw new NotFound('There is no such audit entry.');
      const [found] = await db
        .select(columns)
        .from(auditEvent)
        .where(eq(auditEvent.id, id.toLowerCase()));
      if (!found) throw new NotFound('There is no such audit entry.');
      return (await named([found as Row]))[0]!;
    },

    async exportCsv(actor, filter) {
      await authz.require(actor, PERMISSION_EXPORT);
      const cap = (await settings()).csvMaxRows;
      // The file is the trail as it was when the export began: the entry written below is not in it.
      const { rows: clock } = await db.execute<{ t: string }>(
        sql`select clock_timestamp()::text as t`,
      );
      const where = and(
        whereOf(filter),
        sql`${auditEvent.occurredAt} <= ${clock[0]!.t}::timestamptz`,
      );
      const [counted] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(auditEvent)
        .where(where);
      const total = counted!.n;
      const rows = Math.min(total, cap);
      const capped = total > cap;

      // The export is an administrative action of its own, and it is on the record before the first byte.
      await store.recordAlways({
        action: 'audit.exported',
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
        subject: { type: 'audit', id: null },
        payload: { rows, capped, filters: filtersOf(filter) },
      });

      async function* lines(): AsyncGenerator<Uint8Array> {
        const encoder = new TextEncoder();
        yield encoder.encode(csvRow([...CSV_COLUMNS]));
        let written = 0;
        let cursor: { at: string; id: string } | undefined;
        while (written < rows) {
          const keyset = cursor
            ? sql`(${auditEvent.occurredAt}, ${auditEvent.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined;
          const batch = await db
            .select({ ...columns, at: sql<string>`${auditEvent.occurredAt}::text` })
            .from(auditEvent)
            .where(and(where, keyset))
            .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
            .limit(Math.min(EXPORT_BATCH, rows - written));
          if (batch.length === 0) return;
          for (const row of batch) {
            yield encoder.encode(
              csvRow([
                row.id,
                row.occurredAt,
                row.source,
                row.action,
                row.outcome,
                row.actorKind,
                row.userId,
                row.tokenId,
                row.ip,
                row.method,
                row.path,
                row.status,
                row.subjectType,
                row.subjectId,
                row.requestId,
                row.truncated,
                row.query as object | null,
                row.body as object | null,
                row.payload as object | null,
              ]),
            );
          }
          written += batch.length;
          const last = batch.at(-1)!;
          cursor = { at: last.at, id: last.id };
        }
      }

      return {
        stream: Readable.toWeb(Readable.from(lines())) as ReadableStream<Uint8Array>,
        rows,
        capped,
        cap,
      };
    },
  };
}
