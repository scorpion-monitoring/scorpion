// The channel a change of somebody's inbox is announced on (ADR-0028). Kept apart from the stream so that
// the inbox service (which announces) and the stream (which listens) do not import each other.
import type { DbTx } from '@scorpion/kernel';
import { sql } from 'drizzle-orm';

/** The payload is a user id and nothing else: never a title, a text or a link. */
export const INBOX_CHANNEL = 'notify_inbox';

/** Announces that somebody's inbox changed. Inside a transaction it is delivered on commit, never for a rollback. */
export function announceInboxChange(tx: Pick<DbTx, 'execute'>, userId: string) {
  return tx.execute(sql`select pg_notify(${INBOX_CHANNEL}, ${userId})`);
}
