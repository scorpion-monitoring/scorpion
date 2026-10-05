// The kernel sink as core.audit implements it: what is stored of an entry, and what is not.
import { describe, expect, it } from 'vitest';
import { makeAuditEvent } from '@scorpion/testing';
import { useAudit } from '../test/harness.ts';

const audit = useAudit();

const request = {
  action: 'api.POST',
  outcome: 'ok',
  source: 'api',
  surface: 'internal',
  actor: { kind: 'user', userId: 'u-1' },
  ip: '203.0.113.9',
  method: 'POST',
  path: '/api/internal/things/{id}',
  status: 200,
  requestId: 'req-1',
} as const;

// The entry type without importing it twice.
type Entry = Parameters<
  Awaited<ReturnType<ReturnType<typeof useAudit>['startShared']>>['audit']['store']['record']
>[0];
const entry = (over: Partial<Entry> = {}): Entry => ({ ...(request as unknown as Entry), ...over });

describe('what the sink stores', () => {
  it('stores a request entry as given, with the route template and no body', async () => {
    const s = await audit.startShared();
    const requestId = `req-${Math.random()}`;
    await s.audit.store.record(
      entry({ requestId, body: { password: 'hunter2' }, query: { token: 'abc' } }),
    );
    // The pipeline passes a body only for a route that opted in; the sink stores what it is given, redacted.
    const [row] = await s.rows('request_id = $1', [requestId]);
    expect(row).toMatchObject({
      source: 'api',
      action: 'api.POST',
      outcome: 'ok',
      actor_kind: 'user',
      user_id: 'u-1',
      ip: '203.0.113.9',
      method: 'POST',
      path: '/api/internal/things/{id}',
      status: 200,
      truncated: false,
    });
    expect(row!.body).toEqual({ password: '[redacted]' });
    expect(row!.query).toEqual({ token: '[redacted]' });
  });

  it('redacts nested and array bodies, the route list, and a secret in the query string', async () => {
    const s = await audit.startShared();
    const requestId = `req-${Math.random()}`;
    await s.audit.store.record(
      entry({
        requestId,
        redact: ['iban'],
        body: {
          user: { name: 'n', credentials: [{ password: 'p1' }, { apiKey: 'k1' }] },
          iban: 'DE89',
          note: 'kept',
        },
        query: { page: '1', apikey: 'k2', 'x-secret': 's3' },
      }),
    );
    const [row] = await s.rows('request_id = $1', [requestId]);
    expect(row!.body).toEqual({
      user: { name: 'n', credentials: [{ password: '[redacted]' }, { apiKey: '[redacted]' }] },
      iban: '[redacted]',
      note: 'kept',
    });
    expect(row!.query).toEqual({ page: '1', apikey: '[redacted]', 'x-secret': '[redacted]' });
    const text = JSON.stringify(row);
    for (const secret of ['p1', 'k1', 'k2', 's3', 'DE89']) expect(text).not.toContain(secret);
  });

  it('stores a body that is not JSON as the description the pipeline gave it', async () => {
    const s = await audit.startShared();
    const requestId = `req-${Math.random()}`;
    await s.audit.store.record(entry({ requestId, body: '[non-JSON body, 12 bytes]' }));
    expect((await s.rows('request_id = $1', [requestId]))[0]!.body).toBe(
      '[non-JSON body, 12 bytes]',
    );
  });

  it('caps a large body at 8 KB, flags it, and keeps the redaction in the preview', async () => {
    const s = await audit.startShared();
    const requestId = `req-${Math.random()}`;
    await s.audit.store.record(
      entry({ requestId, body: { password: 'top-secret-pass', filler: 'x'.repeat(50_000) } }),
    );
    const { rows } = await s.pool.query<{ size: number; truncated: boolean; body: unknown }>(
      'select octet_length(body::text) as size, truncated, body from audit_event where request_id = $1',
      [requestId],
    );
    expect(rows[0]!.truncated).toBe(true);
    expect(rows[0]!.size).toBeLessThanOrEqual(8 * 1024 + 64); // jsonb text adds a few spaces
    expect(JSON.stringify(rows[0]!.body)).not.toContain('top-secret-pass');
    expect(rows[0]!.body).toMatchObject({ _truncated: true });
  });

  it('survives text Postgres refuses (NUL, lone surrogates) instead of losing the entry', async () => {
    const s = await audit.startShared();
    const requestId = `req-${Math.random()}`;
    await s.audit.store.record(
      entry({
        requestId,
        action: 'api.PO\u0000ST',
        path: '/api/internal/a\ud800b',
        body: { 'k\u0000ey': 'v\u0000al\ud800' },
      }),
    );
    const [row] = await s.rows('request_id = $1', [requestId]);
    expect(row).toBeDefined();
    expect(row!.action).toBe('api.PO�ST');
  });

  it('stores an address only when it is one, so the later cut cannot fail', async () => {
    const s = await audit.startShared();
    const good = `req-${Math.random()}`;
    const bad = `req-${Math.random()}`;
    await s.audit.store.record(entry({ requestId: good, ip: '2001:db8::1' }));
    await s.audit.store.record(entry({ requestId: bad, ip: 'not-an-address; drop table' }));
    expect((await s.rows('request_id = $1', [good]))[0]!.ip).toBe('2001:db8::1');
    expect((await s.rows('request_id = $1', [bad]))[0]!.ip).toBeNull();
  });

  it('treats a missing source as an administrative action', async () => {
    const s = await audit.startShared();
    const subjectId = `subject-${Math.random()}`;
    await s.audit.store.record({
      action: 'thing.archived',
      outcome: 'ok',
      actor: { kind: 'system' },
      subject: { type: 'thing', id: subjectId },
      payload: { count: 3, password: 'nope' },
    });
    const [row] = await s.rows('subject_id = $1', [subjectId]);
    expect(row).toMatchObject({
      source: 'event',
      actor_kind: 'system',
      payload: { count: 3, password: '[redacted]' },
    });
  });
});

describe('ctx.audit inside a transaction', () => {
  it('commits with the change', async () => {
    const s = await audit.startShared();
    const subjectId = `commit-${Math.random()}`;
    await s.kernel.db.tx(async () => {
      await s.kernel.audit({
        action: 'thing.created',
        outcome: 'ok',
        actor: { kind: 'system' },
        subject: { type: 'thing', id: subjectId },
      });
    });
    expect(await s.rows('subject_id = $1', [subjectId])).toHaveLength(1);
  });

  it('rolls back with the change: no row without its change, none for two entries of one transaction', async () => {
    const s = await audit.startShared();
    const subjectId = `rollback-${Math.random()}`;
    await expect(
      s.kernel.db.tx(async () => {
        for (const n of [1, 2]) {
          await s.kernel.audit({
            action: `thing.step${n}`,
            outcome: 'ok',
            actor: { kind: 'system' },
            subject: { type: 'thing', id: subjectId },
          });
        }
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect(await s.rows('subject_id = $1', [subjectId])).toHaveLength(0);
  });

  it('fails the call when the entry cannot be written, so the change does not happen without its trail', async () => {
    const s = await audit.startShared();
    await expect(
      s.kernel.audit({ action: 'x', outcome: 'bogus' as never, actor: { kind: 'system' } }),
    ).rejects.toThrow();
  });
});

describe('the channels setting for requests', () => {
  it('stops logging the public API when `api` is off, and the internal API when `admin` is off', async () => {
    const apiOff = await audit.start({ auditSettings: { channels: { admin: true, api: false } } });
    await apiOff.audit.store.record(entry({ requestId: 'v1', surface: 'v1' }));
    await apiOff.audit.store.record(entry({ requestId: 'int', surface: 'internal' }));
    expect((await apiOff.rows()).map((r) => r.request_id)).toEqual(['int']);

    const adminOff = await audit.start({
      auditSettings: { channels: { admin: false, api: true } },
    });
    await adminOff.audit.store.record(entry({ requestId: 'v1', surface: 'v1' }));
    await adminOff.audit.store.record(entry({ requestId: 'int', surface: 'internal' }));
    await adminOff.audit.store.record({
      action: 'thing.done',
      outcome: 'ok',
      actor: { kind: 'system' },
    });
    expect((await adminOff.rows()).map((r) => r.request_id)).toEqual(['v1']);
  });
});

it('keeps the factory honest: a row made by makeAuditEvent is readable by the same query as the sink writes', async () => {
  const s = await audit.startShared();
  const made = await makeAuditEvent(s.pool, { action: 'api.DELETE', path: '/api/internal/x' });
  expect((await s.rows('id = $1', [made.id]))[0]).toMatchObject({
    action: 'api.DELETE',
    source: 'api',
  });
});
