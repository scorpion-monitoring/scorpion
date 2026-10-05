import type { Context, MiddlewareHandler } from 'hono';
import {
  ANONYMOUS,
  NEVER_AUDIT_BODY,
  type Actor,
  type AppEnv,
  type AppRoute,
} from '@scorpion/contracts';
import {
  routeAudit,
  type AuditActor,
  type AuditEntry,
  type AuditSink,
  type Logger,
  type RouteAudit,
} from '@scorpion/kernel';
import type { ClientIpResolver } from './client-ip.ts';

/** A body that is larger than this is not read for the trail; the entry says so instead (the server limit is 1 MiB). */
const MAX_BODY_READ_BYTES = 256 * 1024;
/** How long a request waits for the sink before the entry is given up (and logged by request id). */
export const AUDIT_WRITE_TIMEOUT_MS = 2_000;

/** 2xx and 3xx are `ok`; 401, 403 and 429 are `denied` (the caller was turned away); the rest is `error`. */
export function outcomeOf(status: number): AuditEntry['outcome'] {
  if (status < 400) return 'ok';
  return status === 401 || status === 403 || status === 429 ? 'denied' : 'error';
}

export function auditActorOf(actor: Actor | undefined): AuditActor {
  const who = actor ?? ANONYMOUS;
  if (who.kind !== 'user') return { kind: 'anonymous' };
  return who.via === 'token'
    ? { kind: 'token', userId: who.userId, tokenId: who.tokenId ?? null }
    : { kind: 'user', userId: who.userId };
}

/** `/api/internal/users/{id}/roles` → type `users`, id from the last path parameter, if the route has one. */
function subjectOf(c: Context, template: string, prefix: string) {
  const segments = template.slice(prefix.length).split('/').filter(Boolean);
  const type = segments[0]?.replace(/\{.*\}/, '') || undefined;
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  const last = names.at(-1);
  const id = last === undefined ? undefined : c.req.param(last);
  return type ? { type, id: id ?? null } : undefined;
}

async function readBody(clone: Request): Promise<unknown> {
  const declared = Number(clone.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_READ_BYTES) return `[body of ${declared} bytes not stored]`;
  const text = await clone.text();
  if (text === '') return undefined;
  if (Buffer.byteLength(text) > MAX_BODY_READ_BYTES) return '[body not stored: too large]';
  if (/json/i.test(clone.headers.get('content-type') ?? '')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Fall through: a body that claims to be JSON and is not is described, never copied.
    }
  }
  return `[non-JSON body, ${Buffer.byteLength(text)} bytes]`;
}

function queryOf(c: Context): Record<string, string | string[]> | undefined {
  const queries = c.req.queries();
  const keys = Object.keys(queries);
  if (keys.length === 0) return undefined;
  return Object.fromEntries(
    keys.map((key) => [key, queries[key]!.length === 1 ? queries[key]![0]! : queries[key]!]),
  );
}

export interface AuditRequestOptions {
  sink: AuditSink;
  route: AppRoute;
  /** `/api/internal/users/{id}/approve`: the route template with its surface prefix, no base path. */
  template: string;
  surface: 'internal' | 'v1';
  prefix: string;
  clientIp: ClientIpResolver;
  log: Logger;
}

/**
 * Step 4a: the audit hook of a route with `audit` (ADR 0021). It wraps everything after it, rate
 * limit and authentication included, so a 429, a 401 and a 403 are recorded too; the entry is written
 * once the response is formed. The body and query string are read only for a route that opted in with
 * `body: true` and never under `/auth/`. A failure to write is logged by request id and error code
 * and **never changes the response**.
 */
export function auditRequest(options: AuditRequestOptions): MiddlewareHandler<AppEnv> {
  const { sink, route, template, surface, prefix, clientIp, log } = options;
  const wanted = routeAudit(route.audit) as RouteAudit;
  const storeBody = wanted.body && !NEVER_AUDIT_BODY.test(route.path);
  const method = route.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';

  return async (c, next) => {
    // Before the body is consumed; the branch of the tee is ours.
    const copy = storeBody && hasBody ? c.req.raw.clone() : undefined;
    let thrown: unknown;
    try {
      await next();
    } catch (error) {
      thrown = error;
    }
    const status = thrown === undefined ? c.res.status : 500;
    const requestId = c.get('requestId');
    try {
      const entry: AuditEntry = {
        action: `api.${method}`,
        outcome: outcomeOf(status),
        source: 'api',
        surface,
        actor: auditActorOf(c.get('actor')),
        ip: clientIp(c) ?? null,
        method,
        path: template,
        status,
        requestId,
        subject: subjectOf(c, template, prefix),
        redact: wanted.redact,
        ...(storeBody ? { query: queryOf(c), body: copy ? await readBody(copy) : undefined } : {}),
      };
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          sink(entry),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), AUDIT_WRITE_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      // The request id and the error code only: a driver message can quote the row it refused.
      // Drizzle wraps the driver's error: the SQLSTATE is on the cause.
      const failure = error as { code?: unknown; cause?: { code?: unknown } } | null;
      const code = failure?.code ?? failure?.cause?.code;
      log.error(
        { requestId, route: template, code: typeof code === 'string' ? code : undefined },
        'audit entry could not be written',
      );
    }
    if (thrown !== undefined) throw thrown as Error;
  };
}
