import { randomUUID } from 'node:crypto';
import { makeAuditEvent } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../test/csv-parse.ts';
import { useAudit } from '../test/harness.ts';
import { CSV_COLUMNS } from './viewer.ts';

const audit = useAudit();

async function read(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe('the CSV export', () => {
  it('writes a header and one record per match, newest first, with the cells escaped', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const tag = `/api/internal/csv-${randomUUID().slice(0, 8)}`;
    const t = Date.now() - 10_000;
    await makeAuditEvent(s.pool, {
      path: `${tag}/one, with comma`,
      occurredAt: new Date(t),
      body: { note: 'say "hi"\nnext line' },
      ip: '203.0.113.1',
    });
    await makeAuditEvent(s.pool, {
      path: `${tag}/two`,
      occurredAt: new Date(t + 1000),
      status: 403,
      outcome: 'denied',
    });
    const result = await s.audit.viewer.exportCsv(admin, { endpoint: tag });
    expect(result).toMatchObject({ rows: 2, capped: false });
    const records = parseCsv(await read(result.stream));
    expect(records[0]).toEqual([...CSV_COLUMNS]);
    expect(records).toHaveLength(3);
    const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);
    expect(records[1]![col('path')]).toBe(`${tag}/two`);
    expect(records[2]![col('path')]).toBe(`${tag}/one, with comma`);
    expect(records[2]![col('ip')]).toBe('203.0.113.1');
    expect(JSON.parse(records[2]![col('body')]!)).toEqual({ note: 'say "hi"\nnext line' });
    expect(records[1]![col('status')]).toBe('403');
    expect(records[1]![col('truncated')]).toBe('false');
  });

  it('[ASVS-V1.2.10] guards a cell that starts with = + - @ tab or CR, whichever column it is in', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const tag = randomUUID().slice(0, 8);
    const hostile = [
      `=HYPERLINK("http://evil","x")${tag}`,
      `+cmd|' /C calc'!A0${tag}`,
      `-2+3${tag}`,
      `@SUM(1+1)${tag}`,
      `\t=1${tag}`,
      `\r=1${tag}`,
    ];
    for (const [i, action] of hostile.entries()) {
      await makeAuditEvent(s.pool, {
        action,
        path: `/csvinj-${tag}/${i}`,
        userId: `=ID${i}`,
        subjectId: '@sub',
      });
    }
    const result = await s.audit.viewer.exportCsv(admin, { endpoint: `/csvinj-${tag}` });
    const text = await read(result.stream);
    const records = parseCsv(text).slice(1);
    expect(records).toHaveLength(hostile.length);
    for (const record of records) {
      for (const cell of record) {
        // No cell starts with a formula character: the guard put an apostrophe in front.
        expect(cell, `unguarded cell ${JSON.stringify(cell)}`).not.toMatch(/^[=+\-@\t\r]/);
      }
    }
    const actions = records.map((r) => r[CSV_COLUMNS.indexOf('action')]).sort();
    expect(actions).toEqual(hostile.map((h) => `'${h}`).sort());
    expect(records[0]![CSV_COLUMNS.indexOf('user_id')]).toMatch(/^'=ID/);
  });

  it('is capped by the setting, says so, and writes exactly that many rows', async () => {
    const s = await audit.start({ auditSettings: { csvMaxRows: 5 } });
    const admin = await s.actor('admin');
    for (let i = 0; i < 12; i += 1) await makeAuditEvent(s.pool, { path: `/capped/${i}` });
    const result = await s.audit.viewer.exportCsv(admin, { endpoint: '/capped' });
    expect(result).toMatchObject({ rows: 5, capped: true, cap: 5 });
    expect(parseCsv(await read(result.stream))).toHaveLength(6);
  });

  it('streams a large result in batches without losing or repeating a row', async () => {
    const s = await audit.start();
    const admin = await s.actor('admin');
    await s.pool.query(
      `insert into audit_event (id, occurred_at, source, action, outcome, actor_kind, path)
       select gen_random_uuid(), now() - interval '1 hour' - (n % 40) * interval '1 millisecond', 'api', 'api.GET', 'ok', 'system', '/bulk/' || n
         from generate_series(1, 1300) n`,
    );
    const result = await s.audit.viewer.exportCsv(admin, { endpoint: '/bulk/' });
    expect(result.rows).toBe(1300);
    const records = parseCsv(await read(result.stream)).slice(1);
    expect(records).toHaveLength(1300);
    expect(new Set(records.map((r) => r[0])).size).toBe(1300);
    const times = records.map((r) => r[1]!);
    expect([...times].sort().reverse()).toEqual(times); // still newest first across batches
  });

  it('is itself an audit entry: who, which filters, how many rows, written before the first byte, and not part of its own file', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const tag = `/self-${randomUUID().slice(0, 8)}`;
    await makeAuditEvent(s.pool, { path: `${tag}/x` });
    const result = await s.audit.viewer.exportCsv(admin, { endpoint: tag, outcome: 'ok' });
    // Before the stream is read:
    const [entry] = await s.rows(
      "action = 'audit.exported' and payload->'filters'->>'endpoint' = $1",
      [tag],
    );
    expect(entry).toMatchObject({
      source: 'event',
      outcome: 'ok',
      actor_kind: 'user',
      user_id: admin.userId,
      subject_type: 'audit',
      payload: { rows: 1, capped: false, filters: { endpoint: tag, outcome: 'ok' } },
    });
    const records = parseCsv(await read(result.stream)).slice(1);
    expect(records).toHaveLength(1);
    expect(records[0]![CSV_COLUMNS.indexOf('action')]).not.toBe('audit.exported');
  });

  it('is denied to a plain User and leaves no entry', async () => {
    const s = await audit.startShared();
    const plain = await s.actor('user');
    const before = (await s.rows("action = 'audit.exported'")).length;
    await expect(s.audit.viewer.exportCsv(plain, {})).rejects.toMatchObject({ status: 403 });
    await expect(s.audit.viewer.exportCsv({ kind: 'anonymous' }, {})).rejects.toMatchObject({
      status: 401,
    });
    expect(await s.rows("action = 'audit.exported'")).toHaveLength(before);
  });
});
