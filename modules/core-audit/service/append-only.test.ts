// The table refuses what is not an append (ADR 0021): UPDATE, an ordinary DELETE and TRUNCATE. The two
// exceptions need the transaction-local flag that only the retention job sets.
import { makeAuditEvent } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { MAINTENANCE_FLAG } from './retention.ts';
import { useAudit } from '../test/harness.ts';

const audit = useAudit();

const refused = async (promise: Promise<unknown>) => {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as { code?: string; message?: string } | undefined;
  expect(error, 'the statement was accepted').toBeDefined();
  expect(error!.code).toBe('42501');
  expect(error!.message).toContain('append-only');
};

describe('audit_event is append-only', () => {
  it('[ASVS-V16.4.2] accepts an INSERT and refuses an UPDATE of any column', async () => {
    const s = await audit.startShared();
    const row = await makeAuditEvent(s.pool, { action: 'test.insert' });
    expect((await s.rows('id = $1', [row.id]))[0]!.action).toBe('test.insert');
    for (const column of ['action', 'outcome', 'ip', 'body', 'user_id', 'occurred_at']) {
      const value =
        column === 'occurred_at'
          ? "now() - interval '1 day'"
          : column === 'outcome'
            ? "'error'"
            : column === 'body'
              ? "'{}'::jsonb"
              : "'x'";
      await refused(
        s.pool.query(`update audit_event set ${column} = ${value} where id = $1`, [row.id]),
      );
    }
    const [after] = await s.rows('id = $1', [row.id]);
    expect(after).toEqual(row);
  });

  it('[ASVS-V16.4.2] refuses an ordinary DELETE, of one row and of all', async () => {
    const s = await audit.startShared();
    const row = await makeAuditEvent(s.pool);
    await refused(s.pool.query('delete from audit_event where id = $1', [row.id]));
    await refused(s.pool.query('delete from audit_event'));
    expect(await s.rows('id = $1', [row.id])).toHaveLength(1);
  });

  it('refuses TRUNCATE', async () => {
    const s = await audit.startShared();
    await makeAuditEvent(s.pool);
    await refused(s.pool.query('truncate audit_event'));
    expect((await s.rows()).length).toBeGreaterThan(0);
  });

  it('lets the maintenance flag through for a DELETE, in that transaction only', async () => {
    const s = await audit.startShared();
    const row = await makeAuditEvent(s.pool);
    const client = await s.pool.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', [MAINTENANCE_FLAG, 'on']);
      await client.query('delete from audit_event where id = $1', [row.id]);
      await client.query('commit');
      expect(await s.rows('id = $1', [row.id])).toHaveLength(0);

      // The flag ended with the transaction: the same connection is refused again.
      const another = await makeAuditEvent(s.pool);
      await refused(client.query('delete from audit_event where id = $1', [another.id]));
    } finally {
      client.release();
    }
  });

  it('with the flag, an UPDATE may change the ip and nothing else', async () => {
    const s = await audit.startShared();
    const row = await makeAuditEvent(s.pool, { ip: '203.0.113.7' });
    const client = await s.pool.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', [MAINTENANCE_FLAG, 'on']);
      await client.query("update audit_event set ip = '203.0.113.0/24' where id = $1", [row.id]);
      await refused(
        client.query("update audit_event set action = 'changed' where id = $1", [row.id]),
      );
      await client.query('rollback');
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', [MAINTENANCE_FLAG, 'on']);
      await refused(
        client.query("update audit_event set ip = '1.2.3.0/24', outcome = 'error' where id = $1", [
          row.id,
        ]),
      );
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect((await s.rows('id = $1', [row.id]))[0]).toEqual(row);
  });

  it('does not let any flag value but "on" through', async () => {
    const s = await audit.startShared();
    const row = await makeAuditEvent(s.pool);
    const client = await s.pool.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', [MAINTENANCE_FLAG, 'true']);
      await refused(client.query('delete from audit_event where id = $1', [row.id]));
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
