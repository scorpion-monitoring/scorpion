// The audit extension point (ADR 0021), modelled on the authoriser (ADR 0005). The kernel owns the
// registry `kernel.auditSink`; `core.audit` contributes the one entry. Without an entry the sink does
// nothing, so a profile without `core.audit` starts and runs as before.
//
// The kernel only carries entries. What is stored, redacted and cut is the sink's business, so the
// pipeline's entries and a service's `ctx.audit(entry)` go through one implementation.
import { z } from 'zod';

export const AUDIT_SINK_REGISTRY = 'kernel.auditSink';

/** Who did it. `system` is code with no human caller (a job, the bootstrap). */
export interface AuditActor {
  kind: 'user' | 'token' | 'anonymous' | 'system';
  /** An opaque id; kept as written, no foreign key. */
  userId?: string | null;
  /** The id of the personal access token (never the token), when `kind` is `token`. */
  tokenId?: string | null;
}

export interface AuditEntry {
  /** `api.POST` for a request, else the domain action: `system.outbox.requeued`. Lower-case dotted words. */
  action: string;
  outcome: 'ok' | 'denied' | 'error';
  /** `api` is the request log; `event` is a domain or administrative action. Default for `ctx.audit`: `event`. */
  source?: 'event' | 'api';
  /** The API surface of a request. `v1` is the public API; the rest is the administrators' channel. */
  surface?: 'internal' | 'v1';
  actor: AuditActor;
  /** The client address as the pipeline resolved it. */
  ip?: string | null;
  method?: string;
  /** The route template, `/api/internal/users/{id}/approve`, never the concrete URL. */
  path?: string;
  status?: number;
  /** Raw and unredacted: the sink redacts and caps it. Only a route that opted in provides these. */
  query?: unknown;
  body?: unknown;
  /** Extra keys to redact on top of the sink's own list (the route's `redact`). */
  redact?: readonly string[];
  requestId?: string | null;
  subject?: { type: string; id?: string | null };
  /** Domain details of a `ctx.audit` entry. Redacted and capped like a body. Never a secret. */
  payload?: unknown;
}

/** Writes one entry. A failure rejects; the caller decides what that means (ADR 0021). */
export type AuditSink = (entry: AuditEntry) => Promise<void>;

export const auditSinkEntrySchema = z.strictObject({
  record: z.custom<AuditSink>((value) => typeof value === 'function', 'expected a function'),
});

/** The sink in force while no module has contributed one. */
export const noAuditSink: AuditSink = () => Promise.resolve();

/** What a route's `audit` option means once the shorthand is expanded. `undefined`: do not audit. */
export interface RouteAudit {
  body: boolean;
  redact: readonly string[];
}

export function routeAudit(
  audit: boolean | { body?: boolean; redact?: readonly string[] } | undefined,
): RouteAudit | undefined {
  if (audit === undefined || audit === false) return undefined;
  if (audit === true) return { body: false, redact: [] };
  return { body: audit.body === true, redact: audit.redact ?? [] };
}
