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

// The connections each pool from `createPool` has open, so `closePool` can wait for them.
const openClients = new WeakMap<pg.Pool, Set<pg.PoolClient>>();

/**
 * One shared pool for the whole process. pg-boss gets the same connection settings.
 *
 * An idle connection that the server ends (a restart, `pg_terminate_backend`, a stopped test
 * container) makes the pool emit `error`; without a listener Node throws it as an uncaught
 * exception. The pool has already dropped that connection, so `onError` only reports it.
 */
export function createPool(
  config: Pick<Config, 'DATABASE_URL'>,
  options: { max?: number; onError?: (error: Error) => void } = {},
): pg.Pool {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: options.max ?? 10 });
  const onError = options.onError ?? (() => {});
  pool.on('error', (error) => onError(error));
  const clients = new Set<pg.PoolClient>();
  openClients.set(pool, clients);
  pool.on('connect', (client) => {
    clients.add(client);
    client.once('end', () => clients.delete(client));
  });
  return pool;
}

/**
 * Ends the pool and waits until every connection is closed. `pool.end()` alone resolves once the
 * pool has let go of its connections, before they are closed; a server that stops in that gap
 * ends them with an error (57P01).
 */
export async function closePool(pool: pg.Pool): Promise<void> {
  const closing = [...(openClients.get(pool) ?? [])].map(
    (client) => new Promise<void>((resolve) => client.once('end', () => resolve())),
  );
  await pool.end();
  await Promise.all(closing);
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
  return { pool, db: createDb(pool), close: () => closePool(pool) };
}
