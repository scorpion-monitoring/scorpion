// "Where does this string live?": every table of the database that holds a row mentioning it. For the
// tests that prove a secret exists in one place only (a reset token in the mail, then nowhere). It reads
// every table as text, so it knows nothing about any module.
import type { Queryable } from './identity.ts';

/**
 * The names of the tables with at least one row whose text form contains `needle`, sorted. `needle` is
 * matched literally (no wildcard). Tables of the migration journals are skipped: they hold hashes.
 */
export async function tablesContaining(db: Queryable, needle: string): Promise<string[]> {
  const { rows: tables } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  const found: string[] = [];
  for (const { table_name } of tables) {
    if (table_name.startsWith('__drizzle')) continue;
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from "${table_name}" t where strpos(t::text, $1) > 0`,
      [needle],
    );
    if (rows[0]!.n > 0) found.push(table_name);
  }
  return found;
}
