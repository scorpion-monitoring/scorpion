// The blob store: content-addressed files in a table, with references that keep them alive.
//
// A file is stored once per content (`hash` is unique). An upload creates it unreferenced; a
// reference (`setReference`) clears `unreferenced_since`, and releasing the last reference sets it.
// The cleanup job deletes files that have been unreferenced for longer than the grace period, which
// is what makes the order "upload, then store the id" safe without a transaction that spans the
// request. Everything that is stored passed `processUpload`.
import { createHash } from 'node:crypto';
import { Invalid, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type ModuleContext } from '@scorpion/kernel';
import { and, eq, inArray, isNotNull, lt, notExists, sql } from 'drizzle-orm';
import { blob, reference } from '../db/schema.ts';
import type { BlobInfo, BlobService } from '../public.ts';
import type { BlobSettings } from '../settings-schema.ts';
import { processUpload } from './images.ts';
import { PERMISSION_UPLOAD } from './permissions.ts';

/** `<module id>:<purpose>:<id>`; printable ASCII, no spaces, bounded. */
export const REFERENCE = /^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*:[A-Za-z0-9._-]{1,128}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Files removed per cleanup transaction. */
export const CLEANUP_BATCH = 200;

export interface StoredFile extends BlobInfo {
  data: Buffer;
}

export interface BlobInternals extends BlobService {
  /** The metadata of a file by hash, without its bytes. */
  stat(hash: string): Promise<BlobInfo | undefined>;
  /** A file by hash, with its bytes. */
  read(hash: string): Promise<StoredFile | undefined>;
  /** The id of the file with this content hash. */
  idOfHash(hash: string): Promise<string | undefined>;
  /** Removes the files that have been unreferenced for longer than the grace period. Returns how many went. */
  cleanup(now?: Date): Promise<{ removed: number }>;
}

const info = (row: { id: string; hash: string; mime: string; size: number }): BlobInfo => ({
  id: row.id,
  hash: row.hash,
  mime: row.mime,
  size: row.size,
});

export function createBlobService(
  ctx: ModuleContext<never, never, BlobSettings>,
  deps: { authz: Pick<AuthzService, 'require'> },
): BlobInternals {
  return {
    async put(actor: Actor, bytes) {
      await deps.authz.require(actor, PERMISSION_UPLOAD);
      const settings = await ctx.settings.get();
      const { data, mime } = await processUpload(bytes, settings);
      const hash = createHash('sha256').update(data).digest('hex');
      // One statement: new content is stored; known content is not stored again, and a file that
      // nothing refers to gets a fresh grace period.
      const [row] = await ctx.db
        .insert(blob)
        .values({
          id: ids.uuidv7(),
          hash,
          mime,
          size: data.byteLength,
          data,
          unreferencedSince: new Date(),
        })
        .onConflictDoUpdate({
          target: blob.hash,
          set: {
            unreferencedSince: sql`case when exists (select 1 from ${reference} where ${reference.blobId} = ${blob.id}) then ${blob.unreferencedSince} else now() end`,
          },
        })
        .returning({ id: blob.id, hash: blob.hash, mime: blob.mime, size: blob.size });
      return info(row!);
    },

    async describe(id) {
      const [row] = await ctx.db
        .select({ id: blob.id, hash: blob.hash, mime: blob.mime, size: blob.size })
        .from(blob)
        .where(eq(blob.id, id));
      return row && info(row);
    },

    async stat(hash) {
      const [row] = await ctx.db
        .select({ id: blob.id, hash: blob.hash, mime: blob.mime, size: blob.size })
        .from(blob)
        .where(eq(blob.hash, hash));
      return row && info(row);
    },

    async read(hash) {
      const [row] = await ctx.db.select().from(blob).where(eq(blob.hash, hash));
      return row && { ...info(row), data: row.data };
    },

    async idOfHash(hash) {
      const [row] = await ctx.db.select({ id: blob.id }).from(blob).where(eq(blob.hash, hash));
      return row?.id;
    },

    async setReference(ref, blobId) {
      if (!REFERENCE.test(ref))
        throw new Error(`core.blob: "${ref.slice(0, 80)}" is not a valid reference`);
      await ctx.db.tx(async (tx) => {
        const [current] = await tx
          .select({ blobId: reference.blobId })
          .from(reference)
          .where(eq(reference.ref, ref))
          .for('update');
        if (blobId !== null) {
          // Locked, so the cleanup job (which skips locked rows) cannot remove it under us.
          const [target] = await tx
            .select({ id: blob.id })
            .from(blob)
            .where(eq(blob.id, blobId))
            .for('update');
          if (!target) {
            throw new Invalid('The file does not exist.', [
              { in: 'body', path: 'file', message: 'No such stored file.' },
            ]);
          }
          await tx
            .insert(reference)
            .values({ ref, blobId, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: reference.ref,
              set: { blobId, updatedAt: new Date() },
            });
          await tx.update(blob).set({ unreferencedSince: null }).where(eq(blob.id, blobId));
        } else if (current) {
          await tx.delete(reference).where(eq(reference.ref, ref));
        }
        if (current && current.blobId !== blobId) {
          // The file the reference let go of: unreferenced now, unless something else holds it.
          await tx
            .update(blob)
            .set({ unreferencedSince: new Date() })
            .where(
              and(
                eq(blob.id, current.blobId),
                notExists(
                  tx
                    .select({ one: sql`1` })
                    .from(reference)
                    .where(eq(reference.blobId, current.blobId)),
                ),
              ),
            );
        }
      });
    },

    async cleanup(now = new Date()) {
      const { unreferencedGraceHours } = await ctx.settings.get();
      const cutoff = new Date(now.getTime() - unreferencedGraceHours * 3_600_000);
      let removed = 0;
      for (;;) {
        const count = await ctx.db.tx(async (tx) => {
          const candidates = await tx
            .select({ id: blob.id })
            .from(blob)
            .where(
              and(
                isNotNull(blob.unreferencedSince),
                lt(blob.unreferencedSince, cutoff),
                notExists(
                  tx
                    .select({ one: sql`1` })
                    .from(reference)
                    .where(eq(reference.blobId, blob.id)),
                ),
              ),
            )
            .limit(CLEANUP_BATCH)
            .for('update', { skipLocked: true });
          if (candidates.length === 0) return 0;
          await tx.delete(blob).where(
            inArray(
              blob.id,
              candidates.map((candidate) => candidate.id),
            ),
          );
          return candidates.length;
        });
        removed += count;
        if (count < CLEANUP_BATCH) return { removed };
      }
    },
  };
}
