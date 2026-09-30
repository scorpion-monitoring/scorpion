// Loader step 2. Each module has its own Drizzle migration folder and its own journal table,
// `kernel_migrations_<module id>`. All modules migrate in dependency order under one Postgres
// advisory lock, and each module's pending migrations run in one transaction together with the
// table-prefix check, so a module that breaks the rule leaves nothing behind (ADR 0004).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type pg from 'pg';
import { KernelStartupError } from './errors.ts';
import type { Logger } from './logger.ts';

/** Held for the whole migration run. The two integers are arbitrary but fixed: "SCOR", 1. */
export const MIGRATION_LOCK: readonly [number, number] = [0x53434f52, 1];

export const KERNEL_MODULE = 'kernel';
export const KERNEL_TABLE_PREFIX = 'kernel_';

export interface MigrationTarget {
  /** Module id, or `kernel`. */
  id: string;
  /** The folder with `meta/_journal.json`; a `file:` URL or a path. Undefined: no migrations. */
  migrations?: string | URL;
  /** Every table this module creates must start with this. */
  tablePrefix: string;
}

export interface MigrationReport {
  /** Number of migrations this run applied, per module (modules with none are left out). */
  applied: Record<string, number>;
}

export function journalTable(moduleId: string): string {
  const name = `kernel_migrations_${moduleId.replaceAll(/[.-]/g, '_')}`;
  if (Buffer.byteLength(name) > 63) {
    throw new KernelStartupError('Cannot migrate:', [
      `the journal table name for "${moduleId}" exceeds 63 bytes`,
    ]);
  }
  return name;
}

function folderOf(target: MigrationTarget): string | undefined {
  if (target.migrations === undefined) return undefined;
  return target.migrations instanceof URL || target.migrations.startsWith('file:')
    ? fileURLToPath(target.migrations)
    : target.migrations;
}

function readMigrations(target: MigrationTarget): MigrationMeta[] {
  const folder = folderOf(target);
  if (folder === undefined) return [];
  if (!existsSync(folder)) {
    throw new KernelStartupError(`Cannot migrate "${target.id}":`, [
      `migrations folder ${folder} does not exist`,
    ]);
  }
  try {
    return readMigrationFiles({ migrationsFolder: folder });
  } catch (error) {
    throw new KernelStartupError(`Cannot migrate "${target.id}":`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

async function baseTables(client: pg.ClientBase): Promise<Set<string>> {
  const { rows } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = current_schema() and table_type = 'BASE TABLE'`,
  );
  return new Set(rows.map((row) => row.table_name));
}

async function migrateOne(
  client: pg.ClientBase,
  target: MigrationTarget,
  log: Logger,
): Promise<number> {
  const migrations = readMigrations(target);
  if (migrations.length === 0) return 0;
  const journal = journalTable(target.id);

  await client.query('begin');
  try {
    const before = await baseTables(client);
    await client.query(
      `create table if not exists "${journal}" (id serial primary key, hash text not null, created_at bigint)`,
    );
    const last = await client.query<{ created_at: string }>(
      `select created_at from "${journal}" order by created_at desc limit 1`,
    );
    const lastApplied = last.rows[0] ? Number(last.rows[0].created_at) : -Infinity;
    const pending = migrations.filter((migration) => lastApplied < migration.folderMillis);

    for (const migration of pending) {
      for (const statement of migration.sql) await client.query(statement);
      await client.query(`insert into "${journal}" ("hash", "created_at") values ($1, $2)`, [
        migration.hash,
        migration.folderMillis,
      ]);
    }

    // The table-prefix rule: what this run created must carry the module's prefix. The journal
    // table belongs to the kernel.
    const created = [...(await baseTables(client))].filter((name) => !before.has(name));
    const stray = created.filter(
      (name) => !name.startsWith(target.tablePrefix) && name !== journal,
    );
    if (stray.length > 0) {
      throw new KernelStartupError(`Module "${target.id}" broke the table-prefix rule:`, [
        `it created ${stray.map((name) => `"${name}"`).join(', ')}, but its tables must start with "${target.tablePrefix}"`,
      ]);
    }

    await client.query('commit');
    if (pending.length > 0)
      log.info({ module: target.id, migrations: pending.length }, 'migrations applied');
    return pending.length;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

/**
 * Applies the pending migrations of every target, in the order given (dependencies first). Two
 * processes calling this at once are serialised by the advisory lock: the second waits, then
 * finds everything applied.
 */
export async function runMigrations(
  pool: pg.Pool,
  targets: readonly MigrationTarget[],
  log: Logger,
): Promise<MigrationReport> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('select pg_advisory_lock($1, $2)', [...MIGRATION_LOCK]);
    const applied: Record<string, number> = {};
    for (const target of targets) {
      const count = await migrateOne(client, target, log);
      if (count > 0) applied[target.id] = count;
    }
    return { applied };
  } catch (error) {
    broken = true;
    throw error;
  } finally {
    try {
      await client.query('select pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK]);
    } catch {
      broken = true; // The session ends with the connection, which frees the lock.
    }
    client.release(broken ? true : undefined);
  }
}

/** Modules with migrations that have not been applied. `/readyz` uses this. */
export async function pendingMigrations(
  pool: pg.Pool,
  targets: readonly MigrationTarget[],
): Promise<{ module: string; pending: number }[]> {
  const result: { module: string; pending: number }[] = [];
  for (const target of targets) {
    const migrations = readMigrations(target);
    if (migrations.length === 0) continue;
    const journal = journalTable(target.id);
    const exists = await pool.query<{ found: string | null }>('select to_regclass($1) as found', [
      journal,
    ]);
    let lastApplied = -Infinity;
    if (exists.rows[0]?.found) {
      const last = await pool.query<{ created_at: string }>(
        `select created_at from "${journal}" order by created_at desc limit 1`,
      );
      if (last.rows[0]) lastApplied = Number(last.rows[0].created_at);
    }
    const pending = migrations.filter((migration) => lastApplied < migration.folderMillis).length;
    if (pending > 0) result.push({ module: target.id, pending });
  }
  return result;
}
