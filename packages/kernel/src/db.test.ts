import { sql } from 'drizzle-orm';
import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { activeTransaction, createDb, type Db } from './db.ts';

let server: StartedPostgres;
let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  server = await startPostgres();
  pool = new pg.Pool({ connectionString: await server.createDatabase(), max: 5 });
  db = createDb(pool);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
});

beforeEach(async () => {
  await pool.query('drop table if exists tx_test');
  await pool.query('create table tx_test (id int primary key, note text)');
});

const rows = async () =>
  (await pool.query<{ id: number }>('select id from tx_test order by id')).rows.map((r) => r.id);
const insert = (tx: { execute: Db['execute'] }, id: number) =>
  tx.execute(sql`insert into tx_test (id) values (${id})`);

describe('ctx.db.tx', () => {
  it('commits when the callback resolves and returns its value', async () => {
    const result = await db.tx(async (tx) => {
      await insert(tx, 1);
      await insert(tx, 2);
      return 'done';
    });
    expect(result).toBe('done');
    expect(await rows()).toEqual([1, 2]);
  });

  it('rolls back every write when the callback throws, and rethrows', async () => {
    await expect(
      db.tx(async (tx) => {
        await insert(tx, 1);
        await insert(tx, 2);
        throw new Error('boom');
      }),
    ).rejects.toThrowError('boom');
    expect(await rows()).toEqual([]);
  });

  it('rolls back when a statement fails part-way through a multi-row write', async () => {
    await pool.query('insert into tx_test (id) values (2)');
    await expect(
      db.tx(async (tx) => {
        await insert(tx, 1);
        await insert(tx, 2); // duplicate key
      }),
    ).rejects.toThrow();
    expect(await rows()).toEqual([2]);
  });

  it('does not show uncommitted rows to other connections', async () => {
    await db.tx(async (tx) => {
      await insert(tx, 1);
      expect(await rows()).toEqual([]);
    });
    expect(await rows()).toEqual([1]);
  });

  it('nests through savepoints: an inner failure that is caught keeps the outer writes', async () => {
    await db.tx(async (outer) => {
      await insert(outer, 1);
      await expect(
        db.tx(async (inner) => {
          await insert(inner, 2);
          throw new Error('inner');
        }),
      ).rejects.toThrowError('inner');
      await insert(outer, 3);
    });
    expect(await rows()).toEqual([1, 3]);
  });

  it('nests through savepoints: an outer failure discards the committed inner part', async () => {
    await expect(
      db.tx(async (outer) => {
        await insert(outer, 1);
        await db.tx(async (inner) => {
          await insert(inner, 2);
        });
        throw new Error('outer');
      }),
    ).rejects.toThrowError('outer');
    expect(await rows()).toEqual([]);
  });

  it('nests three deep and rolls back only the level that fails', async () => {
    await db.tx(async (a) => {
      await insert(a, 1);
      await db.tx(async (b) => {
        await insert(b, 2);
        await db
          .tx(async (c) => {
            await insert(c, 3);
            throw new Error('deepest');
          })
          .catch(() => undefined);
        await insert(b, 4);
      });
    });
    expect(await rows()).toEqual([1, 2, 4]);
  });

  it('exposes the active transaction to code that has no reference to it', async () => {
    expect(activeTransaction()).toBeUndefined();
    await db.tx(async (tx) => {
      expect(activeTransaction()).toBe(tx);
      await db.tx((inner) => {
        expect(activeTransaction()).toBe(inner);
        return Promise.resolve();
      });
      expect(activeTransaction()).toBe(tx);
    });
    expect(activeTransaction()).toBeUndefined();
  });

  it('keeps concurrent transactions apart', async () => {
    await Promise.all([
      db.tx(async (tx) => {
        await insert(tx, 1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(activeTransaction()).toBe(tx);
      }),
      db
        .tx(async (tx) => {
          await insert(tx, 2);
          throw new Error('only this one');
        })
        .catch(() => undefined),
    ]);
    expect(await rows()).toEqual([1]);
  });
});
