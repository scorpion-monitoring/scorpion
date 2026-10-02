// The only file other modules may import. It holds the service interface and nothing else.
//
// A module stores a file with `put`, keeps it alive with `setReference` (inside the transaction that
// stores the file's id), and shows it as `/files/{hash}`. A file nothing refers to is removed after
// a grace period (ADR-0018). Neither method of this interface is reachable over HTTP: the routes of
// the module and of the module that owns the data call them.
import type { Actor } from '@scorpion/contracts';

export { MAX_UPLOAD_BYTES } from './settings-schema.ts';

export interface BlobInfo {
  id: string;
  /** Lower-case hex SHA-256 of the stored bytes; the file is served at `GET /files/{hash}`. */
  hash: string;
  /** The type that was determined from the content, never the one the client claimed. */
  mime: string;
  /** Bytes as stored (after the file was processed). */
  size: number;
}

export interface BlobService {
  /**
   * Needs `core.blob.upload`. Checks, rewrites and stores an upload: a raster is decoded and written
   * again without metadata and scaled down to the configured size; an SVG is sanitised; anything
   * else is refused. The same content is stored once. `Invalid` (422) for a file that is empty, too
   * big, not a supported image or damaged. The file is unreferenced until `setReference` names it,
   * and is removed after the grace period if that never happens.
   */
  put(actor: Actor, bytes: Uint8Array): Promise<BlobInfo>;

  /** Trusted: what is stored under an id, or `undefined`. Checks no permission. */
  describe(id: string): Promise<BlobInfo | undefined>;

  /**
   * Trusted: makes `ref` hold `blobId` (or nothing, with `null`) and releases what it held before.
   * `ref` names the owner and the purpose, `<module id>:<purpose>:<id>` (`core.identity:avatar:<user id>`);
   * one `ref` holds one file. Runs inside the caller's transaction when there is one, so the id that
   * is stored and the reference that keeps the file are written together. `Invalid` when `blobId`
   * names no stored file. A file that loses its last reference is removed after the grace period,
   * not at once.
   */
  setReference(ref: string, blobId: string | null): Promise<void>;
}

// Lets `ctx.deps['core.blob']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.blob': BlobService;
  }
}
