// The in-app inbox (sprint 3): a person's own notifications. Every method takes the actor and acts on
// that actor's items only: no method takes a user id, and an item id that is not the caller's is a
// 403, the same for an id that belongs to somebody else and one that does not exist, so the answer
// is no oracle for other people's items (as for tokens in M3, but 403 here by decision).
// Items hold plain text; a UI shows them as text and never as HTML.
import { Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type Db, type DbTx } from '@scorpion/kernel';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { inboxItem } from '../db/schema.ts';
import { announceInboxChange } from './inbox-channel.ts';
import type { InAppContent } from './templates/layout.ts';

export const PERMISSION_INBOX_READ = 'core.notifications.inbox.read';
export const PERMISSION_INBOX_WRITE = 'core.notifications.inbox.write';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InboxItemView {
  id: string;
  template: string;
  title: string;
  text: string;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface InboxService {
  /** Needs `core.notifications.inbox.read`. The caller's items, newest first (`created_at`, then id), with the total. */
  list(
    actor: Actor,
    page: { page: number; pageSize: number },
  ): Promise<{ items: InboxItemView[]; total: number }>;
  /** Needs `core.notifications.inbox.read`. */
  unreadCount(actor: Actor): Promise<number>;
  /** Needs `core.notifications.inbox.write`. Also when it is read already (the first read time stays). `Forbidden` unless the item is the caller's. */
  markRead(actor: Actor, id: string): Promise<InboxItemView>;
  /** Needs `core.notifications.inbox.write`. How many items changed. */
  markAllRead(actor: Actor): Promise<number>;
  /** Needs `core.notifications.inbox.write`. `Forbidden` unless the item is the caller's. */
  remove(actor: Actor, id: string): Promise<void>;
}

/** What `enqueueTemplate` and `enqueue` use to write the item, in the caller's transaction. */
export async function insertInboxItem(
  tx: DbTx,
  item: { userId: string; template: string } & InAppContent,
): Promise<string> {
  const id = ids.uuidv7();
  await tx.insert(inboxItem).values({
    id,
    userId: item.userId,
    template: item.template,
    title: item.title,
    text: item.text,
    link: item.link,
  });
  // Delivered when the transaction commits: an open stream of this person gets the new count.
  await announceInboxChange(tx, item.userId);
  return id;
}

/** The trusted purge of core.identity: removes every item of a user (in its transaction). Returns how many. */
export async function deleteInboxOfUser(tx: DbTx, userId: string): Promise<number> {
  if (!UUID.test(userId)) return 0;
  const removed = await tx
    .delete(inboxItem)
    .where(eq(inboxItem.userId, userId.toLowerCase()))
    .returning({ id: inboxItem.id });
  return removed.length;
}

/** Deletes read items whose read time is older than `days`, in batches. Returns how many. */
export async function deleteReadInboxItems(db: Db, days: number, batch = 1000): Promise<number> {
  let total = 0;
  for (;;) {
    const old = await db
      .select({ id: inboxItem.id })
      .from(inboxItem)
      .where(
        and(
          isNotNull(inboxItem.readAt),
          lt(inboxItem.readAt, sql`now() - ${days}::int * interval '1 day'`),
        ),
      )
      .limit(batch);
    if (old.length === 0) return total;
    const gone = await db.delete(inboxItem).where(
      inArray(
        inboxItem.id,
        old.map((row) => row.id),
      ),
    );
    total += gone.rowCount ?? old.length;
    if (old.length < batch) return total;
  }
}

const view = (row: typeof inboxItem.$inferSelect): InboxItemView => ({
  id: row.id,
  template: row.template,
  title: row.title,
  text: row.text,
  link: row.link,
  createdAt: row.createdAt,
  readAt: row.readAt,
});

export function createInboxService(deps: {
  db: Db;
  authz: Pick<AuthzService, 'require'>;
}): InboxService {
  const { db, authz } = deps;

  /** The caller's id. Only a signed-in user has an inbox. */
  function owner(actor: Actor): string {
    if (actor.kind !== 'user') throw new Unauthorized();
    return actor.userId;
  }

  const notYours = () => new Forbidden('You can only use your own notifications.');

  return {
    async list(actor, page) {
      await authz.require(actor, PERMISSION_INBOX_READ);
      const userId = owner(actor);
      const [counted] = await db
        .select({ n: count() })
        .from(inboxItem)
        .where(eq(inboxItem.userId, userId));
      const rows = await db
        .select()
        .from(inboxItem)
        .where(eq(inboxItem.userId, userId))
        .orderBy(desc(inboxItem.createdAt), desc(inboxItem.id))
        .limit(page.pageSize)
        .offset(page.page * page.pageSize);
      return { items: rows.map(view), total: counted?.n ?? 0 };
    },

    async unreadCount(actor) {
      await authz.require(actor, PERMISSION_INBOX_READ);
      const [counted] = await db
        .select({ n: count() })
        .from(inboxItem)
        .where(and(eq(inboxItem.userId, owner(actor)), isNull(inboxItem.readAt)));
      return counted?.n ?? 0;
    },

    async markRead(actor, id) {
      await authz.require(actor, PERMISSION_INBOX_WRITE);
      const userId = owner(actor);
      if (!UUID.test(id)) throw notYours();
      // One statement scoped to the owner: somebody else's id changes nothing.
      const [row] = await db
        .update(inboxItem)
        .set({ readAt: sql`coalesce(${inboxItem.readAt}, now())` })
        .where(and(eq(inboxItem.id, id.toLowerCase()), eq(inboxItem.userId, userId)))
        .returning();
      if (!row) throw notYours();
      await announceInboxChange(db, userId);
      return view(row);
    },

    async markAllRead(actor) {
      await authz.require(actor, PERMISSION_INBOX_WRITE);
      const changed = await db
        .update(inboxItem)
        .set({ readAt: sql`now()` })
        .where(and(eq(inboxItem.userId, owner(actor)), isNull(inboxItem.readAt)))
        .returning({ id: inboxItem.id });
      if (changed.length > 0) await announceInboxChange(db, owner(actor));
      return changed.length;
    },

    async remove(actor, id) {
      await authz.require(actor, PERMISSION_INBOX_WRITE);
      const userId = owner(actor);
      if (!UUID.test(id)) throw notYours();
      const removed = await db
        .delete(inboxItem)
        .where(and(eq(inboxItem.id, id.toLowerCase()), eq(inboxItem.userId, userId)))
        .returning({ id: inboxItem.id });
      if (removed.length === 0) throw notYours();
      await announceInboxChange(db, userId);
    },
  };
}
