import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from './config.ts';

/** A Drizzle transaction, as passed to the callback of `ctx.db.tx()`. */
export type DbTx = Parameters<
  Parameters<NodePgDatabase<Record<string, never>>['transaction']>[0]
>[0];

export interface Db extends NodePgDatabase<Record<string, never>> {
  /**
   * Runs `fn` in one transaction: it commits when `fn` resolves and rolls back when it throws.
   * Called inside another `tx()`, it opens a savepoint instead, so a failure rolls back only the
   * inner part. Query through the `tx` argument, not through `db`, or the query runs outside
   * the transaction.
   */
  tx<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
}

const currentTx = new AsyncLocalStorage<DbTx>();

/** The transaction opened by the innermost `ctx.db.tx()` around the caller, if any. */
export function activeTransaction(): DbTx | undefined {
  return currentTx.getStore();
}

export interface DatabaseHandle {
  pool: pg.Pool;
  db: Db;
  /** Ends the pool. Call after all work has finished. */
  close(): Promise<void>;
}

/** One shared pool for the whole process. pg-boss gets the same connection settings. */
export function createPool(
  config: Pick<Config, 'DATABASE_URL'>,
  options: { max?: number } = {},
): pg.Pool {
  return new pg.Pool({ connectionString: config.DATABASE_URL, max: options.max ?? 10 });
}

export function createDb(pool: pg.Pool): Db {
  const base = drizzle({ client: pool });
  function tx<T>(fn: (transaction: DbTx) => Promise<T>): Promise<T> {
    const run = (transaction: DbTx) => currentTx.run(transaction, () => fn(transaction));
    const parent = currentTx.getStore();
    return parent ? parent.transaction(run) : base.transaction(run);
  }
  return Object.assign(base, { tx });
}

export function openDatabase(config: Pick<Config, 'DATABASE_URL'>): DatabaseHandle {
  const pool = createPool(config);
  return { pool, db: createDb(pool), close: () => pool.end() };
}
