import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, type StartedPostgres } from './postgres.ts';

describe('startPostgres', () => {
  let db: StartedPostgres;

  beforeAll(async () => {
    db = await startPostgres();
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('returns a URL that accepts connections', async () => {
    const client = new pg.Client({ connectionString: db.url });
    await client.connect();
    try {
      const result = await client.query<{ one: number }>('select 1 as one');
      expect(result.rows).toEqual([{ one: 1 }]);
    } finally {
      await client.end();
    }
  });
});
